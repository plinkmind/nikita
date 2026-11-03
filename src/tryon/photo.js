// "AI Photo" tab of the live studio. This makes a GENERATED image with an AI model (not a live overlay).
//  - Outfits: handled by the separate "See It On You" page (free or paid AI, with history), opened from here.
//  - Hairstyles: sent to the Glamify backend (POST /api/tryon/generate with type=hair), which uses FLUX Kontext on Replicate
//    when the site owner has set REPLICATE_API_TOKEN. There is no free hairstyle AI service to rely on (HairFastGAN is a research
//    demo without a stable API, see TRACKING-AUDIT.md Update 13); without the key this tab says so.
// Photos are only sent after the person ticks the consent box and presses the button.
import { api } from '../api/client.js'

const esc = (t) => String(t ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))
const STYLES = [['h-bob', 'Sculpted bob'], ['h-lob-waves', 'Lob with soft waves'], ['h-fringe-lob', 'Fringed lob'], ['h-curtain', 'Curtain bangs (midi)'], ['h-shag', 'Modern shag'], ['h-shag-bangs', 'Shag with bangs'], ['h-curls', 'Shoulder curls'], ['h-deep-curly', 'Deep curly side-part'], ['h-mermaid', 'Mermaid waves'], ['h-sideswept', 'Side-swept long'], ['h-long', 'Long straight'], ['h-half-up', 'Half-up twisted crown'], ['h-ponytail', 'High ponytail'], ['h-bun', 'Messy bun'], ['h-short', 'Pixie cut']]
const COLOURS = [['natural', 'Keep my colour'], ['black', 'Black'], ['dark-brown', 'Dark brown'], ['chestnut', 'Chestnut'], ['auburn', 'Auburn'], ['blonde', 'Honey blonde'], ['platinum', 'Platinum'], ['burgundy', 'Burgundy'], ['copper', 'Copper'], ['ash', 'Ash grey'], ['rose', 'Rose pink']]

// reads a photo, validates it and shrinks it (max 1280 px, JPEG) so uploads are small and fast
async function prepare(file) {
  if (!/^image\/(jpeg|png|webp)$/.test(file.type)) throw new Error('Please choose a JPG, PNG or WebP photo.')
  if (file.size > 15e6) throw new Error('That photo is larger than 15 MB. Please choose a smaller one.')
  const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' }), k = Math.min(1, 1280 / Math.max(bmp.width, bmp.height))
  if (Math.min(bmp.width, bmp.height) < 300) throw new Error('That photo is too small. Please use one at least 300 pixels on each side.')
  const c = document.createElement('canvas'); c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k)
  const x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height); x.drawImage(bmp, 0, 0, c.width, c.height)
  const blob = await new Promise((ok) => c.toBlob(ok, 'image/jpeg', 0.88))
  return { blob, url: URL.createObjectURL(blob) }
}

