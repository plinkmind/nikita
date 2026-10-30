// Virtual Try-On Studio: overlay UI, render loop, product panel, capture.
import './tryon.css'
import { Camera, describeError } from './camera.js'
import { createTracker, Face } from './face.js'
import { MAKEUP, drawMakeup } from './makeup.js'
import { JEWELLERY, drawJewellery } from './jewellery.js'

const CATS = { makeup: MAKEUP, jewellery: JEWELLERY }
const ALL = [...MAKEUP, ...JEWELLERY]

const TEMPLATE = `
<div class="ts-head"><div><span class="ts-k">Glamify XR</span><h2>Virtual Try-On Studio</h2></div><button class="ts-x" data-a="close" aria-label="Close studio">&times;</button></div>
<div class="ts-body">
  <section class="ts-stage">
    <div class="ts-view">
      <canvas class="ts-out"></canvas><video class="ts-vid" playsinline muted></video>
      <div class="ts-msg"></div><div class="ts-hint" hidden>Looking for your face... move into the frame</div>
      <input class="ts-split" type="range" min="2" max="98" value="50" hidden aria-label="Before and after divider">
    </div>
    <div class="ts-bar">
      <button data-a="start">Start Camera</button><button data-a="stop">Stop Camera</button><button data-a="switch">Switch Camera</button>
      <button data-a="compare">Before / After</button><button data-a="capture">Capture Photo</button><button data-a="download">Download</button>
    </div>
  </section>
  <aside class="ts-panel">
    <div class="ts-tabs"><button data-tab="makeup" class="on">Makeup</button><button data-tab="jewellery">Jewellery</button></div>
    <div class="ts-list"></div>
    <div class="ts-edit" hidden></div>
    <div class="ts-applied"></div>
    <div class="ts-foot"><button data-a="reset">Reset All</button></div>
    <div class="ts-shot" hidden><img alt="Captured try-on"><a download="glamify-try-on.png">Save image</a></div>
  </aside>
</div>`

