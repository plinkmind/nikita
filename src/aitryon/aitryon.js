// "See It On You": AI photo-based virtual outfit try-on (separate from the live camera studio in src/tryon/, which is unchanged).
// The result is a GENERATED image from an AI try-on model. Nothing here overlays or composites images, and if the AI is not
// available or fails, the page says so and shows no result.
//
// It talks to the Glamify backend (backend/src, see docs/API.md):
//   POST /api/tryon/generate -> GET /api/tryon/status/:id (polling) -> GET /api/images/:id/result (private image)
//   GET /api/tryon/history, DELETE /api/tryon/:id  ("My looks")
// Which AI runs is decided by the backend:
//   - FASHN (paid, when the site owner set FASHN_API_KEY): photos are uploaded to the backend, which calls FASHN.
//   - free IDM-VTON on Hugging Face (default): the photos go from the visitor's browser straight to Hugging Face (each visitor
//     uses their own free allowance); the finished image is then saved to the backend (history).
// If the backend cannot be reached at all, free mode still works without history.
import './aitryon.css'
import { api, session } from '../api/client.js'

const FREE_SPACE_DEFAULT = (import.meta.env?.VITE_FREE_TRYON_SPACE || 'yisol/IDM-VTON').trim(), FREE_ON = import.meta.env?.VITE_FREE_TRYON !== 'off'
const MAX_BYTES = 15 * 1024 * 1024, MIN_SIDE = 300, LONG_EDGE = 1536
const CATS = [['auto', 'Detect automatically'], ['tops', 'Top / shirt / jacket'], ['bottoms', 'Bottoms'], ['one-pieces', 'Dress / full outfit']]
const STAGE = { queued: 'Preparing your photos', retrying: 'The AI is busy, retrying', waiting: 'Waiting for the AI', generating: 'Generating your look', connecting: 'Connecting to the free AI service', uploading: 'Sending your photos', pending: 'Waiting in the free queue', saving: 'Saving your look' }
const esc = (t) => String(t ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))
const when = (d) => { try { return new Date(d).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) } catch { return '' } }

// Reads a user photo, checks it, fixes phone rotation (EXIF), shrinks it and returns a JPEG (preview URL + Blob for upload).
async function prepare(file, what) {
  if (!file) throw new Error(`Please choose ${what}.`)
  if (!/^image\/(jpeg|png|webp)$/.test(file.type)) throw new Error(/heic|heif/i.test(file.type + file.name) ? 'iPhone HEIC photos are not supported by browsers. Please export the photo as JPG and try again.' : 'Please choose a JPG, PNG or WebP image.')
  if (file.size > MAX_BYTES) throw new Error('That image is larger than 15 MB. Please choose a smaller one.')
  let bmp
  try { bmp = await createImageBitmap(file, { imageOrientation: 'from-image' }) } catch { throw new Error('That image could not be read. Please try another one.') }
  if (Math.min(bmp.width, bmp.height) < MIN_SIDE) throw new Error(`That image is too small (${bmp.width} x ${bmp.height}). Please use one at least ${MIN_SIDE} pixels on each side.`)
  const k = Math.min(1, LONG_EDGE / Math.max(bmp.width, bmp.height)), c = document.createElement('canvas')
  c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k)
  const x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height); x.drawImage(bmp, 0, 0, c.width, c.height)
  const blob = await new Promise((ok) => c.toBlob(ok, 'image/jpeg', 0.9))
  return { url: URL.createObjectURL(blob), blob, w: c.width, h: c.height, landscape: bmp.width > bmp.height * 1.05 }
}

