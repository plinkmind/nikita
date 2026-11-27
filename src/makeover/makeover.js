// AI PHOTO MAKEOVER: a personal AI makeup artist for a PHOTO (separate from the live camera mirror in src/tryon/ and from the
// outfit-only "See It On You" in src/aitryon/, which are unchanged).
//
// The customer uploads her photo, uploads or describes her outfit, optionally picks an occasion and writes what she wants.
// The backend (backend/src/services/makeover.js) then:
//   1. puts the outfit on her photo first (FASHN, when an outfit photo is given and FASHN is set up),
//   2. lets an AI stylist (vision model) read the outfit and her photo and write a complete makeup / hair / jewellery plan,
//   3. lets an AI image editor apply that plan to her REAL photo and return a NEW photograph.
// This page uploads, shows progress, then shows the generated photo with a before/after slider and the AI's plan.
// Nothing is drawn or overlaid here: if the AI is not set up or fails, the page says so and shows no result.
import '../aitryon/aitryon.css'
import './makeover.css'
import { api, session } from '../api/client.js'

const MAX_BYTES = 15 * 1024 * 1024, MIN_SIDE = 300, LONG_EDGE = 1280 // ~1280 px keeps each photo well under 1 MB for the AI services
const OCCASIONS = [['wedding', 'Wedding'], ['bridal', 'Bridal'], ['reception', 'Reception'], ['engagement', 'Engagement'], ['diwali', 'Diwali'], ['holi', 'Holi'], ['birthday', 'Birthday'], ['party', 'Party'], ['office', 'Office'], ['casual', 'Casual']]
const EXAMPLES = ['Red bridal lehenga with golden embroidery', 'Black evening gown', 'Pastel pink engagement saree', 'Emerald green silk saree with gold border', 'White linen shirt and blue jeans']
const MAKEUP = [['foundation', 'Foundation'], ['concealer', 'Concealer'], ['contour', 'Contour'], ['blush', 'Blush'], ['highlighter', 'Highlighter'], ['eyeshadow', 'Eyeshadow'], ['eyeliner', 'Eyeliner'], ['mascara', 'Mascara'], ['brows', 'Brows'], ['lipstick', 'Lipstick'], ['lip_finish', 'Lip finish']]
const STAGES = [['outfit', 'Putting your outfit on your photo'], ['analysing', 'AI stylist is reading your outfit'], ['styling', 'Applying your makeup']]
const STAGE_TEXT = { queued: 'Preparing your photos', retrying: 'The AI is busy, retrying', ...Object.fromEntries(STAGES) }
const NOTES = {
  outfit_not_placed: 'Your outfit photo was used to choose the makeup, but it was not put on your photo (the AI could not place it). Your photo shows your own clothes.',
  outfit_by_editor: 'Your outfit was put on your photo by the AI image editor.',
  stylist_fallback: 'The backup AI stylist created this plan.',
}
const esc = (t) => String(t ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))
const when = (d) => { try { return new Date(d).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) } catch { return '' } }

// reads a photo, checks it, fixes phone rotation, shrinks it to a JPEG (preview URL + Blob for upload)
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
  return { url: URL.createObjectURL(blob), blob }
}

