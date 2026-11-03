// Try-on jobs: Person photo + clothing photo -> AI -> generated image.
//
// Life of a job:   queued -> processing -> succeeded | failed          (server providers, e.g. FASHN)
//                  awaiting_client -> succeeded | failed                (free provider that runs in the visitor's browser)
// - The uploaded photos are stored PRIVATELY and only while the AI works (so a start that hit a temporary "busy" can be retried);
//   they are deleted as soon as the job finishes, and the clean-up job removes any left behind.
// - The generated image is checked (must be a real image) and stored privately; only the owner's session can read it.
// - Nothing is ever faked: if a provider is not set up or fails, the job says so.
import { ApiError, bad, notFound } from '../http.js'
import { pickProvider, providerById, describe } from '../providers/index.js'
import { STYLES, COLOURS } from '../providers/prompts.js'
import { validateImage, validateResultBytes, fileKey } from './images.js'
import { isGuestOwner } from '../db/models.js'

const CATEGORIES = ['auto', 'tops', 'bottoms', 'one-pieces']
const MESSAGES = {
  provider_auth: 'The AI service rejected the server\'s API key. The site owner needs to check the key.',
  provider_billing: 'The AI service account has no credit left. The site owner needs to top it up.',
  provider_busy: 'The AI service is busy right now. Please try again in a minute.',
  provider_error: 'The AI service had a problem and could not finish. Please try again.',
  provider_rejected: 'The AI service could not accept these photos. Please try different photos.',
  provider_timeout: 'The AI service did not answer in time. Please try again.',
  provider_unreachable: 'The AI service cannot be reached right now. Please try again later.',
  provider_empty: 'The AI service finished without an image. Please try again.',
  provider_bad_image: 'The AI service returned something that is not an image.',
  pose: 'The AI could not find a body pose in your photo. Use a clear, front-facing photo showing your upper body.',
  input: 'The AI could not use one of the photos. Try a clear JPG or PNG.',
  blocked: 'The AI service declined these photos.',
  timeout: 'This try-on took too long and was stopped. Please try again.',
  cancelled: 'Cancelled.',
  // reported by the browser for the free provider
  free_unreachable: 'The free AI service (Hugging Face) could not be reached. It may be starting up or busy: please try again later.',
  free_quota: 'The free AI service\'s daily limit for your connection is used up. Please try again later (it resets within 24 hours).',
  free_busy: 'The free AI service is very busy. Please try again in a few minutes.',
  free_error: 'The free AI service could not finish. Please try again, ideally with a clear, front-facing photo.',
}
export const messageFor = (code) => MESSAGES[code] || MESSAGES.provider_error