const TEMPLATE = `
<div class="at-head">
  <div><span class="at-k">Glamify Mirror Me<span class="full"> &middot; AI Virtual Try-On</span></span><h2>See It On You</h2></div>
  <button class="at-x" data-at="close" aria-label="Close">&times;</button>
</div>
<div class="at-body">
  <p class="at-intro">Upload a photo of yourself and a photo of any outfit. Our AI virtual try-on model creates a <b>new image</b> of you wearing it. This is a generated image, not the live camera mirror.</p>
  <div class="at-status" role="status" hidden></div>
  <div class="at-who" hidden></div>
  <div class="at-grid">
    <section class="at-card" data-slot="person">
      <div class="at-card-h"><span class="at-n">1</span><div><h3>Upload your photo</h3><p>Full body or upper body, facing the camera, good light. One person only.</p></div></div>
      <div class="at-drop" tabindex="0" role="button" aria-label="Choose your photo"><input type="file" accept="image/jpeg,image/png,image/webp" hidden>
        <div class="at-empty"><span class="at-ico">&#9786;</span><b>Choose a photo</b><small>or drop it here &middot; JPG, PNG, WebP &middot; up to 15 MB</small></div>
        <img alt="Your photo" hidden></div>
      <div class="at-row" hidden><button data-at="replace">Replace</button><button data-at="remove">Remove</button></div>
      <p class="at-warn" hidden></p>
    </section>
    <section class="at-card" data-slot="garment">
      <div class="at-card-h"><span class="at-n">2</span><div><h3>Upload your outfit</h3><p>A clear product photo: flat-lay, on a hanger, ghost mannequin or worn by a model.</p></div></div>
      <div class="at-drop" tabindex="0" role="button" aria-label="Choose the outfit photo"><input type="file" accept="image/jpeg,image/png,image/webp" hidden>
        <div class="at-empty"><span class="at-ico">&#10070;</span><b>Choose an outfit</b><small>or drop it here &middot; dress, top, shirt, jacket, kurta...</small></div>
        <img alt="Outfit photo" hidden></div>
      <div class="at-row" hidden><button data-at="replace">Replace</button><button data-at="remove">Remove</button></div>
      <label class="at-cat">Type of clothing<select data-at-cat>${CATS.map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}</select></label>
      <p class="at-warn" hidden></p>
    </section>
  </div>
  <p class="at-mode" hidden></p>
  <label class="at-consent"><input type="checkbox" data-at-consent><span class="at-consent-t"></span></label>
  <div class="at-go"><button class="at-gen" data-at="generate" disabled><span>Generate My Look</span></button><p class="at-why"></p></div>
  <section class="at-work" hidden aria-live="polite">
    <div class="at-scan"><img alt=""><i></i></div>
    <div><p class="at-stage"></p><p class="at-time"></p><button data-at="cancel">Cancel</button></div>
  </section>
  <section class="at-result" hidden>
    <h3>Your AI-generated look</h3>
    <div class="at-cmp"><img class="at-after" alt="AI-generated try-on result"><div class="at-before-wrap"><img class="at-before" alt="Your original photo"></div><div class="at-handle"><span></span></div>
      <span class="at-tag l">BEFORE</span><span class="at-tag r">AFTER &middot; AI</span><input type="range" min="0" max="100" value="50" aria-label="Before and after divider"></div>
    <p class="at-note">AI-generated preview. The real garment's fit, size and drape can differ.</p>
    <p class="at-saved" hidden></p>
    <div class="at-actions"><button class="at-primary" data-at="download">Download result</button><button data-at="another">Try another outfit</button><button data-at="restart">Start over</button></div>
  </section>
  <section class="at-hist" hidden>
    <div class="at-hist-h"><h3>My looks</h3><p class="at-hist-note"></p></div>
    <div class="at-hist-grid"></div>
  </section>
</div>`