export function initPhoto(box, hooks = {}) {
  const S = { mode: 'outfit', person: null, style: 'h-bob', colour: 'natural', consent: false, health: null, hairReady: false, job: null, result: null, resultBlob: null, err: '', before: false }
  let timer = 0, ctl = null

  async function checkServer() {
    S.health = 'checking'; draw()
    try { const h = await api.health(); S.hairReady = !!h.tryon?.hair?.ready; S.health = 'ok' } catch { S.health = 'offline' }
    draw()
  }
  const ready = () => S.health === 'ok' && S.hairReady && S.person && S.consent && !S.job

  function draw() {
    const busy = !!S.job
    const tabs = `<div class="ts-opt"><span>What do you want to try?</span><div class="ts-chips"><button class="chip${S.mode === 'outfit' ? ' on' : ''}" data-ph="mode:outfit"${busy ? ' disabled' : ''}>Outfit</button><button class="chip${S.mode === 'hair' ? ' on' : ''}" data-ph="mode:hair"${busy ? ' disabled' : ''}>Hairstyle</button></div></div>`
    const intro = '<div class="ts-grp"><h3>AI photo try-on</h3><p class="ts-note"><b>This makes a generated image</b> with an AI model. It is not a live preview, and results can differ from the real garment or hairstyle.</p></div>'
    if (S.mode === 'outfit') {
      box.innerHTML = intro + tabs + `<div class="ts-grp"><p class="ts-note">AI outfit try-on has its own page, <b>See It On You</b>: upload your photo and an outfit photo, and your looks are saved to <b>My looks</b>. It works for free.</p><div class="ts-chips"><button class="chip on" data-ph="free">Open See It On You</button></div></div>`
      return
    }
    let head = ''
    if (S.health === 'checking' || S.health === null) head = '<p class="ts-note">Checking the AI service...</p>'
    else if (S.health === 'offline') head = '<p class="ts-warn"><b>The Glamify server cannot be reached.</b> Check your connection. The live camera try-on still works.</p><button class="chip" data-ph="recheck">Check again</button>'
    else if (!S.hairReady) head = '<p class="ts-warn"><b>AI hairstyles are not switched on for this website.</b> They need a paid image-editing AI service (free research demos exist but have no stable service to build on); the site owner can switch it on (README, section O). Live <b>hair colour</b> in the Hair tab works without it.</p>'
    box.innerHTML = intro + tabs + `<div class="ts-grp">${head}</div>
      <div class="ts-opt"><span>1. Your photo (clear face and hair, facing the camera)</span>
        <label class="ts-up">${S.person ? 'Change photo' : 'Choose your photo'}<input type="file" accept="image/png,image/jpeg,image/webp" data-ph-file="person"${busy ? ' disabled' : ''}></label>${S.person ? `<img class="ph-prev" src="${S.person.url}" alt="Your photo">` : ''}</div>
      <div class="ts-opt"><span>2. Hairstyle</span><div class="ts-chips">${STYLES.map(([id, l]) => `<button class="chip${S.style === id ? ' on' : ''}" data-ph="style:${id}"${busy ? ' disabled' : ''}>${l}</button>`).join('')}</div></div>
      <div class="ts-opt"><label class="lk-pick" style="display:grid"><span style="font-size:12px;color:#D3CABD;letter-spacing:.08em;text-transform:uppercase">Hair colour</span><select data-ph-colour${busy ? ' disabled' : ''}>${COLOURS.map(([id, l]) => `<option value="${id}"${S.colour === id ? ' selected' : ''}>${l}</option>`).join('')}</select></label></div>
      <label class="ph-consent"><input type="checkbox" data-ph-consent${S.consent ? ' checked' : ''}${busy ? ' disabled' : ''}><span>I agree to send my photo to Glamify and its AI provider (Replicate) only to create this image. My photo is deleted as soon as the image is ready; the result is saved to my looks.</span></label>
      <div class="ts-row">${busy ? `<button class="chip on" disabled>AI is working... ${S.job.sec}s</button><button class="chip" data-ph="cancel">Cancel</button>` : `<button class="chip${ready() ? ' on' : ''}" data-ph="go"${ready() ? '' : ' disabled'}>Create AI hairstyle</button>`}</div>
      ${busy ? '<p class="ts-note">This usually takes 10 to 60 seconds. The time shown is the real time elapsed.</p>' : ''}
      ${S.err ? `<p class="ts-warn" role="alert">${esc(S.err)}</p>` : ''}
      ${S.result ? `<div class="ts-grp"><h3>Your AI-generated result</h3><div class="ph-cmp"><img src="${S.before ? S.person.url : S.result}" alt="${S.before ? 'Your original photo' : 'AI-generated result'}"><span class="ph-tag">${S.before ? 'ORIGINAL' : 'AI-GENERATED'}</span></div>
        <div class="ts-row"><button class="chip" data-ph="toggle">${S.before ? 'Show AI result' : 'Show original'}</button><a class="chip" href="${S.result}" download="glamify-ai-hairstyle.jpg">Download</a><button class="chip" data-ph="save">Save to Saved</button><button class="chip" data-ph="reset">Start over</button></div></div>` : ''}`
  }

  async function run() {
    S.err = ''; S.result = null; S.before = false
    ctl = new AbortController(); S.job = { id: null, t0: Date.now(), sec: 0 }; draw()
    timer = setInterval(() => { if (S.job) { S.job.sec = Math.round((Date.now() - S.job.t0) / 1000); draw() } }, 1000)
    try {
      let { job } = await api.generate({ type: 'hair', consent: 'true', style: S.style, colour: S.colour, person: S.person.blob }, ctl.signal)
      S.job.id = job.id
      const deadline = Date.now() + 5 * 60_000
      while (S.job && job.status !== 'succeeded' && job.status !== 'failed' && Date.now() < deadline) {
        await new Promise((ok) => setTimeout(ok, 2000)); if (!S.job) return
        job = (await api.status(job.id, ctl.signal)).job
      }
      if (job.status === 'failed') throw new Error(job.error?.message || 'The AI could not finish this try-on.')
      if (job.status !== 'succeeded') throw new Error('This is taking too long. Please try again.')
      S.result = await api.imageUrl(job.result.url)
    } catch (e) { if (e.name !== 'AbortError') S.err = e.message || 'Something went wrong.' }
    clearInterval(timer); S.job = null; draw()
  }
  function cancel() { const id = S.job?.id; clearInterval(timer); ctl?.abort(); if (id) api.remove(id).catch(() => {}); S.job = null; draw() }

  box.addEventListener('click', (e) => {
    const b = e.target.closest('[data-ph]'); if (!b) return
    const [k, v] = b.dataset.ph.split(':')
    if (k === 'mode') { S.mode = v; S.result = null; S.err = ''; if (v === 'hair' && S.health !== 'ok') return checkServer() } else if (k === 'style') S.style = v
    else if (k === 'go' && ready()) return run()
    else if (k === 'cancel') return cancel()
    else if (k === 'toggle') S.before = !S.before
    else if (k === 'recheck') return checkServer()
    else if (k === 'free') { document.querySelector('[data-aitryon]')?.click(); return }
    else if (k === 'reset') { Object.assign(S, { person: null, result: null, err: '', consent: false, before: false }) }
    else if (k === 'save') { hooks.save?.(S.result, 'AI hairstyle'); S.err = '' }
    draw()
  })
  box.addEventListener('change', async (e) => {
    const f = e.target.closest('[data-ph-file]')
    if (f && f.files[0]) { try { S.person = await prepare(f.files[0]); S.err = ''; S.result = null } catch (er) { S.err = er.message } draw(); return }
    if (e.target.matches('[data-ph-consent]')) { S.consent = e.target.checked; draw() }
    if (e.target.matches('[data-ph-colour]')) { S.colour = e.target.value }
  })
  return { setMode(m) { if (m !== S.mode) { S.mode = m; S.result = null; S.err = '' } }, show() { if (S.mode === 'hair' && S.health !== 'ok') checkServer(); else draw() }, hide() { if (S.job) cancel() }, state: S }
}