const TEMPLATE = `
<div class="at-head">
  <div><span class="at-k">Glamify<span class="full"> &middot; Your personal AI makeup artist</span></span><h2>AI Photo Makeover</h2></div>
  <button class="at-x" data-mk="close" aria-label="Close">&times;</button>
</div>
<div class="at-body">
  <p class="at-intro">Upload your photo, tell us what you're wearing, and let AI create your perfect look. Our AI stylist reads your outfit and chooses your foundation, eyes, lips, blush, hairstyle and jewellery, then an AI image editor creates a <b>new photo of you</b> wearing the complete look.</p>
  <div class="at-status" role="status" hidden></div>
  <div class="at-who" hidden></div>
  <form class="mk-form" novalidate>
    <div class="at-grid">
      <section class="at-card" data-slot="person">
        <div class="at-card-h"><span class="at-n">A</span><div><h3>Upload your photo</h3><p>A clear, well-lit photo of your face (head and shoulders or more), looking at the camera. One person, 18+.</p></div></div>
        <div class="at-drop" tabindex="0" role="button" aria-label="Choose your photo"><input type="file" accept="image/jpeg,image/png,image/webp" hidden>
          <div class="at-empty"><span class="at-ico">&#9786;</span><b>Choose your photo</b><small>or drop it here &middot; JPG, PNG, WebP</small></div>
          <img alt="Your photo" hidden></div>
        <div class="at-row" hidden><button type="button" data-mk="replace">Replace</button><button type="button" data-mk="remove">Remove</button></div>
        <p class="at-warn" hidden></p>
      </section>
      <section class="at-card mk-outfit">
        <div class="at-card-h"><span class="at-n">B</span><div><h3>Your outfit</h3><p>Upload a photo of the outfit, describe it, or both.</p></div></div>
        <div class="mk-tabs" role="tablist"><button type="button" role="tab" data-mk-tab="photo" class="on" aria-selected="true">Upload outfit photo</button><button type="button" role="tab" data-mk-tab="text" aria-selected="false">Describe your outfit</button></div>
        <div class="mk-pane" data-pane="photo" data-slot="garment">
          <div class="at-drop" tabindex="0" role="button" aria-label="Choose the outfit photo"><input type="file" accept="image/jpeg,image/png,image/webp" hidden>
            <div class="at-empty"><span class="at-ico">&#10070;</span><b>Choose an outfit photo</b><small>lehenga, saree, gown, dress, suit...</small></div>
            <img alt="Outfit photo" hidden></div>
          <div class="at-row" hidden><button type="button" data-mk="replace">Replace</button><button type="button" data-mk="remove">Remove</button></div>
          <p class="at-warn" hidden></p>
        </div>
        <div class="mk-pane" data-pane="text" hidden>
          <label class="mk-lab" for="mk-outfit">What are you wearing?</label>
          <textarea id="mk-outfit" name="outfitText" maxlength="300" rows="4" placeholder="e.g. Red bridal lehenga with golden embroidery"></textarea>
          <div class="mk-ex">${EXAMPLES.map((e) => `<button type="button" data-ex="${esc(e)}">${esc(e)}</button>`).join('')}</div>
        </div>
        <p class="mk-have"></p>
      </section>
    </div>
    <section class="at-card mk-prefs">
      <div class="at-card-h"><span class="at-n">C</span><div><h3>Occasion <small>(optional)</small></h3></div></div>
      <div class="mk-occ" role="radiogroup" aria-label="Occasion">${OCCASIONS.map(([v, l]) => `<button type="button" role="radio" aria-checked="false" data-occ="${v}">${l}</button>`).join('')}</div>
      <div class="at-card-h"><span class="at-n">D</span><div><h3>Your instructions <small>(optional)</small></h3></div></div>
      <textarea name="instructions" maxlength="600" rows="3" aria-label="Your instructions" placeholder="Tell AI what kind of look you want... e.g. I want elegant bridal makeup with golden eyes, defined eyeliner, glowing skin and deep red lipstick."></textarea>
      <div class="mk-opts"><label><input type="checkbox" name="hair" checked> Style my hair to match</label><label><input type="checkbox" name="jewellery" checked> Add matching jewellery</label></div>
    </section>
    <label class="at-consent"><input type="checkbox" name="consent"><span class="mk-consent-t"></span></label>
    <div class="at-go"><button type="submit" class="at-gen" disabled><span>&#10022; Create My AI Look</span></button><p class="at-why"></p></div>
  </form>
  <section class="at-work mk-work" hidden aria-live="polite">
    <div class="at-scan"><img alt=""><i></i></div>
    <div><p class="at-stage"></p><ol class="mk-steps"></ol><p class="at-time"></p><button type="button" data-mk="cancel">Cancel</button></div>
  </section>
  <section class="at-result mk-result" hidden>
    <h3>Your AI Makeover Is Ready!</h3>
    <p class="mk-look"></p>
    <div class="mk-res-grid">
      <div class="mk-pair"><figure><img class="mk-orig" alt="Your original photo"><figcaption>Original</figcaption></figure><figure><img class="mk-new" alt="Your AI makeover"><figcaption>AI makeover</figcaption></figure></div>
      <div class="at-cmp"><img class="at-after" alt="Your AI makeover"><div class="at-before-wrap"><img class="at-before" alt="Your original photo"></div><div class="at-handle"><span></span></div>
        <span class="at-tag l">BEFORE</span><span class="at-tag r">AFTER &middot; AI</span><input type="range" min="0" max="100" value="50" aria-label="Before and after divider"></div>
    </div>
    <div class="mk-notes"></div>
    <div class="mk-plan"></div>
    <p class="at-note">AI-generated image. The AI keeps your features, but small details can differ from real life.</p>
    <p class="at-saved" hidden></p>
    <div class="at-actions"><button class="at-primary" data-mk="download">Download My Look</button><button data-mk="save">Save My Look</button><button data-mk="another">Try Another Makeup</button><button data-mk="edit">Edit My Instructions</button><button data-mk="restart">Create Another Look</button></div>
  </section>
  <section class="at-hist" hidden>
    <div class="at-hist-h"><h3>My makeovers</h3><p class="at-hist-note"></p></div>
    <div class="at-hist-grid"></div>
  </section>
</div>`