export function initAiTryOn(hooks = {}) {
  const root = document.createElement('div')
  root.className = 'at'; root.hidden = true; root.setAttribute('role', 'dialog'); root.setAttribute('aria-label', 'See It On You, AI virtual try-on')
  root.innerHTML = TEMPLATE; document.body.appendChild(root)
  const $ = (s) => root.querySelector(s), card = (slot) => root.querySelector(`[data-slot="${slot}"]`)
  // health: 'checking' | 'server' (paid AI on the backend) | 'free' (free AI, history on the backend) | 'free-local' (free AI, no backend) | 'off' | 'offline'
  const S = { person: null, garment: null, category: 'auto', consent: false, health: null, provider: null, job: null, result: null, resultBlob: null, saved: null, history: null, guestHours: 24 }
  let timer = 0, ctl = null, opener = null, freeJob = null, histUrls = []

  function status(html, kind = 'info') { const el = $('.at-status'); el.innerHTML = html || ''; el.className = 'at-status ' + kind; el.hidden = !html }
  async function checkHealth() {
    S.health = 'checking'; status('Checking the AI service&hellip;'); sync()
    try {
      const h = await api.health(), o = h.tryon?.outfit
      S.provider = o?.provider || null
      S.health = o?.ready ? (o.provider.mode === 'browser' ? 'free' : 'server') : 'off'
    } catch { S.provider = null; S.health = FREE_ON ? 'free-local' : 'offline' }
    modeText()
    if (S.health === 'off') status('<b>AI outfit try-on is switched off on this website.</b> The site owner can switch it on (README, section O). You can still use the live camera try-on. <button data-at="recheck">Check again</button>', 'warn')
    else if (S.health === 'offline') status('<b>The Glamify server cannot be reached.</b> Check your internet connection and try again. <button data-at="recheck">Check again</button>', 'warn')
    else status('')
    sync(); loadHistory()
  }
  const isFree = () => S.health === 'free' || S.health === 'free-local'
  const ready = () => ['server', 'free', 'free-local'].includes(S.health)
  function modeText() {
    const m = $('.at-mode'), free = isFree(), space = S.provider?.space || FREE_SPACE_DEFAULT
    m.hidden = !free
    m.innerHTML = free ? `<b>Free mode.</b> Uses the free public <a href="https://huggingface.co/spaces/${esc(/^[\w.-]+\/[\w.-]+$/.test(space) ? space : 'yisol/IDM-VTON')}" target="_blank" rel="noopener">IDM-VTON</a> research demo on Hugging Face: it can queue, has a small daily limit per visitor, and works best with <b>tops, shirts and jackets</b> (dresses and trousers may not transfer fully). Research licence: not for commercial use.${S.health === 'free-local' ? ' <br><i>The Glamify server is not reachable, so this look will not be saved to your history.</i>' : ''}` : ''
    $('.at-consent-t').textContent = free
      ? 'I agree that my two photos are sent from my browser to the free IDM-VTON demo on Hugging Face only to create this image. Hugging Face processes them under its own terms. Only the finished image is saved to my Glamify looks. Please only upload photos of yourself, or of people who agreed.'
      : `I agree that my two photos are sent securely to Glamify and to our AI try-on provider${S.provider?.label ? ` (${S.provider.label.replace(/ Virtual Try-On.*$/, '')})` : ''} only to create this image. My photos are deleted as soon as the image is ready. Please only upload photos of yourself, or of people who agreed.`
  }
  function who() {
    const el = $('.at-who'), u = session.user
    if (S.health === 'free-local' || S.health === 'offline' || S.health === null) { el.hidden = true; return }
    el.hidden = false
    el.innerHTML = u ? `Signed in as <b>${esc(u.name || u.email)}</b>. Your looks are saved to your account.`
      : `You are trying as a <b>guest</b>: your looks are kept for ${S.guestHours} hours. <button data-at="signin">Sign in</button> or <button data-at="signup">create an account</button> to keep them.`
  }
  function why() {
    if (S.job) return ''
    if (S.health === 'checking') return 'Checking the AI service&hellip;'
    if (!ready()) return 'AI try-on is not available right now.'
    if (!S.person) return 'Add your photo to continue.'
    if (!S.garment) return 'Add an outfit photo to continue.'
    if (!S.consent) return 'Tick the box above to continue.'
    return isFree() ? 'Free mode: usually 30 seconds to a few minutes, depending on the queue.' : 'Usually takes 10 to 40 seconds.'
  }
  function sync() {
    for (const slot of ['person', 'garment']) {
      const c = card(slot), v = S[slot], img = c.querySelector('img')
      c.classList.toggle('has', !!v); img.hidden = !v; c.querySelector('.at-empty').hidden = !!v; c.querySelector('.at-row').hidden = !v
      if (v && img.src !== v.url) img.src = v.url
      c.querySelectorAll('button, input, select').forEach((b) => { b.disabled = !!S.job })
    }
    $('.at-gen').disabled = !(ready() && S.person && S.garment && S.consent && !S.job); $('.at-why').innerHTML = why()
    root.querySelector('[data-at-consent]').disabled = !!S.job
    who()
  }
  function warn(slot, text) { const w = card(slot).querySelector('.at-warn'); w.textContent = text || ''; w.hidden = !text }

  async function take(slot, file) {
    warn(slot, '')
    try {
      const v = await prepare(file, slot === 'person' ? 'your photo' : 'an outfit photo')
      if (S[slot]) URL.revokeObjectURL(S[slot].url)
      S[slot] = v; hideResult()
      if (slot === 'person' && v.landscape) warn(slot, 'Tip: an upright (portrait) photo showing your body works best.')
    } catch (e) { warn(slot, e.message) }
    sync()
  }

  // ---------------- generation ----------------
  async function generate() {
    if ($('.at-gen').disabled) return
    hideResult(); status('')
    ctl = new AbortController(); S.job = { t0: Date.now(), stage: 'queued' }
    const work = $('.at-work'); work.hidden = false; work.querySelector('img').src = S.person.url; tick(); sync()
    timer = setInterval(tick, 500)
    work.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
    try {
      if (S.health === 'free-local') { const blob = await runFree(); if (S.job && blob) await showResult(blob, null); return }
      const fields = { type: 'outfit', consent: 'true', category: S.category }
      if (S.health === 'server') Object.assign(fields, { person: S.person.blob, garment: S.garment.blob })
      const { job } = await api.generate(fields, ctl.signal)
      S.job.id = job.id
      if (job.status === 'awaiting_client') return await finishFree(job)
      await pollServer(job)
    } catch (e) { if (e.name !== 'AbortError' && S.job) status(`<b>No result.</b> ${esc(e.message)}`, 'error') }
    finally { finish(); loadHistory() }
  }
  async function pollServer(job) {
    const deadline = Date.now() + 6 * 60_000
    while (S.job && Date.now() < deadline) {
      if (job.status === 'succeeded') { await showResult(null, job); return }
      if (job.status === 'failed') throw new Error(job.error?.message || 'The AI could not finish this try-on.')
      S.job.stage = job.stage
      await new Promise((ok) => setTimeout(ok, 2000))
      if (!S.job) return
      job = (await api.status(job.id, ctl.signal)).job
    }
    if (S.job) throw new Error('This is taking too long. Please try again.')
  }
  async function finishFree(job) {
    let blob
    try { blob = await runFree() } catch (e) { await api.fail(job.id, e.code || 'free_error').catch(() => {}); throw e }
    if (!S.job || !blob) { await api.fail(job.id, 'cancelled').catch(() => {}); return }
    S.job.stage = 'saving'
    try { const done = await api.complete(job.id, blob); await showResult(blob, done.job) }
    catch (e) { await showResult(blob, null, `Your look could not be saved to your history (${e.message}). You can still download it now.`) }
  }

  // free mode: IDM-VTON Space, through Hugging Face's official Gradio client (loaded only when used)
  async function runFree() {
    const space = S.provider?.space || FREE_SPACE_DEFAULT
    const file = (blob, name) => new File([blob], name, { type: 'image/jpeg' }) // a File (not a Blob): the client checks for Node's Buffer before Blob
    const fail = (code, message) => Object.assign(new Error(message), { code })
    S.job.stage = 'connecting'
    let gc, app
    try { gc = await import('@gradio/client'); app = await gc.Client.connect(space, { events: ['data', 'status'] }) }
    catch { throw fail('free_unreachable', 'The free AI service (Hugging Face) is not reachable right now. It may be starting up or busy: please try again in a few minutes.') }
    if (!S.job) return null
    S.job.stage = 'uploading'
    const desc = { tops: 'a top', bottoms: 'trousers', 'one-pieces': 'a dress' }[S.category] || 'a garment'
    // same inputs, in the same order, as the Space's "tryon" endpoint: human (image editor), garment, description,
    // auto-mask, auto-crop, denoising steps, seed
    freeJob = app.submit('/tryon', [{ background: gc.handle_file(file(S.person.blob, 'person.jpg')), layers: [], composite: null }, gc.handle_file(file(S.garment.blob, 'garment.jpg')), desc, true, true, 30, 42])
    for await (const msg of freeJob) {
      if (!S.job) return null
      if (msg.type === 'status') {
        if (msg.stage === 'pending') { S.job.stage = 'pending'; S.job.extra = msg.position != null ? `Position ${msg.position + 1} in the queue` + (msg.eta ? `, about ${Math.round(msg.eta)} s` : '') : '' }
        else if (msg.stage === 'generating') { S.job.stage = 'generating'; S.job.extra = '' }
        else if (msg.stage === 'error') {
          const m = msg.message || ''
          if (/quota|exceeded|ZeroGPU|GPU limit/i.test(m)) throw fail('free_quota', 'The free AI service\'s daily limit for your connection is used up. Please try again later (it resets within 24 hours).')
          if (/queue is full|too many/i.test(m)) throw fail('free_busy', 'The free AI service is very busy. Please try again in a few minutes.')
          throw fail('free_error', 'The free AI service could not finish (' + (m || 'unknown error').slice(0, 140) + '). Please try again, ideally with a clear, front-facing photo.')
        }
      } else if (msg.type === 'data') {
        const out = msg.data?.[0], url = out?.url || out?.path
        if (!url) throw fail('free_error', 'The free AI service returned no image. Please try again.')
        const r = await fetch(url); if (!r.ok) throw fail('free_error', 'The generated image could not be downloaded from the free AI service. Please try again.')
        const b = await r.blob()
        if (!/^image\//.test(b.type) && b.size < 1000) throw fail('free_error', 'The free AI service returned something that is not an image.')
        return b
      }
    }
    throw fail('free_error', 'The free AI service stopped without a result. Please try again.')
  }

  function tick() {
    if (!S.job) return
    const s = Math.round((Date.now() - S.job.t0) / 1000)
    $('.at-stage').textContent = STAGE[S.job.stage] || 'Generating your look'
    $('.at-time').textContent = `${s} s elapsed` + (S.job.extra ? ` · ${S.job.extra}` : '')
  }
  function finish() { clearInterval(timer); S.job = null; $('.at-work').hidden = true; sync() }
  function cancel() {
    const id = S.job?.id, wasFree = isFree(); ctl?.abort(); try { freeJob?.cancel?.() } catch { /* already done */ } freeJob = null; finish()
    if (id) (wasFree ? api.fail(id, 'cancelled') : api.remove(id)).catch(() => {})
    status('Cancelled.', 'info')
  }

  async function showResult(blob, job, savedNote) {
    try { if (!blob && job?.result?.url) blob = await (await fetch(await api.imageUrl(job.result.url))).blob() }
    catch (e) { status(`<b>No result.</b> ${esc(e.message)}`, 'error'); return }
    if (S.result) URL.revokeObjectURL(S.result)
    S.result = URL.createObjectURL(blob); S.resultBlob = blob
    const res = $('.at-result'); res.hidden = false
    res.querySelector('.at-after').src = S.result; res.querySelector('.at-before').src = S.person?.url || S.result
    const im = new Image(); im.onload = () => res.querySelector('.at-cmp').style.setProperty('--ar', `${im.width} / ${im.height}`); im.src = S.result
    const saved = res.querySelector('.at-saved')
    saved.hidden = false
    saved.textContent = savedNote || (job ? (session.user ? 'Saved to My looks in your account.' : `Saved to My looks for ${S.guestHours} hours. Sign in to keep it.`) : 'Not saved (the Glamify server is not reachable). Download it to keep it.')
    setSplit(50); res.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }
  function hideResult() { if (S.result) URL.revokeObjectURL(S.result); S.result = null; S.resultBlob = null; $('.at-result').hidden = true }
  function setSplit(v) { const c = $('.at-cmp'); c.style.setProperty('--split', v + '%'); c.querySelector('input').value = v }
  function downloadBlob(blob, name) {
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); a.remove()
    setTimeout(() => URL.revokeObjectURL(a.href), 4000)
  }
  const ext = (b) => (b.type === 'image/png' ? 'png' : b.type === 'image/webp' ? 'webp' : 'jpg')

  // ---------------- My looks (history) ----------------
  async function loadHistory() {
    const box = $('.at-hist')
    if (S.health === 'free-local' || S.health === 'offline' || S.health === 'checking') { box.hidden = true; return }
    let r; try { r = await api.history('outfit') } catch { box.hidden = true; return }
    S.history = r.items; if (r.guestHours) S.guestHours = r.guestHours
    histUrls.forEach((u) => URL.revokeObjectURL(u)); histUrls = []
    box.hidden = !r.items.length; sync()
    $('.at-hist-note').textContent = r.guest ? `Kept for ${S.guestHours} hours on this device. Sign in to keep them longer.` : 'Saved to your account. Only you can see them.'
    const grid = $('.at-hist-grid')
    grid.innerHTML = r.items.map((j) => `<figure class="at-look" data-id="${esc(j.id)}">
        <div class="at-look-img">${j.status === 'succeeded' ? '<span class="at-look-ph">Loading&hellip;</span>' : `<span class="at-look-ph ${j.status === 'failed' ? 'bad' : ''}">${j.status === 'failed' ? 'Not generated' : 'In progress'}</span>`}</div>
        <figcaption><b>${esc(when(j.createdAt))}</b><small>${esc(j.status === 'failed' ? (j.error?.message || 'Failed') : j.provider?.paid ? 'FASHN' : 'Free IDM-VTON')}</small>
        <span class="at-look-act">${j.status === 'succeeded' ? `<button data-look-open="${esc(j.id)}">View</button><button data-look-dl="${esc(j.id)}">Download</button>` : ''}<button data-look-del="${esc(j.id)}" aria-label="Delete this look">Delete</button></span></figcaption></figure>`).join('')
    for (const j of r.items.filter((x) => x.status === 'succeeded')) {
      api.imageUrl(j.result.url).then((u) => {
        histUrls.push(u)
        const slot = grid.querySelector(`[data-id="${j.id}"] .at-look-img`); if (slot) slot.innerHTML = `<img src="${u}" alt="AI look from ${esc(when(j.createdAt))}" loading="lazy">`
      }).catch(() => { const slot = grid.querySelector(`[data-id="${j.id}"] .at-look-img`); if (slot) slot.innerHTML = '<span class="at-look-ph bad">Unavailable</span>' })
    }
  }
  async function lookBlob(id) { const j = S.history?.find((x) => x.id === id); return j && (await (await fetch(await api.imageUrl(j.result.url))).blob()) }

  // ---------------- events ----------------
  root.addEventListener('click', async (e) => {
    const drop = e.target.closest('.at-drop'), b = e.target.closest('[data-at],[data-look-open],[data-look-dl],[data-look-del]')
    if (drop && !b && !S.job) { drop.querySelector('input').click(); return }
    if (!b) return
    if (b.dataset.lookDel) { if (!confirmDelete()) return; b.disabled = true; try { await api.remove(b.dataset.lookDel) } catch (er) { status(esc(er.message), 'error') } return loadHistory() }
    if (b.dataset.lookOpen || b.dataset.lookDl) {
      const id = b.dataset.lookOpen || b.dataset.lookDl
      try { const blob = await lookBlob(id); if (!blob) return; if (b.dataset.lookDl) return downloadBlob(blob, `glamify-look.${ext(blob)}`); await showResult(blob, S.history.find((x) => x.id === id), 'From My looks.') } catch (er) { status(esc(er.message), 'error') }
      return
    }
    const a = b.dataset.at, slot = b.closest('[data-slot]')?.dataset.slot
    if (a === 'close') close()
    else if (a === 'recheck') checkHealth()
    else if (a === 'signin' || a === 'signup') import('../account/account.js').then((m) => m.openAccount(a === 'signin' ? 'login' : 'register'))
    else if (a === 'replace') card(slot).querySelector('input').click()
    else if (a === 'remove') { if (S[slot]) URL.revokeObjectURL(S[slot].url); S[slot] = null; warn(slot, ''); hideResult(); sync() }
    else if (a === 'generate') generate()
    else if (a === 'cancel') cancel()
    else if (a === 'download') { if (S.resultBlob) downloadBlob(S.resultBlob, `glamify-my-look.${ext(S.resultBlob)}`) }
    else if (a === 'another') { S.garment = null; hideResult(); warn('garment', ''); sync(); card('garment').scrollIntoView({ behavior: 'smooth', block: 'center' }) }
    else if (a === 'restart') { S.person = S.garment = null; hideResult(); warn('person', ''); warn('garment', ''); sync(); root.scrollTo({ top: 0, behavior: 'smooth' }) }
  })
  const confirmDelete = () => (typeof window.confirm === 'function' && !window.__glamifyNoConfirm ? window.confirm('Delete this look? This cannot be undone.') : true)
  root.addEventListener('keydown', (e) => { const d = e.target.closest('.at-drop'); if (d && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); if (!S.job) d.querySelector('input').click() } if (e.key === 'Escape') close() })
  root.addEventListener('change', (e) => {
    const t = e.target
    if (t.matches('.at-drop input')) { const slot = t.closest('[data-slot]').dataset.slot; if (t.files[0]) take(slot, t.files[0]); t.value = '' }
    else if (t.matches('[data-at-consent]')) { S.consent = t.checked; sync() }
    else if (t.matches('[data-at-cat]')) S.category = t.value
  })
  root.addEventListener('input', (e) => { if (e.target.matches('.at-cmp input')) setSplit(+e.target.value) })
  root.querySelectorAll('.at-drop').forEach((d) => {
    d.addEventListener('dragover', (e) => { e.preventDefault(); d.classList.add('over') })
    d.addEventListener('dragleave', () => d.classList.remove('over'))
    d.addEventListener('drop', (e) => { e.preventDefault(); d.classList.remove('over'); const f = e.dataTransfer.files[0]; if (f && !S.job) take(d.closest('[data-slot]').dataset.slot, f) })
  })
  // drag the before/after divider directly on the image (mouse and touch)
  const cmp = $('.at-cmp'); let dragging = false
  const moveTo = (e) => { const r = cmp.getBoundingClientRect(); setSplit(Math.max(0, Math.min(100, ((e.clientX - r.left) / r.width) * 100))) }
  cmp.addEventListener('pointerdown', (e) => { if (e.target.matches('input')) return; dragging = true; cmp.setPointerCapture(e.pointerId); moveTo(e) })
  cmp.addEventListener('pointermove', (e) => { if (dragging) moveTo(e) })
  cmp.addEventListener('pointerup', () => { dragging = false })
  // signing in or out changes whose looks are shown
  session.on(() => { if (!root.hidden) { sync(); loadHistory() } })

  function open() {
    opener = document.activeElement; root.hidden = false; document.body.classList.add('at-open'); root.scrollTop = 0
    $('.at-x').focus({ preventScroll: true }); hooks.onOpen?.(); sync()
    if (!ready()) checkHealth(); else loadHistory()
  }
  function close() { if (S.job) cancel(); root.hidden = true; document.body.classList.remove('at-open'); opener?.focus?.({ preventScroll: true }); hooks.onClose?.() }
  return { open, close }
}