export function tryonService({ TryOn, RateLimit }, storage, cfg) {
  const files = storage.files
  const expiry = (owner) => isGuestOwner(owner) ? new Date(Date.now() + cfg.retention.guestHours * 36e5).toISOString()
    : cfg.retention.resultDays ? new Date(Date.now() + cfg.retention.resultDays * 864e5).toISOString() : null
  const expired = (job) => job.expiresAt && Date.parse(job.expiresAt) < Date.now()

  async function dropInputs(job) {
    for (const kind of ['person', 'garment']) if (job.inputs?.[kind]) { await files.delete(fileKey(job.owner, job.id, kind)); delete job.inputs[kind] }
  }
  async function fail(job, code) {
    job.status = 'failed'; job.stage = 'failed'; job.error = { code, message: messageFor(code) }; job.completedAt = new Date().toISOString()
    await dropInputs(job); return TryOn.save(job)
  }
  async function succeed(job, bytes) {
    let img; try { img = validateResultBytes(bytes) } catch { return fail(job, 'provider_bad_image') }
    await files.setBytes(fileKey(job.owner, job.id, 'result'), img.bytes, { mime: img.mime })
    job.result = { mime: img.mime, width: img.width, height: img.height, bytes: img.bytes.length }
    job.status = 'succeeded'; job.stage = 'done'; job.error = null; job.completedAt = new Date().toISOString()
    await dropInputs(job); return TryOn.save(job)
  }
  async function loadInputs(job) {
    const out = {}
    for (const kind of ['person', 'garment']) if (job.inputs?.[kind]) { const f = await files.getBytes(fileKey(job.owner, job.id, kind)); if (f) out[kind] = { bytes: f.bytes, mime: f.meta.mime } }
    return out
  }
  async function tryStart(job, provider, inputs) {
    job.attempts++; job.lastCheckAt = Date.now()
    try {
      const { externalId } = await provider.start({ ...inputs, options: job.options }, cfg)
      job.externalId = externalId; job.status = 'processing'; job.stage = 'waiting'
      return TryOn.save(job)
    } catch (e) {
      // a temporary problem (busy, timeout, server error) at the start: keep the job queued and retry on the next status check
      if (e.retryable && job.attempts < 3) { job.stage = 'retrying'; return TryOn.save(job) }
      console.warn(`tryon ${job.id}: start failed (${e.code || e.message})`)
      return fail(job, e.code || 'provider_error')
    }
  }

  const svc = {
    publicJob(job) {
      const p = providerById(job.provider)
      return {
        id: job.id, type: job.type, status: job.status, stage: job.stage, options: job.options,
        provider: describe(p, cfg), error: job.error, createdAt: job.createdAt, completedAt: job.completedAt, expiresAt: job.expiresAt,
        result: job.status === 'succeeded' && job.result ? { url: `/api/images/${job.id}/result`, mime: job.result.mime, width: job.result.width, height: job.result.height } : null,
      }
    },

    async generate(owner, form, ip) {
      const type = String(form.get('type') || 'outfit')
      if (type !== 'outfit' && type !== 'hair') throw bad('bad_type', 'Unknown try-on type.')
      if (form.get('consent') !== 'true') throw bad('consent_required', 'Please tick the consent box first.')
      const provider = pickProvider(type, cfg)
      if (!provider) throw new ApiError(503, 'not_configured', type === 'hair' ? 'AI hairstyles are not switched on for this website yet.' : 'AI outfit try-on is not switched on for this website yet.')
      const options = {}
      if (type === 'outfit') { const c = String(form.get('category') || 'auto'); if (!CATEGORIES.includes(c)) throw bad('bad_category', 'Unknown clothing type.'); options.category = c }
      else {
        const s = String(form.get('style') || ''), c = String(form.get('colour') || 'natural')
        if (!STYLES[s]) throw bad('bad_style', 'Unknown hairstyle.'); if (!(c in COLOURS)) throw bad('bad_colour', 'Unknown hair colour.')
        options.style = s; options.colour = c
      }
      // photos are only uploaded to us for providers that run on the server; the free provider runs in the browser
      let inputs = null
      if (provider.mode === 'server') {
        inputs = { person: await validateImage(form.get('person'), 'Your photo', cfg.limits) }
        if (type === 'outfit') inputs.garment = await validateImage(form.get('garment'), 'The outfit photo', cfg.limits)
      }
      const [lo, lw] = cfg.limits.generatePerOwner, [li, liw] = cfg.limits.generatePerIp
      for (const [bucket, key, max, win] of [['gen-owner', owner, lo, lw], ['gen-ip', ip, li, liw]]) {
        const r = await RateLimit.hit(bucket, key, max, win)
        if (!r.ok) throw new ApiError(429, 'rate_limited', `You have made a lot of try-ons in a short time. Please wait about ${Math.ceil(r.retryAfter / 60)} minute(s).`, { retryAfter: r.retryAfter })
      }
      let job = await TryOn.create(owner, { type, provider: provider.id, mode: provider.mode, options, expiresAt: expiry(owner) })
      if (provider.mode === 'browser') { job.status = 'awaiting_client'; job.stage = 'waiting_for_browser'; return TryOn.save(job) }
      for (const kind of Object.keys(inputs)) { await files.setBytes(fileKey(owner, job.id, kind), inputs[kind].bytes, { mime: inputs[kind].mime }); job.inputs[kind] = { mime: inputs[kind].mime, at: Date.now() } }
      job = await TryOn.save(job)
      return tryStart(job, provider, inputs)
    },

    // one status request also moves the job forward (asks the AI service at most every PROVIDER_CHECK_MS, default 1.5 s)
    async status(owner, id) {
      let job = await TryOn.get(owner, id)
      if (!job || expired(job)) throw notFound('This try-on was not found. It may have been deleted or expired.')
      if (['succeeded', 'failed'].includes(job.status)) return job
      if (Date.now() - Date.parse(job.createdAt) > cfg.retention.jobTimeoutMinutes * 6e4) {
        const p = providerById(job.provider); if (job.externalId && p?.cancel) { try { await p.cancel(job.externalId, cfg) } catch { /* ignore */ } }
        return fail(job, 'timeout')
      }
      if (job.mode === 'browser') return job
      if (job.lastCheckAt && Date.now() - job.lastCheckAt < cfg.providers.checkIntervalMs) return job
      const provider = providerById(job.provider)
      if (!provider) return fail(job, 'provider_error')
      if (job.status === 'queued') { const inputs = await loadInputs(job); return inputs.person ? tryStart(job, provider, inputs) : fail(job, 'provider_error') }
      job.lastCheckAt = Date.now()
      try {
        const r = await provider.check(job.externalId, cfg)
        if (r.state === 'succeeded') return succeed(job, r.bytes)
        if (r.state === 'failed') return fail(job, r.code)
        if (r.stage && r.stage !== job.stage) job.stage = r.stage
        return TryOn.save(job)
      } catch (e) {
        if (e.retryable) return TryOn.save(job) // temporary: check again next time
        return fail(job, e.code || 'provider_error')
      }
    },

    // free provider: the browser sends the finished image (or reports a failure)
    async complete(owner, id, form) {
      const job = await TryOn.get(owner, id)
      if (!job || expired(job)) throw notFound('This try-on was not found.')
      if (job.mode !== 'browser') throw bad('wrong_mode', 'This try-on is processed on the server.')
      if (job.status !== 'awaiting_client') throw new ApiError(409, 'already_finished', 'This try-on is already finished.')
      const img = await validateImage(form.get('result'), 'The generated image', { ...cfg.limits, minImageSide: 128 })
      return succeed(job, img.bytes)
    },
    async reportFailure(owner, id, code) {
      const job = await TryOn.get(owner, id)
      if (!job) throw notFound('This try-on was not found.')
      if (job.mode !== 'browser' || job.status !== 'awaiting_client') throw new ApiError(409, 'already_finished', 'This try-on is already finished.')
      return fail(job, ['free_unreachable', 'free_quota', 'free_busy', 'free_error', 'cancelled'].includes(code) ? code : 'free_error')
    },

    async history(owner, { limit = 30, type } = {}) {
      const jobs = (await TryOn.listForOwner(owner)).sort((a, b) => (a.id < b.id ? -1 : 1)) // ids sort newest first
      const out = []
      for (const j of jobs) {
        if (expired(j)) { await svc.removeJob(j); continue }
        if (type && j.type !== type) continue
        if (out.length < Math.min(100, Math.max(1, limit))) out.push(j)
      }
      return out
    },

    async removeJob(job) {
      const p = providerById(job.provider)
      if (job.status === 'processing' && job.externalId && p?.cancel) { try { await p.cancel(job.externalId, cfg) } catch { /* already finished */ } }
      for (const kind of ['person', 'garment', 'result']) await files.delete(fileKey(job.owner, job.id, kind))
      await TryOn.remove(job)
    },
    async remove(owner, id) {
      const job = await TryOn.get(owner, id); if (!job) throw notFound('This try-on was not found.')
      await svc.removeJob(job)
    },

    async image(owner, id, kind) {
      if (kind !== 'result') throw notFound()
      const job = await TryOn.get(owner, id)
      if (!job || expired(job) || job.status !== 'succeeded') throw notFound('This image was not found.')
      const f = await files.getBytes(fileKey(owner, id, 'result')); if (!f) throw notFound('This image was not found.')
      return { bytes: f.bytes, mime: f.meta.mime || job.result?.mime || 'image/jpeg' }
    },

    // a guest who signs up / signs in keeps the looks made as a guest: records and images move to the account
    async claim(fromOwner, toOwner) {
      let n = 0
      for (const job of await TryOn.listForOwner(fromOwner)) {
        if (expired(job)) { await svc.removeJob(job); continue }
        const moved = { ...job, owner: toOwner, expiresAt: expiry(toOwner) }
        for (const kind of ['person', 'garment', 'result']) {
          const f = await files.getBytes(fileKey(fromOwner, job.id, kind))
          if (f) { await files.setBytes(fileKey(toOwner, job.id, kind), f.bytes, f.meta); await files.delete(fileKey(fromOwner, job.id, kind)) }
        }
        await TryOn.save(moved); await TryOn.remove(job); n++
      }
      return n
    },

    async removeAllForOwner(owner) { for (const j of await TryOn.listForOwner(owner)) await svc.removeJob(j) },

    // clean-up (scheduled every hour on Netlify, and every 30 minutes by backend/server.js): expired results, leftover
    // uploaded photos, jobs that never finished
    async cleanup() {
      const stats = { expired: 0, inputs: 0, timedOut: 0 }
      for (const key of await TryOn.allKeys()) {
        const job = await TryOn.getByKey(key); if (!job) continue
        if (expired(job)) { await svc.removeJob(job); stats.expired++; continue }
        const old = Object.values(job.inputs || {}).some((i) => Date.now() - (i.at || 0) > cfg.retention.inputMinutes * 6e4)
        if (old) { await dropInputs(job); await TryOn.save(job); stats.inputs++ }
        if (!['succeeded', 'failed'].includes(job.status) && Date.now() - Date.parse(job.createdAt) > cfg.retention.jobTimeoutMinutes * 6e4) { await fail(job, 'timeout'); stats.timedOut++ }
      }
      stats.rateKeys = await RateLimit.sweep()
      return stats
    },
  }
  return svc
}
