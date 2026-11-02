// "See It On You" - AI photo-based virtual outfit try-on.
// A GENERATED image made by a dedicated virtual try-on model (FASHN tryon-v1.6) on the server side
// (netlify/functions/tryon.mjs). Nothing here composites or overlays images: the result shown is the image the AI returned,
// and if the AI service is not set up or fails, the page says so and shows no result.
// Separate from the live camera studio (src/tryon/), which stays unchanged.
import './aitryon.css'

const API = ((import.meta.env?.VITE_TRYON_API_URL) || '').replace(/\/$/, '')
// FREE mode: the public IDM-VTON research demo on Hugging Face (https://huggingface.co/spaces/yisol/IDM-VTON), called from the
// visitor's own browser with Hugging Face's official client. No key and no cost, but: shared free GPUs (queues, a daily limit per
// visitor), a NON-COMMERCIAL licence (CC BY-NC-SA 4.0), and it is trained on upper-body garments (tops work best).
// Set VITE_FREE_TRYON=off to disable it, or VITE_FREE_TRYON_SPACE to point at another copy of the Space.
const FREE_SPACE = (import.meta.env?.VITE_FREE_TRYON_SPACE || 'yisol/IDM-VTON').trim(), FREE_ON = import.meta.env?.VITE_FREE_TRYON !== 'off'
const MAX_BYTES = 15 * 1024 * 1024, MIN_SIDE = 300, LONG_EDGE = 1536
const CATS = [['auto', 'Detect automatically'], ['tops', 'Top / shirt / jacket'], ['bottoms', 'Bottoms'], ['one-pieces', 'Dress / full outfit']]
const STAGE = { starting: 'Preparing your photos', in_queue: 'Waiting for the AI', processing: 'Generating your look', connecting: 'Connecting to the free AI service', uploading: 'Sending your photos', pending: 'Waiting in the free queue', generating: 'Generating your look' }
const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))

// Reads a user photo, checks it, fixes phone rotation (EXIF), shrinks it and returns a JPEG data URL + size info.
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
  return { url: c.toDataURL('image/jpeg', 0.9), w: c.width, h: c.height, landscape: bmp.width > bmp.height * 1.05 }
}

const TEMPLATE = `
<div class="at-head">
  <div><span class="at-k">Glamify Mirror Me<span class="full"> &middot; AI Virtual Try-On</span></span><h2>See It On You</h2></div>
  <button class="at-x" data-at="close" aria-label="Close">&times;</button>
</div>
<div class="at-body">
  <p class="at-intro">Upload a photo of yourself and a photo of any outfit. Our AI virtual try-on model creates a <b>new image</b> of you wearing it. This is a generated image, not the live camera mirror.</p>
  <div class="at-status" role="status"></div>
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
    <div class="at-actions"><button class="at-primary" data-at="download">Download result</button><button data-at="another">Try another outfit</button><button data-at="restart">Start over</button></div>
  </section>
</div>`

