// AI PHOTO MAKEOVER jobs: the customer's photo + her outfit (photo and/or description) + occasion + her request
//   -> [1. outfit]  if an outfit PHOTO was given and FASHN is set up: FASHN puts the outfit on her photo first
//   -> [2. stylist] a vision AI reads the outfit and her photo and writes the complete makeup / hair / jewellery plan
//   -> [3. editor]  an image-editing AI applies that plan to her real photo and returns a NEW photograph
// Stored with the other try-ons (same private storage, history, image URL, guest -> account move, clean-up).
//
// Every status request moves the job forward by at most one short provider call, so no request runs long (Netlify: 10 s).
// Nothing is faked: a step that cannot run, or fails, fails the job with the reason. If FASHN cannot place the outfit (for
// example it finds no body pose), the makeover continues and the result says that the outfit was not put on.
import { ApiError, bad, notFound } from '../http.js'
import { validateImage, validateResultBytes, fileKey } from './images.js'
import { isGuestOwner } from '../db/models.js'
import { fashn } from '../providers/fashn.js'
import { OCCASIONS, pickStylist, replicateStylist, anthropicStylist, editor, parsePlan, editPrompt, replicateCancel, replicateInput, deleteReplicateFile, checkSetup } from '../providers/makeover.js'

const text = (v, max) => String(v ?? '').replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max)
const yes = (v, def) => (v == null || v === '' ? def : String(v) === 'true')

// which AI services the makeover would use right now (shown by /api/health and on the page; no secrets)
export function makeoverSetup(cfg) {
  const stylist = pickStylist(cfg), ed = editor.available(cfg)
  const missing = []
  if (!ed) missing.push('REPLICATE_API_TOKEN')
  else if (!stylist) missing.push(cfg.makeover.stylist === 'anthropic' ? 'ANTHROPIC_API_KEY' : 'REPLICATE_API_TOKEN')
  return {
    ready: !!(stylist && ed), missing,
    stylist: stylist ? stylist.label(cfg) : null, editor: ed ? editor.label(cfg) : null,
    outfitPhoto: fashn.available(cfg) ? 'fashn' : ed && editor.multiImage(cfg) ? 'editor' : 'analysis-only',
    occasions: Object.keys(OCCASIONS),
  }
}