export function initMakeover(hooks = {}) {
  const root = document.createElement('div')
  root.className = 'at mk'; root.hidden = true; root.setAttribute('role', 'dialog'); root.setAttribute('aria-label', 'AI Photo Makeover')
  root.innerHTML = TEMPLATE; document.body.appendChild(root)
  const $ = (s) => root.querySelector(s), form = $('.mk-form'), slot = (n) => root.querySelector(`[data-slot="${n}"]`)
  const S = { check: null, person: null, garment: null, occasion: '', setup: null, health: null, job: null, result: null, resultBlob: null, resultJob: null, history: null, guestHours: 24, avoid: '' }
  let timer = 0, ctl = null, opener = null, histUrls = []

  const status = (html, kind = 'info') => { const el = $('.at-status'); el.innerHTML = html || ''; el.className = 'at-status ' + kind; el.hidden = !html }
  // Status: 1) is the Glamify server there, 2) is the key set, 3) does Replicate accept the key and are the models available
  // (a live check on the server: GET /api/makeover/check, nothing is generated). "Check again" runs all three again; with
  // `npm run dev` the server re-reads .env by itself, so a key added to .env works without a restart.
  const LOCAL = /^(localhost|127\.|0\.0\.0\.0|10\.|192\.168\.|\[::1\])/.test(location.hostname)
  const again = '<button type="button" data-mk="recheck">Check again</button>'
  function problem(c) {
    const t = c?.token, bad = [c?.editor, c?.stylist].find((m) => m && !m.ok), d = (x) => (x?.detail ? ` (${esc(x.detail)})` : '')
    if (!t?.ok) {
      if (t?.code === 'provider_auth') return `Replicate rejected the API token${d(t)}. Copy it again from replicate.com &rsaquo; Account &rsaquo; API tokens${LOCAL ? ', paste it into .env and save' : ' and update it in the hosting settings'}.`
      if (t?.code === 'provider_billing') return 'The Replicate account has no credit. Add billing at replicate.com &rsaquo; Account &rsaquo; Billing.'
      if (t?.code === 'provider_unreachable' || t?.code === 'provider_timeout') return 'The Glamify server cannot reach Replicate (internet connection, firewall or proxy on the server).'
      return `Replicate could not be checked: ${esc(t?.code || 'unknown error')}${d(t)}.`
    }
    if (bad?.code === 'inputs_changed') return `The AI model ${esc(bad.model)} no longer accepts ${esc((bad.missing || []).join(', '))}. Choose another model (README section S).`
    if (bad) return `The AI model ${esc(bad.model)} is not available: ${esc(bad.code)}${d(bad)}.`
    return ''
  }
  async function checkHealth() {
    S.health = 'checking'; S.check = null; status('Checking the AI services&hellip;'); sync()
    try {
      const h = await api.health(); S.setup = h.tryon?.makeover || null; S.guestHours = h.limits?.guestHours || 24
      S.health = S.setup?.ready ? 'ready' : 'off'
    } catch (e) { S.setup = null; S.health = e.code === 'offline' ? 'offline' : 'noserver' }
    if (S.health === 'ready') {
      try { S.check = (await api.makeoverCheck()).check; if (!S.check.ready) S.health = 'broken' }
      catch (e) { if (e.status !== 429) { S.health = 'broken'; S.check = { token: { ok: false, code: e.code } } } }
    }
    const miss = esc((S.setup?.missing || ['REPLICATE_API_TOKEN']).join(' and '))
    if (S.health === 'off') status(`<b>AI Photo Makeover is not switched on: ${miss} is not set on the server.</b> ${LOCAL ? 'Put it in the <code>.env</code> file in the project folder (next to package.json), save the file, then press Check again.' : 'The site owner needs to add it to the hosting settings (Netlify: Environment variables) and redeploy.'} ${again}`, 'warn')
    else if (S.health === 'broken') status(`<b>AI Photo Makeover is set up but not working.</b> ${problem(S.check)} ${again}`, 'error')
    else if (S.health === 'noserver') status(`<b>This page is not connected to the Glamify server.</b> ${LOCAL ? 'Start it with <code>npm run dev</code> and open the address it prints (http://localhost:5173). VS Code Live Server or a double-clicked index.html has no server.' : 'The AI service is not available at this address.'} ${again}`, 'warn')
    else if (S.health === 'offline') status(`<b>The Glamify server cannot be reached.</b> Check your internet connection and try again. ${again}`, 'warn')
    else status(`<b>AI connected.</b> Ready to create your look (${esc(S.setup?.stylist || 'AI stylist')} + ${esc(S.setup?.editor || 'AI image editor')}).`, 'ok')
    consentText(); sync(); loadHistory()
  }
  function consentText() {
    const s = S.setup, who = [s?.stylist && `the AI stylist (${s.stylist})`, s?.editor && `the AI image editor (${s.editor})`, s?.outfitPhoto === 'fashn' && 'the outfit try-on service (FASHN)'].filter(Boolean)
    $('.mk-consent-t').textContent = `I agree that my photos and text are sent securely to Glamify and to ${who.length ? who.join(', ') : 'its AI services'} only to create this look. My photos are deleted as soon as the image is ready. I am 18 or older, and I only upload photos of myself or of adults who agreed.`
  }
  function who() {
    const el = $('.at-who'), u = session.user
    if (S.health !== 'ready') { el.hidden = true; return }
    el.hidden = false
    el.innerHTML = u ? `Signed in as <b>${esc(u.name || u.email)}</b>. Your makeovers are saved to your account.`
      : `You are a <b>guest</b>: your makeovers are kept for ${S.guestHours} hours. <button type="button" data-mk="signin">Sign in</button> or <button type="button" data-mk="signup">create an account</button> to keep them.`
  }
  const outfitText = () => form.outfitText.value.trim()
  function why() {
    if (S.job) return ''
    if (S.health === 'checking') return 'Checking the AI services&hellip;'
    if (S.health === 'broken') return 'The AI service needs attention (see the message above).'
    if (S.health !== 'ready') return 'AI Photo Makeover is not available right now.'
    if (!S.person) return 'Add your photo (A) to continue.'
    if (!S.garment && outfitText().length < 3) return 'Upload your outfit photo or describe your outfit (B).'
    if (!form.consent.checked) return 'Tick the box above to continue.'
    return 'Usually 20 to 60 seconds.'
  }
  function sync() {
    for (const n of ['person', 'garment']) {
      const c = slot(n), v = S[n], img = c.querySelector('img')
      c.classList.toggle('has', !!v); img.hidden = !v; c.querySelector('.at-empty').hidden = !!v; c.querySelector('.at-row').hidden = !v
      if (v && img.src !== v.url) img.src = v.url
    }
    $('.mk-outfit').classList.toggle('has', !!(S.garment || outfitText().length >= 3))
    $('.mk-have').textContent = S.garment && outfitText().length >= 3 ? 'Using your outfit photo and your description.' : S.garment ? 'Using your outfit photo.' : outfitText().length >= 3 ? 'Using your description.' : ''
    form.querySelectorAll('button, input, textarea').forEach((el) => { if (!el.matches('.at-gen')) el.disabled = !!S.job })
    root.querySelectorAll('[data-occ]').forEach((b) => { const on = b.dataset.occ === S.occasion; b.classList.toggle('on', on); b.setAttribute('aria-checked', on) })
    $('.at-gen').disabled = !!S.job || why() !== 'Usually 20 to 60 seconds.'
    $('.at-why').innerHTML = why(); who()
  }
  const warn = (n, t) => { const w = slot(n).querySelector('.at-warn'); w.textContent = t || ''; w.hidden = !t }
  async function take(n, file) {
    warn(n, '')
    try { const v = await prepare(file, n === 'person' ? 'your photo' : 'an outfit photo'); if (S[n]) URL.revokeObjectURL(S[n].url); S[n] = v }
    catch (e) { warn(n, e.message) }
    sync()
  }
  function tab(t) {
    root.querySelectorAll('[data-mk-tab]').forEach((b) => { const on = b.dataset.mkTab === t; b.classList.toggle('on', on); b.setAttribute('aria-selected', on) })
    root.querySelectorAll('.mk-pane').forEach((p) => { p.hidden = p.dataset.pane !== t })
  }

  // ---------------- generation ----------------
  async function generate() {
    if ($('.at-gen').disabled) return
    hideResult(); status('')
    ctl = new AbortController(); S.job = { t0: Date.now(), stage: 'queued' }
    const work = $('.mk-work'); work.hidden = false; work.querySelector('img').src = S.person.url; tick(); sync()
    timer = setInterval(tick, 500); work.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
    try {
      const fields = { consent: 'true', person: S.person.blob, garment: S.garment?.blob || null, outfitText: outfitText(), occasion: S.occasion, instructions: form.instructions.value.trim(), hair: form.hair.checked, jewellery: form.jewellery.checked, avoid: S.avoid }
      let { job } = await api.makeover(fields, ctl.signal)
      S.job.id = job.id; S.job.outfit = !!S.garment && S.setup?.outfitPhoto === 'fashn'
      const deadline = Date.now() + 8 * 60_000
      while (S.job && Date.now() < deadline) {
        if (job.status === 'succeeded') { await showResult(job); return }
        if (job.status === 'failed') throw Object.assign(new Error(job.error?.message || 'The AI could not finish this makeover.'), { detail: job.error?.detail })
        S.job.stage = job.stage; tick()
        await new Promise((ok) => setTimeout(ok, 1800))
        if (!S.job) return
        job = (await api.makeoverStatus(job.id, ctl.signal)).job
      }
      if (S.job) throw new Error('This is taking too long. Please try again.')
    } catch (e) { if (e.name !== 'AbortError' && S.job) status(`<b>No makeover was created.</b> ${esc(e.message)}${e.detail ? `<br><small>Reason from the AI service: ${esc(e.detail)}</small>` : ''}`, 'error') }
    finally { finish(); loadHistory() }
  }
  function tick() {
    if (!S.job) return
    const st = S.job.stage, steps = STAGES.filter(([k]) => k !== 'outfit' || S.job.outfit), cur = steps.findIndex(([k]) => k === st)
    $('.at-stage').textContent = STAGE_TEXT[st] || 'Creating your look'
    $('.mk-steps').innerHTML = steps.map(([k, l], i) => `<li class="${i < cur ? 'done' : i === cur ? 'now' : ''}">${l}</li>`).join('')
    $('.at-time').textContent = `${Math.round((Date.now() - S.job.t0) / 1000)} s elapsed`
  }
  function finish() { clearInterval(timer); S.job = null; $('.mk-work').hidden = true; sync() }
  function cancel() { const id = S.job?.id; ctl?.abort(); finish(); if (id) api.remove(id).catch(() => {}); status('Cancelled.', 'info') }

  // ---------------- result ----------------
  async function showResult(job, origUrl) {
    let blob
    try { blob = await (await fetch(await api.imageUrl(job.result.url))).blob() } catch (e) { status(`<b>No result.</b> ${esc(e.message)}`, 'error'); return }
    if (S.result) URL.revokeObjectURL(S.result)
    S.result = URL.createObjectURL(blob); S.resultBlob = blob; S.resultJob = job
    const res = $('.mk-result'), orig = origUrl || S.person?.url || S.result
    res.hidden = false
    res.querySelector('.at-after').src = res.querySelector('.mk-new').src = S.result
    res.querySelector('.at-before').src = res.querySelector('.mk-orig').src = orig
    const im = new Image(); im.onload = () => res.querySelector('.at-cmp').style.setProperty('--ar', `${im.width} / ${im.height}`); im.src = S.result
    const p = job.plan || {}
    res.querySelector('.mk-look').innerHTML = p.lookName ? `<b>${esc(p.lookName)}</b>${p.why ? ` &middot; ${esc(p.why)}` : ''}` : ''
    res.querySelector('.mk-notes').innerHTML = (job.notes || []).filter((n) => NOTES[n]).map((n) => `<p class="${n === 'outfit_not_placed' ? 'warn' : ''}">${esc(NOTES[n])}</p>`).join('')
    const o = p.outfit || {}, m = p.makeup || {}, opt = job.options || {}
    res.querySelector('.mk-plan').innerHTML = `
      <section><h4>The outfit AI saw</h4><p>${esc(o.summary || opt.outfitText || 'Your outfit')}</p>
        ${o.colours?.length ? `<p class="mk-chips">${o.colours.map((c) => `<span>${esc(c)}</span>`).join('')}</p>` : ''}
        ${[o.fabric, o.details].filter(Boolean).map((t) => `<p class="mk-sub">${esc(t)}</p>`).join('')}
        ${p.skin?.tone ? `<p class="mk-sub">Skin as seen in this photo: ${esc(p.skin.tone)}${p.skin.lighting ? `, ${esc(p.skin.lighting)}` : ''}</p>` : ''}</section>
      <section><h4>Makeup the AI chose</h4><dl>${MAKEUP.filter(([k]) => m[k]).map(([k, l]) => `<div><dt>${l}</dt><dd>${esc(m[k])}</dd></div>`).join('')}</dl></section>
      <section><h4>Hairstyle</h4><p>${esc(p.hair || '-')}${opt.hair === false ? ' <i>(your hair was kept as it is)</i>' : ''}</p>
        <h4>Jewellery &amp; accessories</h4><p>${esc([p.jewellery, p.accessories].filter((x) => x && !/^none\b/i.test(x)).join('; ') || 'None')}${opt.jewellery === false ? ' <i>(not added to the photo)</i>' : ''}</p></section>`
    const saved = res.querySelector('.at-saved'); saved.hidden = false
    saved.textContent = session.user ? 'Saved to My makeovers in your account.' : `Saved to My makeovers for ${S.guestHours} hours. Use "Save My Look" to keep it.`
    $('[data-mk="save"]').textContent = session.user ? 'Saved ✓' : 'Save My Look'
    setSplit(50); res.scrollIntoView({ behavior: 'smooth', block: 'start' })
    if (!origUrl) status('<b>Done.</b> Your new photo is ready below.', 'ok')
  }
  function hideResult() { if (S.result) URL.revokeObjectURL(S.result); S.result = null; S.resultBlob = null; S.resultJob = null; $('.mk-result').hidden = true }
  const setSplit = (v) => { const c = $('.at-cmp'); c.style.setProperty('--split', v + '%'); c.querySelector('input').value = v }
  function download(blob, name) { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000) }
  const ext = (b) => (b.type === 'image/png' ? 'png' : b.type === 'image/webp' ? 'webp' : 'jpg')

  // ---------------- My makeovers ----------------
  async function loadHistory() {
    const box = $('.at-hist')
    if (['offline', 'noserver', 'checking'].includes(S.health)) { box.hidden = true; return }
    let r; try { r = await api.history('makeover') } catch { box.hidden = true; return }
    S.history = r.items; histUrls.forEach((u) => URL.revokeObjectURL(u)); histUrls = []
    box.hidden = !r.items.length
    $('.at-hist-note').textContent = r.guest ? `Kept for ${S.guestHours} hours on this device. Sign in to keep them.` : 'Saved to your account. Only you can see them.'
    const grid = $('.at-hist-grid')
    grid.innerHTML = r.items.map((j) => `<figure class="at-look" data-id="${esc(j.id)}">
        <div class="at-look-img">${j.status === 'succeeded' ? '<span class="at-look-ph">Loading&hellip;</span>' : `<span class="at-look-ph ${j.status === 'failed' ? 'bad' : ''}">${j.status === 'failed' ? 'Not created' : 'In progress'}</span>`}</div>
        <figcaption><b>${esc(j.plan?.lookName || when(j.createdAt))}</b><small>${esc(j.status === 'failed' ? (j.error?.message || 'Failed') : `${when(j.createdAt)}${j.options?.outfitText ? ' · ' + j.options.outfitText : ''}`)}</small>
        <span class="at-look-act">${j.status === 'succeeded' ? `<button data-look-open="${esc(j.id)}">View</button><button data-look-dl="${esc(j.id)}">Download</button>` : ''}<button data-look-del="${esc(j.id)}" aria-label="Delete this makeover">Delete</button></span></figcaption></figure>`).join('')
    for (const j of r.items.filter((x) => x.status === 'succeeded')) {
      api.imageUrl(j.result.url).then((u) => { histUrls.push(u); const s = grid.querySelector(`[data-id="${j.id}"] .at-look-img`); if (s) s.innerHTML = `<img src="${u}" alt="AI makeover from ${esc(when(j.createdAt))}" loading="lazy">` })
        .catch(() => { const s = grid.querySelector(`[data-id="${j.id}"] .at-look-img`); if (s) s.innerHTML = '<span class="at-look-ph bad">Unavailable</span>' })
    }
  }

  // ---------------- events ----------------
  root.addEventListener('click', async (e) => {
    const drop = e.target.closest('.at-drop'), b = e.target.closest('[data-mk],[data-mk-tab],[data-occ],[data-ex],[data-look-open],[data-look-dl],[data-look-del]')
    if (drop && !b && !S.job) { drop.querySelector('input').click(); return }
    if (!b) return
    if (b.dataset.mkTab) return tab(b.dataset.mkTab)
    if (b.dataset.occ) { S.occasion = S.occasion === b.dataset.occ ? '' : b.dataset.occ; return sync() }
    if (b.dataset.ex) { form.outfitText.value = b.dataset.ex; return sync() }
    if (b.dataset.lookDel) { if (window.confirm && !window.__glamifyNoConfirm && !window.confirm('Delete this makeover? This cannot be undone.')) return; try { await api.remove(b.dataset.lookDel) } catch (er) { status(esc(er.message), 'error') } return loadHistory() }
    if (b.dataset.lookOpen || b.dataset.lookDl) {
      const j = S.history?.find((x) => x.id === (b.dataset.lookOpen || b.dataset.lookDl)); if (!j) return
      try { if (b.dataset.lookDl) { const blob = await (await fetch(await api.imageUrl(j.result.url))).blob(); return download(blob, `glamify-makeover.${ext(blob)}`) } await showResult(j, null) } catch (er) { status(esc(er.message), 'error') }
      return
    }
    const a = b.dataset.mk, n = b.closest('[data-slot]')?.dataset.slot
    if (a === 'close') close()
    else if (a === 'recheck') checkHealth()
    else if (a === 'signin' || a === 'signup') import('../account/account.js').then((m) => m.openAccount(a === 'signin' ? 'login' : 'register'))
    else if (a === 'replace') slot(n).querySelector('input').click()
    else if (a === 'remove') { if (S[n]) URL.revokeObjectURL(S[n].url); S[n] = null; warn(n, ''); sync() }
    else if (a === 'cancel') cancel()
    else if (a === 'download') { if (S.resultBlob) download(S.resultBlob, `glamify-my-ai-look.${ext(S.resultBlob)}`) }
    // results are saved automatically (account: kept; guest: for a few hours). Saving permanently needs an account:
    // looks made as a guest move into the account when the visitor signs up or signs in.
    else if (a === 'save') { if (session.user) { $('.at-saved').textContent = 'Saved to My makeovers in your account.'; b.textContent = 'Saved ✓' } else import('../account/account.js').then((m) => m.openAccount('register')) }
    else if (a === 'another') { S.avoid = S.resultJob?.plan?.lookName || ''; if (S.person) generate() }
    else if (a === 'edit') { hideResult(); S.avoid = ''; const t = form.instructions; t.scrollIntoView({ behavior: 'smooth', block: 'center' }); setTimeout(() => t.focus({ preventScroll: true }), 400) }
    else if (a === 'restart') { for (const k of ['person', 'garment']) { if (S[k]) URL.revokeObjectURL(S[k].url); S[k] = null; warn(k, '') } form.reset(); S.occasion = ''; S.avoid = ''; hideResult(); tab('photo'); sync(); root.scrollTo({ top: 0, behavior: 'smooth' }) }
  })
  form.addEventListener('submit', (e) => { e.preventDefault(); S.avoid = ''; generate() })
  form.addEventListener('input', () => sync())
  root.addEventListener('keydown', (e) => { const d = e.target.closest('.at-drop'); if (d && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); if (!S.job) d.querySelector('input').click() } if (e.key === 'Escape') close() })
  root.addEventListener('change', (e) => { const t = e.target; if (t.matches('.at-drop input')) { const n = t.closest('[data-slot]').dataset.slot; if (t.files[0]) take(n, t.files[0]); t.value = '' } else sync() })
  root.addEventListener('input', (e) => { if (e.target.matches('.at-cmp input')) setSplit(+e.target.value) })
  root.querySelectorAll('.at-drop').forEach((d) => {
    d.addEventListener('dragover', (e) => { e.preventDefault(); d.classList.add('over') })
    d.addEventListener('dragleave', () => d.classList.remove('over'))
    d.addEventListener('drop', (e) => { e.preventDefault(); d.classList.remove('over'); const f = e.dataTransfer.files[0]; if (f && !S.job) take(d.closest('[data-slot]').dataset.slot, f) })
  })
  const cmp = $('.at-cmp'); let dragging = false
  const moveTo = (e) => { const r = cmp.getBoundingClientRect(); setSplit(Math.max(0, Math.min(100, ((e.clientX - r.left) / r.width) * 100))) }
  cmp.addEventListener('pointerdown', (e) => { if (e.target.matches('input')) return; dragging = true; cmp.setPointerCapture(e.pointerId); moveTo(e) })
  cmp.addEventListener('pointermove', (e) => { if (dragging) moveTo(e) })
  cmp.addEventListener('pointerup', () => { dragging = false })
  session.on(() => { if (!root.hidden) { sync(); loadHistory(); if (S.resultJob) { $('.at-saved').textContent = session.user ? 'Saved to My makeovers in your account.' : $('.at-saved').textContent; if (session.user) $('[data-mk="save"]').textContent = 'Saved ✓' } } })

  function open() {
    opener = document.activeElement; root.hidden = false; document.body.classList.add('at-open'); root.scrollTop = 0
    $('.at-x').focus({ preventScroll: true }); hooks.onOpen?.(); sync()
    if (S.health !== 'ready') checkHealth(); else loadHistory()
  }
  function close() { if (S.job) cancel(); root.hidden = true; document.body.classList.remove('at-open'); opener?.focus?.({ preventScroll: true }); hooks.onClose?.() }
  return { open, close }
}
