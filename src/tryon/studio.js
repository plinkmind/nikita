// Virtual Try-On Studio: overlay UI, render loop, product panel, capture.
import './tryon.css'
import { Camera, describeError } from './camera.js'
import { createTracker, createPoseTracker, Face } from './face.js'
import { drawMakeup } from './makeup.js'
import { JEWELLERY, drawJewellery } from './jewellery.js'
import { ALL_PRODUCTS as ALL, groupsOf, findProduct, categoryOf, iconOf } from './catalog.js'
import { getLooks, saveLook, deleteLook, getFavs, isFav, toggleFav } from './looks.js'

const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))

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
    <div class="ts-tabs"><button data-tab="makeup" class="on">Makeup</button><button data-tab="jewellery">Jewellery</button><button data-tab="saved">Saved</button><button data-tab="compare">Compare</button></div>
    <div class="ts-list"></div>
    <div class="ts-edit" hidden></div>
    <div class="ts-looks" hidden></div>
    <div class="ts-applied"></div>
    <div class="ts-foot"><button data-a="savelook">Save Look</button><button data-a="reset">Reset All</button></div>
    <div class="ts-shot" hidden><img alt="Captured try-on"><a download="glamify-try-on.png">Save image</a><button data-a="share" hidden>Share</button></div>
  </aside>