export function makeoverService({ TryOn, RateLimit }, storage, cfg, tryon) {
  const files = storage.files
  const expiry = (owner) => isGuestOwner(owner) ? new Date(Date.now() + cfg.retention.guestHours * 36e5).toISOString()
    : cfg.retention.resultDays ? new Date(Date.now() + cfg.retention.resultDays * 864e5).toISOString() : null
  const expired = (job) => job.expiresAt && Date.parse(job.expiresAt) < Date.now()
  const get = async (owner, kind, job) => { const f = await files.getBytes(fileKey(owner, job.id, kind)); return f ? { bytes: f.bytes, mime: f.meta.mime } : null }

  // photos uploaded to Replicate's file storage are deleted as soon as the makeover ends (privacy)
  async function dropUploads(job) {
    for (const u of Object.values(job.mk?.urls || {})) if (u?.id) { try { await deleteReplicateFile(cfg, u.id) } catch { /* removed later by Replicate */ } }
    if (job.mk) job.mk.urls = {}
  }
  async function fail(job, code, detail) { await dropUploads(job); return tryon.failJob(job, code, detail) }
  async function succeed(job, bytes) { await dropUploads(job); return tryon.succeedJob(job, bytes) }
  // a photo as a Replicate input (uploaded once per job, then reused by the stylist and the editor)
  async function inputUrl(job, kind) {
    job.mk.urls ||= {}
    if (job.mk.urls[kind]) return job.mk.urls[kind].url
    const img = await get(job.owner, kind, job); if (!img) throw Object.assign(new Error('missing input'), { code: 'provider_error' })
    const u = await replicateInput(cfg, img); job.mk.urls[kind] = u; await TryOn.save(job)
    return u.url
  }

  // one provider call that may fail temporarily (busy, timeout): retried on later status checks, at most 3 times per step
  async function guarded(job, step, fn) {
    try { return await fn() } catch (e) {
      const n = (job.mk.tries[step] = (job.mk.tries[step] || 0) + 1)
      if (e.retryable && n < 3) { job.stage = 'retrying'; await TryOn.save(job); return undefined }
      console.warn(`makeover ${job.id}: ${step} failed (${e.code || e.message}${e.status ? ' HTTP ' + e.status : ''}${e.detail ? ': ' + e.detail : ''})`)
      await fail(job, e.code || 'provider_error', e.detail); return undefined
    }
  }

  // ---- the steps ----
  async function stepOutfit(job) {
    const mk = job.mk
    if (!mk.outfitId) {
      const person = await get(job.owner, 'person', job), garment = await get(job.owner, 'garment', job)
      if (!person || !garment) return fail(job, 'provider_error')
      job.stage = 'outfit'
      try { mk.outfitId = (await fashn.start({ person, garment, options: { category: 'auto' } }, cfg)).externalId }
      catch (e) { if (e.retryable && (mk.tries.outfit = (mk.tries.outfit || 0) + 1) < 3) { job.stage = 'retrying'; return TryOn.save(job) } mk.notes.push('outfit_not_placed'); mk.step = 'stylist' }
      return TryOn.save(job)
    }
    let r; try { r = await fashn.check(mk.outfitId, cfg) } catch (e) { if (e.retryable) return TryOn.save(job); r = { state: 'failed', code: e.code } }
    if (r.state === 'processing') { job.stage = 'outfit'; return TryOn.save(job) }
    if (r.state === 'succeeded') {
      try { const img = validateResultBytes(r.bytes); await files.setBytes(fileKey(job.owner, job.id, 'dressed'), img.bytes, { mime: img.mime }); job.inputs.dressed = { mime: img.mime, at: Date.now() }; mk.dressed = true }
      catch { mk.notes.push('outfit_not_placed') }
    } else mk.notes.push('outfit_not_placed')
    mk.step = 'stylist'; job.stage = 'analysing'
    return TryOn.save(job)
  }

  const stylistInput = async (job) => { // for Claude: the photos themselves (sent inside the request)
    const person = await get(job.owner, 'person', job), garment = job.inputs.garment ? await get(job.owner, 'garment', job) : null
    return { images: [person, garment].filter(Boolean), o: { ...job.options, hasGarment: !!garment } }
  }
  async function stepStylist(job) {
    const mk = job.mk
    // Claude (optional): one short request. If it fails or is too slow, the Replicate stylist takes over (when available).
    if (mk.stylist === anthropicStylist.id) {
      if (mk.busyUntil > Date.now()) return job // another status request is waiting for Claude right now
      // a request cut off by the host while waiting (Netlify: 10 s) leaves no answer: Claude is tried once, then the fallback
      if ((mk.tries.anthropic = (mk.tries.anthropic || 0) + 1) > 1) {
        if (replicateStylist.available(cfg)) { mk.stylist = replicateStylist.id; mk.notes.push('stylist_fallback'); return TryOn.save(job) }
        return fail(job, 'stylist_error')
      }
      mk.busyUntil = Date.now() + cfg.makeover.anthropic.timeoutMs + 5000; job.stage = 'analysing'; await TryOn.save(job)
      const { images, o } = await stylistInput(job)
      try { job.plan = parsePlan(await anthropicStylist.run(images, o, cfg)) }
      catch (e) {
        mk.busyUntil = 0
        if (['no_face', 'minor'].includes(e.code)) return fail(job, e.code)
        if (replicateStylist.available(cfg)) { mk.stylist = replicateStylist.id; mk.notes.push('stylist_fallback'); return TryOn.save(job) }
        return fail(job, e.code === 'stylist_bad' ? 'stylist_bad' : e.code || 'stylist_error')
      }
      mk.busyUntil = 0; mk.step = 'edit'; job.stage = 'styling'
      return TryOn.save(job)
    }
    // Replicate stylist: start, then poll
    if (!mk.stylistId) {
      job.stage = 'analysing'
      const o = { ...job.options, hasGarment: !!job.inputs.garment }
      const id = await guarded(job, 'stylist', async () => replicateStylist.start([await inputUrl(job, 'person'), ...(job.inputs.garment ? [await inputUrl(job, 'garment')] : [])], o, cfg)); if (id === undefined) return job
      mk.stylistId = id; return TryOn.save(job)
    }
    let r; try { r = await replicateStylist.check(mk.stylistId, cfg) } catch (e) { if (e.retryable) return TryOn.save(job); return fail(job, e.code || 'stylist_error') }
    if (r.state === 'processing') { job.stage = 'analysing'; return TryOn.save(job) }
    if (r.state === 'failed') return fail(job, r.code === 'blocked' ? 'blocked' : 'stylist_error', r.detail)
    try { job.plan = parsePlan(r.text) } catch (e) {
      // one more try with a fresh request if the answer was not usable JSON
      if (e.code === 'stylist_bad' && !mk.stylistRetried) { mk.stylistRetried = true; mk.stylistId = null; return TryOn.save(job) }
      return fail(job, e.code || 'stylist_bad')
    }
    mk.step = 'edit'; job.stage = 'styling'
    return TryOn.save(job)
  }

  async function stepEdit(job) {
    const mk = job.mk
    if (!mk.editId) {
      const useGarment = !mk.dressed && !!job.inputs.garment && editor.multiImage(cfg)
      if (!mk.dressed && job.inputs.garment && !useGarment && !mk.notes.includes('outfit_not_placed')) mk.notes.push('outfit_not_placed')
      if (useGarment && !mk.notes.includes('outfit_by_editor')) mk.notes.push('outfit_by_editor')
      mk.prompt = editPrompt(job.plan, { ...job.options, dressed: !!mk.dressed, outfitImage: useGarment })
      job.stage = 'styling'
      const id = await guarded(job, 'edit', async () => editor.start([await inputUrl(job, mk.dressed ? 'dressed' : 'person'), ...(useGarment ? [await inputUrl(job, 'garment')] : [])], mk.prompt, cfg)); if (id === undefined) return job
      mk.editId = id; job.externalId = id; job.status = 'processing'
      return TryOn.save(job)
    }
    let r; try { r = await editor.check(mk.editId, cfg) } catch (e) { if (e.retryable) return TryOn.save(job); return fail(job, e.code || 'provider_error') }
    if (r.state === 'processing') { job.stage = 'styling'; return TryOn.save(job) }
    if (r.state === 'failed') return fail(job, r.code, r.detail)
    return succeed(job, r.bytes)
  }

  // live setup check, shared by all visitors: cached for a minute, at most a few real checks per visitor
  let checkCache = { at: 0, value: null }
  const svc = {
    async check(ip) {
      if (Date.now() - checkCache.at < 60_000 && checkCache.value) return checkCache.value
      const r = await RateLimit.hit('mk-check', ip, 6, 600)
      if (!r.ok) throw new ApiError(429, 'rate_limited', 'Please wait a minute before checking again.', { retryAfter: r.retryAfter })
      const value = await checkSetup(cfg); value.ready = !!(value.token?.ok && value.editor?.ok && value.stylist?.ok)
      checkCache = { at: Date.now(), value }; return value
    },

    async generate(owner, form, ip) {
      if (form.get('consent') !== 'true') throw bad('consent_required', 'Please tick the consent box first.')
      const setup = makeoverSetup(cfg)
      if (!setup.ready) throw new ApiError(503, 'not_configured', 'AI Photo Makeover is not switched on for this website yet. The site owner needs to add the AI service key (see README, AI Photo Makeover).', { missing: setup.missing })
      const options = {
        outfitText: text(form.get('outfitText'), 300), occasion: text(form.get('occasion'), 20), instructions: text(form.get('instructions'), 600),
        hair: yes(form.get('hair'), true), jewellery: yes(form.get('jewellery'), true), avoid: text(form.get('avoid'), 60),
      }
      if (options.occasion && !OCCASIONS[options.occasion]) throw bad('bad_occasion', 'Unknown occasion.')
      const person = await validateImage(form.get('person'), 'Your photo', cfg.limits)
      const g = form.get('garment'), garment = g && typeof g !== 'string' && g.size ? await validateImage(g, 'The outfit photo', cfg.limits) : null
      if (!garment && options.outfitText.length < 3) throw bad('outfit_required', 'Please upload a photo of your outfit or describe it.')
      const [lo, lw] = cfg.limits.generatePerOwner, [li, liw] = cfg.limits.generatePerIp
      for (const [bucket, key, max, win] of [['gen-owner', owner, lo, lw], ['gen-ip', ip, li, liw]]) {
        const r = await RateLimit.hit(bucket, key, max, win)
        if (!r.ok) throw new ApiError(429, 'rate_limited', `You have made a lot of AI looks in a short time. Please wait about ${Math.ceil(r.retryAfter / 60)} minute(s).`, { retryAfter: r.retryAfter })
      }
      const stylist = pickStylist(cfg)
      let job = await TryOn.create(owner, { type: 'makeover', provider: 'makeover', mode: 'server', options, expiresAt: expiry(owner) })
      job.mk = { step: garment && fashn.available(cfg) ? 'outfit' : 'stylist', stylist: stylist.id, stylistLabel: stylist.label(cfg), editorLabel: editor.label(cfg), tries: {}, notes: [], dressed: false }
      for (const [kind, img] of [['person', person], ['garment', garment]]) if (img) { await files.setBytes(fileKey(owner, job.id, kind), img.bytes, { mime: img.mime }); job.inputs[kind] = { mime: img.mime, at: Date.now() } }
      job.status = 'processing'; job.stage = job.mk.step === 'outfit' ? 'outfit' : 'analysing'
      job = await TryOn.save(job)
      return svc.advance(job)
    },

    async advance(job) {
      if (['succeeded', 'failed'].includes(job.status)) return job
      if (job.mk.step === 'outfit') return stepOutfit(job)
      if (job.mk.step === 'stylist') return stepStylist(job)
      return stepEdit(job)
    },

    async status(owner, id) {
      const job = await TryOn.get(owner, id)
      if (!job || job.type !== 'makeover' || expired(job)) throw notFound('This makeover was not found. It may have been deleted or expired.')
      if (['succeeded', 'failed'].includes(job.status)) return job
      if (Date.now() - Date.parse(job.createdAt) > cfg.retention.jobTimeoutMinutes * 6e4) { await svc.cancelRunning(job); return fail(job, 'timeout') }
      if (job.lastCheckAt && Date.now() - job.lastCheckAt < cfg.providers.checkIntervalMs) return job
      job.lastCheckAt = Date.now()
      return svc.advance(job)
    },

    async cancelRunning(job) {
      const mk = job.mk || {}
      for (const id of [mk.editId, mk.stylist === replicateStylist.id ? mk.stylistId : null].filter(Boolean)) { try { await replicateCancel(cfg, id) } catch { /* already finished */ } }
      if (mk.outfitId && mk.step === 'outfit') { try { await fashn.cancel(mk.outfitId, cfg) } catch { /* already finished */ } }
    },
  }
  return svc
}
