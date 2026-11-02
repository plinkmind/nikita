// AI photo try-on panel (outfits and hairstyles). This is a GENERATED image made by an AI model on a server, not a live overlay.
// Photos are only sent after the person ticks the consent box and presses the button. Nothing here pretends to work without a server.
const API = ((typeof import.meta !== 'undefined' && import.meta.env?.VITE_TRYON_API_URL) || (typeof window !== 'undefined' && window.GLAMIFY_API) || '').replace(/\/$/, '')
const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))
const STYLES = [['h-bob', 'Sculpted bob'], ['h-lob-waves', 'Lob with soft waves'], ['h-fringe-lob', 'Fringed lob'], ['h-curtain', 'Curtain bangs (midi)'], ['h-shag', 'Modern shag'], ['h-shag-bangs', 'Shag with bangs'], ['h-curls', 'Shoulder curls'], ['h-deep-curly', 'Deep curly side-part'], ['h-mermaid', 'Mermaid waves'], ['h-sideswept', 'Side-swept long'], ['h-long', 'Long straight'], ['h-half-up', 'Half-up twisted crown'], ['h-ponytail', 'High ponytail'], ['h-bun', 'Messy bun'], ['h-short', 'Pixie cut']]
const COLOURS = [['natural', 'Keep my colour'], ['black', 'Black'], ['dark-brown', 'Dark brown'], ['chestnut', 'Chestnut'], ['auburn', 'Auburn'], ['blonde', 'Honey blonde'], ['platinum', 'Platinum'], ['burgundy', 'Burgundy'], ['copper', 'Copper'], ['ash', 'Ash grey'], ['rose', 'Rose pink']]

// reads a photo, validates it and shrinks it (max 1280 px, JPEG) so uploads are small and fast
async function prepare(file) {
  if (!/^image\/(jpeg|png|webp)$/.test(file.type)) throw new Error('Please choose a JPG, PNG or WebP photo.')
  if (file.size > 15e6) throw new Error('That photo is larger than 15 MB. Please choose a smaller one.')
  const bmp = await createImageBitmap(file), k = Math.min(1, 1280 / Math.max(bmp.width, bmp.height))
  const c = document.createElement('canvas'); c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k)
  const x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height); x.drawImage(bmp, 0, 0, c.width, c.height)
  return c.toDataURL('image/jpeg', 0.88)
}