</div>`

export function initStudio(hooks = {}) {
  const root = document.createElement('div')
  root.className = 'ts'; root.hidden = true; root.setAttribute('role', 'dialog'); root.setAttribute('aria-label', 'Virtual Try-On Studio')
  root.innerHTML = TEMPLATE; document.body.appendChild(root)
  const $ = (s) => root.querySelector(s)
  const out = $('.ts-out'), octx = out.getContext('2d'), vid = $('.ts-vid'), msg = $('.ts-msg'), hint = $('.ts-hint'), split = $('.ts-split')
  const raw = document.createElement('canvas'), fin = document.createElement('canvas')
  const rctx = raw.getContext('2d'), fctx = fin.getContext('2d')
  const cam = new Camera(vid), face = new Face()
  const state = {}
  const phone = matchMedia('(pointer:coarse)').matches || Math.min(screen.width, screen.height) < 700
  const DETECT_MS = phone ? 45 : 0 // phones: run the face model about 22x/second instead of every frame
  let tracker = null, trackerTried = false, raf = 0, running = false, tab = 'makeup', sel = null, compare = false
  let lastDetect = 0, lastLm = null, lastOpener = null
  // keep drawing the last known face for a moment if tracking drops for a frame or two (stops jewellery flickering away)
  const HOLD_MS = 300
  let lastM = null, lastSeen = 0
  // shoulders (for necklaces) come from the pose model, which is only downloaded when a necklace is applied
  let poseT = null, poseTried = false, lastPose = 0, shoulders = null
  const needNeck = () => !!(state.necklace || state.chain || state.pendant)
  const lerpP = (a, b) => ({ x: a.x + (b.x - a.x) * 0.4, y: a.y + (b.y - a.y) * 0.4 })
  async function loadPose() { if (poseT || poseTried) return; poseTried = true; try { poseT = await createPoseTracker() } catch { /* necklaces fall back to a face-based estimate */ } }
  function updateShoulders(now, w, h) {
    loadPose()
    if (!poseT || now - lastPose < 100) return
    lastPose = now
    const p = poseT.detectForVideo(vid, now).landmarks[0]
    if (p && p[11].visibility > 0.5 && p[12].visibility > 0.5) {
      const X = (v) => (cam.mirror ? 1 - v : v) * w
      let a = { x: X(p[11].x), y: p[11].y * h }, b = { x: X(p[12].x), y: p[12].y * h }
      if (a.x > b.x) [a, b] = [b, a]
      shoulders = shoulders ? { l: lerpP(shoulders.l, a), r: lerpP(shoulders.r, b) } : { l: a, r: b }
    } else shoulders = null
  }

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
  function stopLoop() { running = false; cancelAnimationFrame(raf); face.reset(); lastLm = null; lastM = null; shoulders = null; hint.hidden = true; sync() }
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
    if (out.width !== w || out.height !== h) {
      [out, raw, fin].forEach((c) => { c.width = w; c.height = h })
      $('.ts-view').style.setProperty('--ar', `${w} / ${h}`) // preview box follows the real camera shape
    }
    rctx.save(); if (cam.mirror) { rctx.translate(w, 0); rctx.scale(-1, 1) } rctx.drawImage(vid, 0, 0, w, h); rctx.restore()
    fctx.drawImage(raw, 0, 0)
    let found = false
    if (tracker) {
      const now = performance.now()
      if (now - lastDetect >= DETECT_MS) { lastDetect = now; lastLm = tracker.detectForVideo(vid, now).faceLandmarks[0] || null }
      const lm = lastLm
      if (lm) { lastM = face.update(lm, w, h, cam.mirror); lastSeen = now }
      if (lastM && (lm || now - lastSeen < HOLD_MS)) {
        if (needNeck()) updateShoulders(now, w, h)
        lastM.shoulders = needNeck() ? shoulders : null
        drawMakeup(fctx, lastM, state, raw); drawJewellery(fctx, lastM, state, now / 1000); found = !!lm
      } else { face.reset(); lastM = null }
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
    const sb = shot.querySelector('[data-a=share]'); if (sb) sb.hidden = !(navigator.canShare && navigator.share)
    out.classList.add('flash'); setTimeout(() => out.classList.remove('flash'), 250)
  }
  async function share() {
    try {
      const blob = await (await fetch(snap())).blob(), file = new File([blob], 'glamify-try-on.png', { type: 'image/png' })
      if (navigator.canShare?.({ files: [file] })) await navigator.share({ files: [file], title: 'My Glamify XR look' })
    } catch { /* the person closed the share sheet, or the browser cannot share files */ }
  }
  function download() {
    if (!cam.active || !fin.width) return
    const a = document.createElement('a'); a.download = 'glamify-try-on.png'; a.href = snap(); a.click()
  }

  /* ---- product panel ---- */
  const lookTab = () => tab === 'saved' || tab === 'compare'
  const appliedHtml = () => { const ids = Object.keys(state); return ids.length ? '<span>Applied</span>' + ids.map((id) => `<button class="tag" data-rm="${id}">${esc(findProduct(id).label)} &times;</button>`).join('') : '' }
  const chip = (p) => `<button class="chip${state[p.id] ? ' on' : ''}${sel === p.id ? ' sel' : ''}" data-p="${p.id}">${iconOf(p)}${isFav(p.id) ? '&#9733; ' : ''}${esc(p.label)}</button>`

  function renderList() {
    const looks = lookTab()
    $('.ts-list').hidden = looks; $('.ts-looks').hidden = !looks
    $('.ts-applied').innerHTML = appliedHtml()
    if (looks) { $('.ts-edit').hidden = true; renderLooks(); return }
    $('.ts-list').innerHTML = groupsOf(tab).map((g) => `<div class="ts-grp"><h3>${esc(g.name)}</h3><div class="ts-chips">${g.items.map(chip).join('')}</div></div>`).join('')
    const ed = $('.ts-edit'), p = sel && findProduct(sel), st = sel && state[sel]
    if (!p || !st || categoryOf(sel) !== tab) ed.hidden = true
    else {
      const jew = categoryOf(sel) === 'jewellery'
      ed.hidden = false
      ed.innerHTML = `<div class="ts-et">${esc(p.label)}</div>
        <div class="ts-sw">${p.shades.map((s, i) => `<button class="sw${i === st.shade ? ' on' : ''}" data-s="${i}" style="background:${s.c}" title="${esc(s.n)}" aria-label="${esc(s.n)}"></button>`).join('')}</div>
        <div class="ts-sn">${esc(p.shades[st.shade].n)}</div>
        <label class="ts-rng">${jew ? 'Size' : 'Intensity'}<input type="range" min="0" max="1" step="0.01" value="${st.v}"></label>
        <div class="ts-row"><button class="ts-fav" data-fav="${p.id}">${isFav(p.id) ? '&#9733; Favourite' : '&#9734; Add to favourites'}</button><button class="ts-rm" data-rm="${p.id}">Remove ${esc(p.label)}</button></div>`
    }
  }

  /* ---- saved looks, favourites, compare ---- */
  const fmt = (t) => new Date(t).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
  const names = (l) => Object.keys(l.state).map((id) => findProduct(id)?.label).filter(Boolean).join(', ') || 'No products'
  const lookCard = (l, extra = '') => `<figure class="lk">${l.thumb ? `<img src="${l.thumb}" alt="${esc(l.name)}">` : '<div class="lk-ph">No photo</div>'}<figcaption><b>${esc(l.name)}</b><small>${esc(names(l))}</small>${extra}</figcaption></figure>`
  let cmpA = 0, cmpB = 1
  function renderLooks() {
    const box = $('.ts-looks'), looks = getLooks()
    if (tab === 'saved') {
      const favs = getFavs().map(findProduct).filter(Boolean)
      box.innerHTML = `<div class="ts-grp"><h3>Favourite products</h3>${favs.length ? `<div class="ts-chips">${favs.map((p) => `<button class="chip" data-fp="${p.id}">${iconOf(p)}&#9733; ${esc(p.label)}</button>`).join('')}</div>` : '<p class="ts-empty">No favourites yet. Open a product and press &ldquo;Add to favourites&rdquo;.</p>'}</div>
        <div class="ts-grp"><h3>Saved looks</h3>${looks.length ? `<div class="lk-grid">${looks.map((l) => lookCard(l, `<span class="lk-act"><button data-lk-open="${l.id}">Open</button><button data-lk-del="${l.id}">Delete</button></span>`)).join('')}</div>` : '<p class="ts-empty">No saved looks yet. Try some products, then press &ldquo;Save Look&rdquo;. Looks are stored in this browser only.</p>'}</div>`
    } else if (looks.length < 2) {
      box.innerHTML = '<p class="ts-empty">Save at least two looks to compare them side by side.</p>'
    } else {
      cmpA = Math.min(cmpA, looks.length - 1); cmpB = Math.min(cmpB, looks.length - 1)
      const opts = (i) => looks.map((l, k) => `<option value="${k}"${k === i ? ' selected' : ''}>${esc(l.name)}</option>`).join('')
      box.innerHTML = `<div class="lk-pick"><label>Look A<select data-cmp="A">${opts(cmpA)}</select></label><label>Look B<select data-cmp="B">${opts(cmpB)}</select></label></div>
        <div class="lk-grid two">${lookCard(looks[cmpA], `<span class="lk-act"><button data-lk-open="${looks[cmpA].id}">Try on</button></span>`)}${lookCard(looks[cmpB], `<span class="lk-act"><button data-lk-open="${looks[cmpB].id}">Try on</button></span>`)}</div>`
    }
  }
  function thumb() {
    if (!cam.active || !fin.width) return null
    const k = Math.min(1, 360 / fin.width), t = document.createElement('canvas'); t.width = Math.round(fin.width * k); t.height = Math.round(fin.height * k)
    t.getContext('2d').drawImage(fin, 0, 0, t.width, t.height); return t.toDataURL('image/jpeg', 0.72)
  }
  function save() {
    if (!Object.keys(state).length) { say('Apply at least one product before saving a look.'); setTimeout(() => say(''), 2200); return }
    const l = saveLook(state, thumb())
    say(l ? `Saved as ${l.name}. Find it under Saved.` : 'Your browser would not store this look (private mode or storage full).'); setTimeout(() => say(''), 2200)
    if (tab === 'saved' || tab === 'compare') renderList()
  }
  function openLook(id) {
    const l = getLooks().find((x) => x.id === id); if (!l) return
    Object.keys(state).forEach((k) => delete state[k])
    Object.entries(l.state).forEach(([k, v]) => { if (findProduct(k)) state[k] = v })
    sel = null; tab = 'makeup'; root.querySelectorAll('.ts-tabs button').forEach((b) => b.classList.toggle('on', b.dataset.tab === tab)); renderList()
    $('.ts-view').scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }

  root.addEventListener('click', (e) => {
    const t = e.target.closest('button'); if (!t) return
    if (t.dataset.tab) { tab = t.dataset.tab; root.querySelectorAll('.ts-tabs button').forEach((b) => b.classList.toggle('on', b === t)); renderList() }
    else if (t.dataset.p) { const id = t.dataset.p; if (!state[id]) state[id] = { shade: 0, v: findProduct(id).v }; sel = id; renderList() }
    else if (t.dataset.fp) { const id = t.dataset.fp; if (!state[id]) state[id] = { shade: 0, v: findProduct(id).v }; sel = id; tab = categoryOf(id); root.querySelectorAll('.ts-tabs button').forEach((b) => b.classList.toggle('on', b.dataset.tab === tab)); renderList() }
    else if (t.dataset.s) { state[sel].shade = +t.dataset.s; renderList() }
    else if (t.dataset.fav) { toggleFav(t.dataset.fav); renderList() }
    else if (t.dataset.rm) { delete state[t.dataset.rm]; if (sel === t.dataset.rm) sel = null; renderList() }
    else if (t.dataset.lkOpen) openLook(t.dataset.lkOpen)
    else if (t.dataset.lkDel) { deleteLook(t.dataset.lkDel); renderList() }
    else if (t.dataset.a) action(t.dataset.a)
  })
  root.addEventListener('change', (e) => { const s = e.target.closest('[data-cmp]'); if (s) { if (s.dataset.cmp === 'A') cmpA = +s.value; else cmpB = +s.value; renderLooks() } })
  root.addEventListener('input', (e) => { if (e.target.matches('.ts-rng input') && state[sel]) state[sel].v = +e.target.value })

  async function action(a) {
    if (a === 'close') close()
    else if (a === 'start') start()
    else if (a === 'stop') stop()
    else if (a === 'switch') { try { await cam.switch(); face.reset() } catch (e) { say(describeError(e)); setTimeout(() => say(''), 2500) } }
    else if (a === 'compare') { compare = !compare; split.hidden = !compare; btn('compare').classList.toggle('on', compare) }
    else if (a === 'capture') capture()
    else if (a === 'download') download()
    else if (a === 'savelook') save()
    else if (a === 'share') share()
    else if (a === 'reset') { Object.keys(state).forEach((k) => delete state[k]); sel = null; renderList() }
  }

  function open() {
    lastOpener = document.activeElement
    root.hidden = false; document.body.classList.add('studio-open'); renderList(); sync()
    root.scrollTop = 0; $('.ts-x').focus({ preventScroll: true }); hooks.onOpen?.()
    start() // runs from the tap on "Try It On", so the browser allows the camera prompt
  }
  function close() {
    cam.stop(); stopLoop(); root.hidden = true; document.body.classList.remove('studio-open')
    lastOpener?.focus?.({ preventScroll: true }); hooks.onClose?.()
  }
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !root.hidden) close() })
  // switching tabs / locking the phone: release the camera and stop the loop, so battery and the camera light are not wasted
  document.addEventListener('visibilitychange', () => {
    if (root.hidden) return
    if (document.hidden) { if (cam.active) { cam.stop(); stopLoop(); say('Camera paused. Press Start Camera to continue.') } }
  })
  addEventListener('pagehide', () => cam.stop())

  return { open, close }
}