export function initAiTryOn(hooks = {}) {
  const root = document.createElement('div')
  root.className = 'at'; root.hidden = true; root.setAttribute('role', 'dialog'); root.setAttribute('aria-label', 'See It On You, AI virtual try-on')
  root.innerHTML = TEMPLATE; document.body.appendChild(root)
  const $ = (s) => root.querySelector(s), card = (slot) => root.querySelector(`[data-slot="${slot}"]`)
  const S = { person: null, garment: null, category: 'auto', consent: false, health: null, job: null, result: null }
  let timer = 0, pollT = 0, ctl = null, opener = null

  function status(html, kind = 'info') { const el = $('.at-status'); el.innerHTML = html || ''; el.className = 'at-status ' + kind; el.hidden = !html }
  async function checkHealth() {
    S.health = 'checking'; status('Checking the AI service&hellip;'); sync()
    try {
      const c = new AbortController(), t = setTimeout(() => c.abort(), 8000)
      const r = await fetch(`${API}/api/health`, { signal: c.signal }); clearTimeout(t)
      const j = r.ok ? await r.json() : null
      S.health = j?.outfit?.ready ? 'ready' : j?.ok ? 'off' : 'offline'
    } catch { S.health = 'offline' }
    if (S.health !== 'ready' && FREE_ON) S.health = 'free' // no paid key on the server: use the free Hugging Face demo
    modeText()
    if (S.health === 'ready' || S.health === 'free') status('')
    else if (S.health === 'off') status('<b>AI outfit try-on is not switched on yet.</b> The website owner needs to add the AI provider key (see README, section M). You can still use the live camera try-on. <button data-at="recheck">Check again</button>', 'warn')
    else status('<b>The AI service cannot be reached.</b> Check your internet connection and try again. (When running the site locally with <code>npm run dev</code> there is no AI backend: use <code>npx netlify-cli dev</code>.) <button data-at="recheck">Check again</button>', 'warn')
    sync()
  }
  function modeText() {
    const free = S.health === 'free', m = $('.at-mode')
    m.hidden = !free
    m.innerHTML = free ? '<b>Free mode.</b> Uses the free public <a href="https://huggingface.co/spaces/yisol/IDM-VTON" target="_blank" rel="noopener">IDM-VTON</a> research demo on Hugging Face: it can queue, has a small daily limit per visitor, and works best with <b>tops, shirts and jackets</b> (dresses and trousers may not transfer fully). Research licence: not for commercial use.' : ''
    $('.at-consent-t').textContent = free
      ? 'I agree that my two photos are sent from my browser to the free IDM-VTON demo on Hugging Face only to create this image. Glamify does not receive or store them. Hugging Face processes them under its own terms. Please only upload photos of yourself, or of people who agreed.'
      : 'I agree that my two photos are sent securely to our AI try-on provider (FASHN) only to create this image. Glamify does not store them. Please only upload photos of yourself, or of people who agreed.'
  }
  function why() {
    if (S.job) return ''
    if (S.health === 'checking') return 'Checking the AI service&hellip;'
    if (S.health !== 'ready' && S.health !== 'free') return 'AI try-on is not available right now.'
    if (!S.person) return 'Add your photo to continue.'
    if (!S.garment) return 'Add an outfit photo to continue.'
    if (!S.consent) return 'Tick the box above to continue.'
    return S.health === 'free' ? 'Free mode: usually 30 seconds to a few minutes, depending on the queue.' : 'Usually takes 10 to 40 seconds.'
  }
  function sync() {
    for (const slot of ['person', 'garment']) {
      const c = card(slot), v = S[slot], img = c.querySelector('img')
      c.classList.toggle('has', !!v); img.hidden = !v; c.querySelector('.at-empty').hidden = !!v; c.querySelector('.at-row').hidden = !v
      if (v && img.src !== v.url) img.src = v.url
      c.querySelectorAll('button, input, select').forEach((b) => { b.disabled = !!S.job })
    }
    const ok = (S.health === 'ready' || S.health === 'free') && S.person && S.garment && S.consent && !S.job
    $('.at-gen').disabled = !ok; $('.at-why').innerHTML = why()
    root.querySelector('[data-at-consent]').disabled = !!S.job
  }
  function warn(slot, text) { const w = card(slot).querySelector('.at-warn'); w.textContent = text || ''; w.hidden = !text }

  async function take(slot, file) {
    warn(slot, '')
    try {
      const v = await prepare(file, slot === 'person' ? 'your photo' : 'an outfit photo')
      S[slot] = v; hideResult()
      if (slot === 'person' && v.landscape) warn(slot, 'Tip: an upright (portrait) photo showing your body works best.')
    } catch (e) { warn(slot, e.message) }
    sync()
  }

  async function generate() {
    if ($('.at-gen').disabled) return
    hideResult(); status('')
    ctl = new AbortController(); S.job = { t0: Date.now(), stage: 'starting' }
    const work = $('.at-work'); work.hidden = false; work.querySelector('img').src = S.person.url; tick(); sync()
    timer = setInterval(tick, 500)
    work.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
    try {
      if (S.health === 'free') { const url = await runFree(); if (S.job && url) showResult(url); finish(); return }
      const r = await fetch(`${API}/api/tryon`, { method: 'POST', headers: { 'content-type': 'application/json' }, signal: ctl.signal,
        body: JSON.stringify({ type: 'outfit', person: S.person.url, garment: S.garment.url, category: S.category, consent: true }) })
      const j = await r.json().catch(() => ({}))
      if (r.status !== 202 || !j.jobId) throw new Error(j.error || 'The AI service could not start. Please try again.')
      S.job.id = j.jobId
      const deadline = Date.now() + 3 * 60_000
      while (S.job && Date.now() < deadline) {
        await new Promise((ok) => (pollT = setTimeout(ok, 2000)))
        if (!S.job) return
        const p = await (await fetch(`${API}/api/tryon/${j.jobId}`, { signal: ctl.signal })).json().catch(() => ({}))
        if (p.status === 'running') { S.job.stage = p.stage || 'processing'; continue }
        if (p.status === 'done' && p.result?.base64) { showResult(`data:${p.result.mimeType || 'image/jpeg'};base64,${p.result.base64}`); break }
        if (p.status === 'error' || p.error) throw new Error(p.error || 'The AI could not finish this try-on.')
      }
      if (S.job && !S.result) throw new Error('This is taking too long. Please try again.')
    } catch (e) { if (e.name !== 'AbortError' && S.job) status(`<b>No result.</b> ${esc(e.message)}`, 'error') }
    finish()
  }

  // ---- free mode: IDM-VTON Space, through Hugging Face's official Gradio client (loaded only when used) ----
  let freeJob = null
  async function runFree() {
    // a File (not a plain Blob): the Gradio client checks for Node's Buffer before Blob, which breaks in browsers
    const blob = async (dataUrl, name) => new File([await (await fetch(dataUrl)).blob()], name, { type: 'image/jpeg' })
    S.job.stage = 'connecting'
    let gc, app
    try { gc = await import('@gradio/client'); app = await gc.Client.connect(FREE_SPACE, { events: ['data', 'status'] }) }
    catch { throw new Error('The free AI service (Hugging Face) is not reachable right now. It may be starting up or busy: please try again in a few minutes.') }
    if (!S.job) return null
    S.job.stage = 'uploading'
    const desc = { tops: 'a top', bottoms: 'trousers', 'one-pieces': 'a dress' }[S.category] || 'a garment'
    // same inputs, in the same order, as the Space's "tryon" endpoint: human (image editor), garment, description,
    // auto-mask, auto-crop, denoising steps, seed
    freeJob = app.submit('/tryon', [{ background: gc.handle_file(await blob(S.person.url, 'person.jpg')), layers: [], composite: null }, gc.handle_file(await blob(S.garment.url, 'garment.jpg')), desc, true, true, 30, 42])
    for await (const msg of freeJob) {
      if (!S.job) return null
      if (msg.type === 'status') {
        if (msg.stage === 'pending') { S.job.stage = 'pending'; S.job.extra = msg.position != null ? `Position ${msg.position + 1} in the queue` + (msg.eta ? `, about ${Math.round(msg.eta)} s` : '') : '' }
        else if (msg.stage === 'generating') { S.job.stage = 'generating'; S.job.extra = '' }
        else if (msg.stage === 'error') throw new Error(freeError(msg.message))
      } else if (msg.type === 'data') {
        const out = msg.data?.[0], url = out?.url || out?.path
        if (!url) throw new Error('The free AI service returned no image. Please try again.')
        try { const r = await fetch(url); if (!r.ok) throw 0; const b = await r.blob(); return await new Promise((ok) => { const f = new FileReader(); f.onload = () => ok(f.result); f.readAsDataURL(b) }) }
        catch { return url } // could not copy the image locally: show it from Hugging Face directly
      }
    }
    throw new Error('The free AI service stopped without a result. Please try again.')
  }
  function freeError(m = '') {
    if (/quota|exceeded|ZeroGPU|GPU limit/i.test(m)) return 'The free AI service\'s daily limit for your connection is used up. Please try again later (it resets within 24 hours).'
    if (/queue is full|too many/i.test(m)) return 'The free AI service is very busy. Please try again in a few minutes.'
    return 'The free AI service could not finish (' + (m || 'unknown error').slice(0, 140) + '). Please try again, ideally with a clear, front-facing photo.'
  }
  function tick() {
    if (!S.job) return
    const s = Math.round((Date.now() - S.job.t0) / 1000)
    $('.at-stage').textContent = STAGE[S.job.stage] || 'Generating your look'
    $('.at-time').textContent = `${s} s elapsed` + (S.job.extra ? ` · ${S.job.extra}` : '')
  }
  function finish() { clearInterval(timer); clearTimeout(pollT); S.job = null; $('.at-work').hidden = true; sync() }
  function cancel() { const id = S.job?.id; ctl?.abort(); try { freeJob?.cancel?.() } catch { /* already done */ } freeJob = null; finish(); if (id) fetch(`${API}/api/tryon/${id}`, { method: 'DELETE' }).catch(() => {}); status('Cancelled.', 'info') }

  function showResult(url) {
    S.result = url
    const res = $('.at-result'); res.hidden = false
    res.querySelector('.at-after').src = url; res.querySelector('.at-before').src = S.person.url
    const im = new Image(); im.onload = () => res.querySelector('.at-cmp').style.setProperty('--ar', `${im.width} / ${im.height}`); im.src = url
    setSplit(50); res.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }
  function hideResult() { S.result = null; $('.at-result').hidden = true }
  function setSplit(v) { const c = $('.at-cmp'); c.style.setProperty('--split', v + '%'); c.querySelector('input').value = v }
  function download() {
    if (!S.result) return
    if (!S.result.startsWith('data:')) { const a = document.createElement('a'); a.href = S.result; a.download = 'glamify-my-look.png'; a.target = '_blank'; a.rel = 'noopener'; document.body.appendChild(a); a.click(); a.remove(); return }
    const [h, b64] = S.result.split(','), bin = atob(b64), u8 = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i)
    const blob = new Blob([u8], { type: /image\/png/.test(h) ? 'image/png' : 'image/jpeg' }), a = document.createElement('a')
    a.href = URL.createObjectURL(blob); a.download = `glamify-my-look.${/png/.test(h) ? 'png' : 'jpg'}`; document.body.appendChild(a); a.click(); a.remove()
    setTimeout(() => URL.revokeObjectURL(a.href), 4000)
  }

  // ---- events ----
  root.addEventListener('click', (e) => {
    const drop = e.target.closest('.at-drop'), b = e.target.closest('[data-at]')
    if (drop && !b && !S.job) { drop.querySelector('input').click(); return }
    if (!b) return
    const a = b.dataset.at, slot = b.closest('[data-slot]')?.dataset.slot
    if (a === 'close') close()
    else if (a === 'recheck') checkHealth()
    else if (a === 'replace') card(slot).querySelector('input').click()
    else if (a === 'remove') { S[slot] = null; warn(slot, ''); hideResult(); sync() }
    else if (a === 'generate') generate()
    else if (a === 'cancel') cancel()
    else if (a === 'download') download()
    else if (a === 'another') { S.garment = null; hideResult(); warn('garment', ''); sync(); card('garment').scrollIntoView({ behavior: 'smooth', block: 'center' }) }
    else if (a === 'restart') { S.person = S.garment = null; hideResult(); warn('person', ''); warn('garment', ''); sync(); root.scrollTo({ top: 0, behavior: 'smooth' }) }
  })
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

  function open() {
    opener = document.activeElement; root.hidden = false; document.body.classList.add('at-open'); root.scrollTop = 0
    $('.at-x').focus({ preventScroll: true }); hooks.onOpen?.(); sync()
    if (S.health !== 'ready') checkHealth()
  }
  function close() { if (S.job) cancel(); root.hidden = true; document.body.classList.remove('at-open'); opener?.focus?.({ preventScroll: true }); hooks.onClose?.() }
  return { open, close }
}