export function initPhoto(box, hooks = {}) {
  const S = { caps: null, mode: 'outfit', person: null, garment: null, style: 'h-bob', colour: 'natural', consent: false, health: null, job: null, result: null, err: '', before: false }
  let timer = 0, poll = 0, ctl = null

  async function checkServer() {
    S.health = 'checking'; draw()
    try {
      const c = new AbortController(), t = setTimeout(() => c.abort(), 6000)
      const r = await fetch(`${API}/api/health`, { signal: c.signal }); clearTimeout(t)
      const j = r.ok ? await r.json() : null
      S.health = j?.ok && j.configured ? 'ready' : j?.ok ? 'unconfigured' : 'offline'; S.caps = j || null
    } catch { S.health = 'offline' }
    draw()
  }
  const modeReady = () => S.health === 'ready' && (!S.caps?.[S.mode] || S.caps[S.mode].ready !== false) // older servers do not report per-mode readiness
  const ready = () => modeReady() && S.person && S.consent && (S.mode === 'hair' || S.garment) && !S.job

  function draw() {
    const busy = !!S.job
    let head = ''
    if (S.health === 'checking' || S.health === null) head = '<p class="ts-note">Checking the AI server...</p>'
    else if (S.health === 'ready' && !modeReady()) head = `<p class="ts-warn"><b>AI ${S.mode === 'outfit' ? 'outfit' : 'hairstyle'} try-on is not set up on the server yet.</b> The site owner can enable it with the steps in the README.</p>`
    else if (S.health !== 'ready') head = `<p class="ts-warn"><b>AI photo try-on is not available yet.</b> ${S.health === 'unconfigured' ? 'The server is running, but no AI service has been set up on it.' : 'There is no AI server connected to this website.'} The live camera try-on still works. The site owner can set this up with the steps in the README.</p><button class="chip" data-ph="recheck">Check again</button>`
    box.innerHTML = `<div class="ts-grp"><h3>AI photo try-on</h3><p class="ts-note"><b>This makes a generated image</b> using an AI model on a server. It is not a live preview, and results can differ from the real garment or hairstyle.</p>${head}</div>
      <div class="ts-opt"><span>What do you want to try?</span><div class="ts-chips"><button class="chip${S.mode === 'outfit' ? ' on' : ''}" data-ph="mode:outfit"${busy ? ' disabled' : ''}>Outfit</button><button class="chip${S.mode === 'hair' ? ' on' : ''}" data-ph="mode:hair"${busy ? ' disabled' : ''}>Hairstyle</button></div></div>
      <div class="ts-opt"><span>1. Your photo${S.mode === 'outfit' ? ' (upper body or full body, facing the camera)' : ' (clear face and hair, facing the camera)'}</span>
        <label class="ts-up">${S.person ? 'Change photo' : 'Choose your photo'}<input type="file" accept="image/png,image/jpeg,image/webp" data-ph-file="person"${busy ? ' disabled' : ''}></label>${S.person ? `<img class="ph-prev" src="${S.person}" alt="Your photo">` : ''}</div>
      ${S.mode === 'outfit' ? `<div class="ts-opt"><span>2. The garment (a clear photo of the clothing, ideally on a plain background)</span>
        <label class="ts-up">${S.garment ? 'Change garment' : 'Choose garment photo'}<input type="file" accept="image/png,image/jpeg,image/webp" data-ph-file="garment"${busy ? ' disabled' : ''}></label>${S.garment ? `<img class="ph-prev" src="${S.garment}" alt="Garment">` : ''}</div>`
      : `<div class="ts-opt"><span>2. Hairstyle</span><div class="ts-chips">${STYLES.map(([id, l]) => `<button class="chip${S.style === id ? ' on' : ''}" data-ph="style:${id}"${busy ? ' disabled' : ''}>${l}</button>`).join('')}</div></div>
         <div class="ts-opt"><label class="lk-pick" style="display:grid"><span style="font-size:12px;color:#D3CABD;letter-spacing:.08em;text-transform:uppercase">Hair colour</span><select data-ph-colour${busy ? ' disabled' : ''}>${COLOURS.map(([id, l]) => `<option value="${id}"${S.colour === id ? ' selected' : ''}>${l}</option>`).join('')}</select></label></div>`}
      <label class="ph-consent"><input type="checkbox" data-ph-consent${S.consent ? ' checked' : ''}${busy ? ' disabled' : ''}><span>I agree to send my photo${S.mode === 'outfit' ? 's' : ''} to Glamify's server and to its AI provider${({ fashn: ' (FASHN)', replicate: ' (Replicate)', google: ' (Google Cloud)' })[S.caps?.[S.mode]?.provider] || ''} to create this image. Glamify does not keep the photos, and the result is deleted after I get it (or after 10 minutes). The provider processes the photos under its own terms.</span></label>
      <div class="ts-row">${busy ? `<button class="chip on" disabled>AI is working... ${S.job.sec}s</button><button class="chip" data-ph="cancel">Cancel</button>` : `<button class="chip${ready() ? ' on' : ''}" data-ph="go"${ready() ? '' : ' disabled'}>Create AI try-on</button>`}</div>
      ${busy ? '<p class="ts-note">This usually takes 10 to 90 seconds on the server. The time shown is the real time elapsed, not an estimate of progress.</p>' : ''}
      ${S.err ? `<p class="ts-warn" role="alert">${esc(S.err)}</p>` : ''}
      ${S.result ? `<div class="ts-grp"><h3>Your AI-generated result</h3><div class="ph-cmp"><img src="${S.before ? S.person : S.result}" alt="${S.before ? 'Your original photo' : 'AI-generated result'}"><span class="ph-tag">${S.before ? 'ORIGINAL' : 'AI-GENERATED'}</span></div>
        <div class="ts-row"><button class="chip" data-ph="toggle">${S.before ? 'Show AI result' : 'Show original'}</button><a class="chip" href="${S.result}" download="glamify-ai-tryon.png">Download</a><button class="chip" data-ph="save">Save to Saved</button><button class="chip" data-ph="reset">Start over</button></div></div>` : ''}`
  }

  async function run() {
    S.err = ''; S.result = null; S.before = false
    const body = { type: S.mode, person: S.person, consent: true, ...(S.mode === 'outfit' ? { garment: S.garment } : { style: S.style, colour: S.colour }) }
    ctl = new AbortController(); S.job = { id: null, t0: Date.now(), sec: 0 }; draw()
    timer = setInterval(() => { if (S.job) { S.job.sec = Math.round((Date.now() - S.job.t0) / 1000); draw() } }, 1000)
    try {
      const r = await fetch(`${API}/api/tryon`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: ctl.signal })
      const j = await r.json().catch(() => ({}))
      if (r.status !== 202) throw new Error(j.error || 'The server could not start the try-on.')
      S.job.id = j.jobId
      const deadline = Date.now() + 4 * 60_000
      while (S.job && Date.now() < deadline) {
        await new Promise((ok) => (poll = setTimeout(ok, 2000)))
        if (!S.job) return // cancelled
        const p = await (await fetch(`${API}/api/tryon/${j.jobId}`, { signal: ctl.signal })).json()
        if (p.status === 'done') { S.result = `data:${p.result.mimeType};base64,${p.result.base64}`; break }
        if (p.status === 'error' || (!p.status && p.error)) throw new Error(p.error || 'The AI could not finish this try-on.')
        if (p.code === 'gone') throw new Error('The result is no longer available. Please try again.')
      }
      if (!S.result && S.job) throw new Error('This is taking too long. Please try again with a smaller photo.')
    } catch (e) { if (e.name !== 'AbortError') S.err = e.message || 'Something went wrong.' }
    clearInterval(timer); S.job = null; draw()
  }
  function cancel() { clearTimeout(poll); clearInterval(timer); ctl?.abort(); if (S.job?.id) fetch(`${API}/api/tryon/${S.job.id}`, { method: 'DELETE' }).catch(() => {}); S.job = null; draw() }

  box.addEventListener('click', (e) => {
    const b = e.target.closest('[data-ph]'); if (!b) return
    const [k, v] = b.dataset.ph.split(':')
    if (k === 'mode') { S.mode = v; S.result = null; S.err = '' } else if (k === 'style') S.style = v
    else if (k === 'go' && ready()) return run()
    else if (k === 'cancel') return cancel()
    else if (k === 'toggle') S.before = !S.before
    else if (k === 'recheck') return checkServer()
    else if (k === 'reset') { Object.assign(S, { person: null, garment: null, result: null, err: '', consent: false, before: false }) }
    else if (k === 'save') { hooks.save?.(S.result, S.mode === 'outfit' ? 'AI outfit' : 'AI hairstyle'); S.err = '' }
    draw()
  })
  box.addEventListener('change', async (e) => {
    const f = e.target.closest('[data-ph-file]')
    if (f && f.files[0]) { try { S[f.dataset.phFile] = await prepare(f.files[0]); S.err = ''; S.result = null } catch (er) { S.err = er.message } draw(); return }
    if (e.target.matches('[data-ph-consent]')) { S.consent = e.target.checked; draw() }
    if (e.target.matches('[data-ph-colour]')) { S.colour = e.target.value }
  })
  return { setMode(m) { if (m !== S.mode) { S.mode = m; S.result = null; S.err = '' } }, show() { if (S.health === null || S.health === 'offline') checkServer(); else draw() }, hide() { if (S.job) cancel() }, state: S }
}