export function initStudio() {
  const root = document.createElement('div')
  root.className = 'ts'; root.hidden = true; root.setAttribute('role', 'dialog'); root.setAttribute('aria-label', 'Virtual Try-On Studio')
  root.innerHTML = TEMPLATE; document.body.appendChild(root)
  const $ = (s) => root.querySelector(s)
  const out = $('.ts-out'), octx = out.getContext('2d'), vid = $('.ts-vid'), msg = $('.ts-msg'), hint = $('.ts-hint'), split = $('.ts-split')
  const raw = document.createElement('canvas'), fin = document.createElement('canvas')
  const rctx = raw.getContext('2d'), fctx = fin.getContext('2d')
  const cam = new Camera(vid), face = new Face()
  const state = {}
  let tracker = null, trackerTried = false, raf = 0, running = false, tab = 'makeup', sel = null, compare = false

  const say = (t) => { msg.textContent = t || ''; msg.hidden = !t }
  const btn = (a) => $(`[data-a="${a}"]`)

  async function loadTracker() {
    if (tracker || trackerTried) return
    trackerTried = true; say('Loading AI face model...')
    try { tracker = await createTracker(); say('') }
    catch { say('The AI face model could not load. Check your internet connection and reopen the studio. The camera preview still works.') }
  }

  async function start(fn) {
    say('Waiting for camera permission...')
    try { await (fn ? fn() : cam.start()) }
    catch (e) { say(describeError(e)); if (!cam.active) stopLoop(); return }
    running = true; say(''); sync(); loadTracker(); cancelAnimationFrame(raf); loop()
  }
  function stopLoop() { running = false; cancelAnimationFrame(raf); face.reset(); hint.hidden = true; sync() }
  function stop() {
    cam.stop(); stopLoop(); octx.clearRect(0, 0, out.width, out.height)
    say('Camera is off. Press Start Camera to continue.')
  }
  function sync() {
    btn('start').disabled = cam.active; btn('stop').disabled = !cam.active
    btn('switch').disabled = !cam.active; btn('capture').disabled = !cam.active; btn('download').disabled = !cam.active; btn('compare').disabled = !cam.active
  }

  function loop() {
    if (!running) return
    raf = requestAnimationFrame(loop)
    if (vid.readyState < 2 || !vid.videoWidth) return
    const w = vid.videoWidth, h = vid.videoHeight
    if (out.width !== w || out.height !== h) [out, raw, fin].forEach((c) => { c.width = w; c.height = h })
    rctx.save(); if (cam.mirror) { rctx.translate(w, 0); rctx.scale(-1, 1) } rctx.drawImage(vid, 0, 0, w, h); rctx.restore()
    fctx.drawImage(raw, 0, 0)
    let found = false
    if (tracker) {
      const lm = tracker.detectForVideo(vid, performance.now()).faceLandmarks[0]
      if (lm) {
        const M = face.update(lm, w, h, cam.mirror)
        drawMakeup(fctx, M, state, raw); drawJewellery(fctx, M, state, performance.now() / 1000); found = true
      } else face.reset()
    }
    hint.hidden = !tracker || found
    octx.drawImage(fin, 0, 0)
    if (compare) {
      const x = (w * split.value) / 100
      octx.save(); octx.beginPath(); octx.rect(0, 0, x, h); octx.clip(); octx.drawImage(raw, 0, 0); octx.restore()
      octx.fillStyle = '#E2BE7C'; octx.fillRect(x - 1.5, 0, 3, h)
      octx.font = `${Math.round(h * 0.03)}px Figtree, sans-serif`; octx.fillStyle = '#fff'
      octx.fillText('BEFORE', 16, h * 0.06); octx.textAlign = 'right'; octx.fillText('AFTER', w - 16, h * 0.06); octx.textAlign = 'left'
    }
  }

  function snap() { return fin.toDataURL('image/png') }
  function capture() {
    if (!cam.active || !fin.width) return
    const url = snap(), shot = $('.ts-shot')
    shot.querySelector('img').src = url; shot.querySelector('a').href = url; shot.hidden = false
    out.classList.add('flash'); setTimeout(() => out.classList.remove('flash'), 250)
  }
  function download() {
    if (!cam.active || !fin.width) return
    const a = document.createElement('a'); a.download = 'glamify-try-on.png'; a.href = snap(); a.click()
  }

  /* ---- product panel ---- */
  function renderList() {
    $('.ts-list').innerHTML = CATS[tab].map((p) => `<button class="chip${state[p.id] ? ' on' : ''}${sel === p.id ? ' sel' : ''}" data-p="${p.id}">${p.label}</button>`).join('')
    const ed = $('.ts-edit'), p = sel && ALL.find((x) => x.id === sel), st = sel && state[sel]
    if (!p || !st) ed.hidden = true
    else {
      const jew = JEWELLERY.includes(p)
      ed.hidden = false
      ed.innerHTML = `<div class="ts-et">${p.label}</div>
        <div class="ts-sw">${p.shades.map((s, i) => `<button class="sw${i === st.shade ? ' on' : ''}" data-s="${i}" style="background:${s.c}" title="${s.n}" aria-label="${s.n}"></button>`).join('')}</div>
        <div class="ts-sn">${p.shades[st.shade].n}</div>
        <label class="ts-rng">${jew ? 'Size' : 'Intensity'}<input type="range" min="0" max="1" step="0.01" value="${st.v}"></label>
        <button class="ts-rm" data-rm="${p.id}">Remove ${p.label}</button>`
    }
    const ids = Object.keys(state)
    $('.ts-applied').innerHTML = ids.length ? '<span>Applied</span>' + ids.map((id) => `<button class="tag" data-rm="${id}">${ALL.find((x) => x.id === id).label} &times;</button>`).join('') : ''
  }

  root.addEventListener('click', (e) => {
    const t = e.target.closest('button'); if (!t) return
    if (t.dataset.tab) { tab = t.dataset.tab; root.querySelectorAll('.ts-tabs button').forEach((b) => b.classList.toggle('on', b === t)); renderList() }
    else if (t.dataset.p) { const id = t.dataset.p; if (!state[id]) state[id] = { shade: 0, v: ALL.find((x) => x.id === id).v }; sel = id; renderList() }
    else if (t.dataset.s) { state[sel].shade = +t.dataset.s; renderList() }
    else if (t.dataset.rm) { delete state[t.dataset.rm]; if (sel === t.dataset.rm) sel = null; renderList() }
    else if (t.dataset.a) action(t.dataset.a)
  })
  root.addEventListener('input', (e) => { if (e.target.matches('.ts-rng input') && state[sel]) state[sel].v = +e.target.value })

  async function action(a) {
    if (a === 'close') close()
    else if (a === 'start') start()
    else if (a === 'stop') stop()
    else if (a === 'switch') { try { await cam.switch(); face.reset() } catch (e) { say(describeError(e)); setTimeout(() => say(''), 2500) } }
    else if (a === 'compare') { compare = !compare; split.hidden = !compare; btn('compare').classList.toggle('on', compare) }
    else if (a === 'capture') capture()
    else if (a === 'download') download()
    else if (a === 'reset') { Object.keys(state).forEach((k) => delete state[k]); sel = null; renderList() }
  }

  function open() {
    root.hidden = false; document.body.classList.add('studio-open'); renderList(); sync(); start()
  }
  function close() { cam.stop(); stopLoop(); root.hidden = true; document.body.classList.remove('studio-open') }
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !root.hidden) close() })

  return { open, close }
}
