// Virtual Try-On Studio: overlay UI, render loop, product panel, capture.
import './tryon.css'
import { Camera, describeError } from './camera.js'
import { createFaceTracker, createPoseTracker, createHandTracker, createSegmenter } from './track/mediapipe.js'
import { HeadTracker } from './track/head.js'
import { PointSetFilter, Presence } from './track/filters.js'
import { initPhoto } from './photo.js'
import { drawMakeup } from './makeup.js'
import { JEWELLERY, drawJewellery, resetJewellery } from './jewellery.js'
import { drawHairColour, buildHairMask, FACE_OVAL } from './hair.js'
import { drawNails } from './nails.js'
import { drawOutfit, bodyFrom, prepGarment, OUTFIT_IDS } from './outfit.js'
import { ALL_PRODUCTS as ALL, CATEGORIES, groupsOf, findProduct, categoryOf, iconOf, needOf } from './catalog.js'
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
    <div class="ts-tabs"><button data-tab="makeup" class="on">Makeup</button><button data-tab="hair">Hair</button><button data-tab="outfits">Outfits</button><button data-tab="nails">Nails</button><button data-tab="jewellery">Jewellery</button><button data-tab="photo">AI Photo</button><button data-tab="saved">Saved</button><button data-tab="compare">Compare</button></div>
    <div class="ts-list"></div>
    <div class="ts-edit" hidden></div>
    <div class="ts-looks" hidden></div>
    <div class="ts-photo" hidden></div>
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
  const raw = document.createElement('canvas'), fin = document.createElement('canvas'), lay = document.createElement('canvas')
  const rctx = raw.getContext('2d'), fctx = fin.getContext('2d'), lctx = lay.getContext('2d')
  const cam = new Camera(vid), head = new HeadTracker()
  const state = {}
  const phone = matchMedia('(pointer:coarse)').matches || Math.min(screen.width, screen.height) < 700
  let tracker = null, trackerTried = false, raf = 0, running = false, tab = 'makeup', sel = null, compare = false, dirty = true
  let note = '', lastOpener = null, M = null, customImg = null, customNote = 'Your photo stays on this device. It is not uploaded.'
  // Extra models (body pose, hands, hair segmentation) are downloaded only when a product that needs them is applied.
  const EXTRA = { pose: { make: createPoseTracker, name: 'Body' }, hand: { make: createHandTracker, name: 'Hand' }, seg: { make: createSegmenter, name: 'Hair' } }
  const models = {}
  function ensure(k) {
    const m = (models[k] ||= { t: null, busy: false, n: 0, ms: 0, failedAt: 0 })
    if (m.t || m.busy || (m.failedAt && performance.now() - m.failedAt < 8000)) return m
    m.busy = true; note = `Loading ${EXTRA[k].name.toLowerCase()} tracking...` // small note, does not cover the camera view
    EXTRA[k].make().then((t) => { m.t = t; note = '' }).catch(() => { m.failedAt = performance.now(); note = ''; say(`${EXTRA[k].name} tracking could not load. Check your internet connection.`); setTimeout(() => say(''), 3500) }).finally(() => { m.busy = false })
    return m
  }
  const needs = () => { const n = new Set(); Object.keys(state).forEach((id) => { const p = findProduct(id); if (p) needOf(p).split('+').forEach((k) => n.add(k)) }); return n }
  const debug = new URLSearchParams(location.search).has('debug') // add ?debug to the address to see tracking diagnostics
  const stat = { fpsT: 0, camN: 0, cam: 0, detMs: 0, dup: 0, ms: { hand: 0, pose: 0, seg: 0 } }
  let lastVT = -1, frameNo = 0, vfcFrames = 0, seenVfc = 0, lastNewAt = 0, budgetK = 1
  // New camera frames are detected with requestVideoFrameCallback where the browser has it (exact), otherwise from the video
  // clock. Some browsers update that clock coarsely; if it has not moved for 40 ms we treat the frame as new anyway, so tracking
  // never drops to a fraction of the camera rate.
  const hasVfc = 'requestVideoFrameCallback' in HTMLVideoElement.prototype
  const onVfc = () => { vfcFrames++; vid.requestVideoFrameCallback(onVfc) }
  if (hasVfc) vid.requestVideoFrameCallback(onVfc)

  // ---- body (pose): own filter, visibility per point, graceful loss ----
  const poseFilter = new PointSetFilter({ minCutoff: 1.0, beta: 25 }), posePresence = new Presence(200, 300, 120)
  let pose = null, poseT = 0
  function updatePose(now, w, h) {
    const p = models.pose.t.detectForVideo(vid, now).landmarks[0]
    const dt = poseT ? (now - poseT) / 1000 : 0; poseT = now
    if (p) {
      if (posePresence.stale(now)) poseFilter.reset()
      const pts = p.map((q) => ({ x: (cam.mirror ? 1 - q.x : q.x) * w, y: q.y * h, z: (q.z || 0) * w, v: q.visibility ?? 0 }))
      pose = poseFilter.filter(pts, dt, Math.hypot(pts[11].x - pts[12].x, pts[11].y - pts[12].y) || w * 0.3)
    }
    posePresence.update(now, !!p); if (posePresence.a <= 0) { pose = null; poseFilter.reset() }
  }
  // ---- hands: one filter per (true) hand, 2D picture points AND 3D world points, low-confidence readings ignored ----
  const handSlots = {}
  let handSeenAt = -1e9
  let hands = []
  function updateHands(now, w, h) {
    const r = models.hand.t.detectForVideo(vid, now), seen = new Set()
    r.landmarks.forEach((lm, i) => {
      const hd = r.handedness[i]?.[0]; if (!hd || hd.score < 0.6) return // not sure it is a hand: ignore it
      handSeenAt = now
      const right = hd.categoryName === 'Left' // the model assumes a mirrored image; we analyse the un-mirrored camera picture
      const key = right ? 'R' : 'L', s = (handSlots[key] ||= { f: new PointSetFilter({ minCutoff: 1.2, beta: 30 }), fw: new PointSetFilter({ minCutoff: 1.2, beta: 30 }), pr: new Presence(150, 220, 90), t: 0 })
      const dt = s.t ? (now - s.t) / 1000 : 0; s.t = now
      if (s.pr.stale(now)) { s.f.reset(); s.fw.reset() }
      const P = lm.map((q) => ({ x: q.x * w, y: q.y * h, z: (q.z || 0) * w }))
      const size = Math.hypot(P[0].x - P[9].x, P[0].y - P[9].y) || 100
      s.P = s.f.filter(P, dt, size); s.Wd = s.fw.filter(r.worldLandmarks[i].map((q) => ({ x: q.x, y: q.y, z: q.z })), dt, 0.09); s.right = right
      seen.add(key)
    })
    hands = []
    for (const key of ['L', 'R']) {
      const s = handSlots[key]; if (!s) continue
      const a = s.pr.update(now, seen.has(key))
      s.streak = seen.has(key) ? (s.streak || 0) + 1 : 0
      if (a > 0 && s.P) hands.push({ P: s.P, Wd: s.Wd, right: s.right, alpha: a, sure: s.streak >= 2 || (s.sure && a > 0) }), (s.sure = s.streak >= 2 || (s.sure && a > 0)); else { s.f.reset(); s.fw.reset(); s.P = null; s.sure = false }
    }
  }
  // ---- hair mask (segmentation), smoothed over time so its edge does not shimmer ----
  const hairMask = document.createElement('canvas'), hairTint = document.createElement('canvas')
  function updateSeg(now) {
    models.seg.t.segmentForVideo(vid, now, (r) => { const mk = r.categoryMask; if (mk) buildHairMask(mk.getAsUint8Array(), mk.width, mk.height, hairMask, cam.mirror) })
  }
  function drawDebug(w, h, need) { // tracking diagnostics (add ?debug to the page address)
    octx.save()
    if (M) {
      octx.fillStyle = '#39ff14'; M.P.forEach((p, i) => { if (i % 3 === 0) octx.fillRect(p.x - 1, p.y - 1, 2, 2) })
      ;['lobeL', 'lobeR', 'noseL', 'noseR', 'neck'].forEach((n) => { const a = M.project(n); octx.fillStyle = n.startsWith('lobe') ? '#ff2d6f' : '#29b6ff'; octx.fillRect(a.x - 4, a.y - 4, 8, 8) })
    }
    octx.fillStyle = '#ff3b6b'; if (pose) pose.forEach((p) => p.v > 0.5 && octx.fillRect(p.x - 3, p.y - 3, 6, 6))
    octx.fillStyle = '#4da3ff'; hands.forEach((hd) => hd.P.forEach((p) => octx.fillRect((cam.mirror ? w - p.x : p.x) - 2, p.y - 2, 5, 5)))
    const lines = [`camera ${stat.cam} fps | frame ${(stat.procMs || 0).toFixed(0)} ms (draw ${(stat.drawMs || 0).toFixed(0)}) | load-saving x${budgetK} | delegates: face ${tracker?.__delegate || '-'} hand ${models.hand?.t?.__delegate || '-'}`, `model ms: face ${stat.detMs.toFixed(1)} hand ${stat.ms.hand.toFixed(1)} pose ${stat.ms.pose.toFixed(1)} seg ${stat.ms.seg.toFixed(1)} | need: ${[...need].join(', ') || '-'}`, `face missed ${head.misses} | implausible readings rejected ${head.rejects}`, M ? `presence ${M.alpha.toFixed(2)} | in frame ${(M.inFrame * 100) | 0}% | turn ${(M.yaw * 57.3).toFixed(0)} deg | nod ${(M.pitch * 57.3).toFixed(0)} deg | roll ${(M.roll * 57.3).toFixed(0)} deg | ${M.cm.toFixed(1)} px/cm` : 'no face', `${out.width}x${out.height} | mirror ${cam.mirror}`]
    octx.font = `${Math.max(12, Math.round(h * 0.022))}px monospace`; octx.textAlign = 'left'
    lines.forEach((ln, i) => { const y = h - 8 - (lines.length - 1 - i) * Math.max(15, h * 0.026); octx.fillStyle = 'rgba(0,0,0,.65)'; octx.fillRect(4, y - Math.max(13, h * 0.022), octx.measureText(ln).width + 8, Math.max(16, h * 0.026)); octx.fillStyle = '#fff'; octx.fillText(ln, 8, y) })
    octx.restore()
  }
  function restoreFace(c, M) { // put the real face back on top of clothes drawn over it (soft edge, no hard cut line)
    c.save(); c.beginPath(); FACE_OVAL.forEach((i, k) => (k ? c.lineTo(M.P[i].x, M.P[i].y) : c.moveTo(M.P[i].x, M.P[i].y))); c.closePath(); c.clip(); c.drawImage(raw, 0, 0); c.restore()
  }
  // the real hand, cut from the camera picture along the tracked fingers and palm, drawn back over face items and clothes
  const handCv = document.createElement('canvas')
  function restoreHands(c, w) {
    if (handCv.width !== c.canvas.width || handCv.height !== c.canvas.height) { handCv.width = c.canvas.width; handCv.height = c.canvas.height }
    const x = handCv.getContext('2d'); x.clearRect(0, 0, handCv.width, handCv.height)
    const X = (p) => (cam.mirror ? w - p.x : p.x)
    hands.forEach((hd) => {
      if (!hd.sure) return // a hand seen in only one frame may be a false detection: do not erase anything for it
      const P = hd.P, fw = Math.hypot(P[5].x - P[9].x, P[5].y - P[9].y) * 1.15
      x.save(); x.globalAlpha = hd.alpha; x.filter = 'blur(1.5px)'; x.fillStyle = x.strokeStyle = '#000'; x.lineCap = x.lineJoin = 'round'
      x.beginPath(); [0, 1, 5, 9, 13, 17].forEach((i, k) => (k ? x.lineTo(X(P[i]), P[i].y) : x.moveTo(X(P[i]), P[i].y))); x.closePath(); x.fill(); x.lineWidth = fw; x.stroke()
      ;[[0, 1, 2, 3, 4], [5, 6, 7, 8], [9, 10, 11, 12], [13, 14, 15, 16], [17, 18, 19, 20]].forEach((ch, f) => { x.lineWidth = fw * (f === 4 ? 0.8 : 0.95); x.beginPath(); ch.forEach((i, k) => (k ? x.lineTo(X(P[i]), P[i].y) : x.moveTo(X(P[i]), P[i].y))); x.stroke() })
      x.restore()
    })
    x.globalCompositeOperation = 'source-in'; x.drawImage(raw, 0, 0); x.globalCompositeOperation = 'source-over'
    c.drawImage(handCv, 0, 0)
  }
  const say = (t) => { msg.textContent = t || ''; msg.hidden = !t }
  const btn = (a) => $(`[data-a="${a}"]`)

  async function loadTracker() {
    if (tracker || trackerTried) return
    trackerTried = true; say('Loading AI face model...')
    try { tracker = await createFaceTracker(); say('') }
    catch { trackerTried = false; say('The AI face model could not load. Check your internet connection and reopen the studio. The camera preview still works.') }
  }

  async function start(fn) {
    say('Waiting for camera permission...')
    try { await (fn ? fn() : cam.start()) }
    catch (e) { say(describeError(e)); if (!cam.active) stopLoop(); return }
    running = true; dirty = true; say(''); sync(); loadTracker(); cancelAnimationFrame(raf); loop()
  }
  function resetTracking() { head.reset(); head.presence.reset(); M = null; resetJewellery(); pose = null; poseFilter.reset(); posePresence.reset(); hands = []; Object.keys(handSlots).forEach((k) => delete handSlots[k]); lastVT = -1 }
  function stopLoop() { running = false; cancelAnimationFrame(raf); resetTracking(); hint.hidden = true; sync() }
  function stop() {
    cam.stop(); stopLoop(); octx.clearRect(0, 0, out.width, out.height)
    say('Camera is off. Press Start Camera to continue.')
  }
  function sync() {
    btn('start').disabled = cam.active; btn('stop').disabled = !cam.active
    btn('switch').disabled = !cam.active; btn('capture').disabled = !cam.active; btn('download').disabled = !cam.active; btn('compare').disabled = !cam.active
  }

  // How often each extra model runs, in camera frames. The face and the hands (when nails are on) run on EVERY new frame:
  // they are the items that must stick to fast-moving parts. The hair mask runs on every frame on computers (every 2nd on
  // phones); necklace-only body tracking runs every 3rd frame (the necklace position comes from the head, see jewellery.js).
  const every = (k, need) => (k === 'hand' ? 1 : k === 'pose' ? (Object.keys(state).some((id) => OUTFIT_IDS.has(id)) ? (phone ? 2 : 1) : 3) : phone ? 2 : 1)

  function loop() {
    if (!running) return
    raf = requestAnimationFrame(loop)
    if (vid.readyState < 2 || !vid.videoWidth) return
    const w = vid.videoWidth, h = vid.videoHeight
    if (out.width !== w || out.height !== h) {
      [out, raw, fin, lay].forEach((c) => { c.width = w; c.height = h })
      $('.ts-view').style.setProperty('--ar', `${w} / ${h}`) // preview box follows the real camera shape
      resetTracking()
    }
    // FRAME SYNC: the screen refreshes ~60 times a second but the camera delivers ~30 pictures. We analyse each new camera
    // picture exactly once and show THAT picture with THAT tracking result. (Before, tracking from one picture was drawn over a
    // newer picture, so makeup and jewellery trailed the face by a frame and appeared to swim or flicker.)
    const tNow = performance.now(), newFrame = hasVfc ? vfcFrames !== seenVfc : vid.currentTime !== lastVT || tNow - lastNewAt > 40
    if (!newFrame && !dirty) { stat.dup++; return }
    const now = performance.now(), need = needs(), t = now / 1000
    if (newFrame) {
      lastVT = vid.currentTime; seenVfc = vfcFrames; lastNewAt = tNow; frameNo++; stat.camN++
      if (now - stat.fpsT >= 1000) { stat.cam = stat.camN; stat.camN = 0; stat.fpsT = now }
      rctx.save(); if (cam.mirror) { rctx.translate(w, 0); rctx.scale(-1, 1) } rctx.drawImage(vid, 0, 0, w, h); rctx.restore()
      // hands are also tracked (computers only, every 2nd frame) when face items are on, so a hand passing in front of the
      // face hides the makeup / earrings / necklace behind it instead of having them painted on top of the hand
      if (!phone && need.has('face') && Object.keys(state).some((id) => ['makeup', 'jewellery'].includes(categoryOf(id)))) need.add('handOcc')
      ;['pose', 'hand', 'seg'].forEach((k) => (need.has(k) || (k === 'hand' && need.has('handOcc'))) && ensure(k))
      // all models analyse the SAME frame that is drawn below
      if (tracker && need.has('face')) {
        const t0 = performance.now(); let lm = null
        try { lm = tracker.detectForVideo(vid, now).faceLandmarks[0] || null } catch { /* skipped frame */ }
        stat.detMs = stat.detMs * 0.9 + (performance.now() - t0) * 0.1
        M = head.update(lm, w, h, cam.mirror, now)
      } else if (!need.has('face')) M = null
      for (const k of ['hand', 'pose', 'seg']) {
        const m = models[k]; if (!(need.has(k) || (k === 'hand' && need.has('handOcc'))) || !m?.t) continue
        // hands only for occlusion (no nails): every 3rd frame, every 6th while no hand has been seen for a second
        if (k === 'hand' && !need.has('hand') && frameNo % ((performance.now() - handSeenAt < 1000 ? 3 : 6) * budgetK)) continue
        if (k !== 'hand' && budgetK > 1 && frameNo % budgetK) continue
        if (frameNo % every(k, need) && !(k === 'pose' && !pose)) continue
        const t0 = performance.now()
        try { if (k === 'hand') updateHands(now, w, h); else if (k === 'pose') updatePose(now, w, h); else updateSeg(now) } catch { /* try again next frame */ }
        stat.ms[k] = stat.ms[k] * 0.9 + (performance.now() - t0) * 0.1
      }
      if (!need.has('hand') && !need.has('handOcc')) hands = []
    }
    dirty = false
    const tDraw = performance.now()
    fctx.drawImage(raw, 0, 0)
    // draw, back to front: hair colour, your clothing photo, the real face on top of it, face items (makeup, jewellery), nails
    if (need.has('seg')) drawHairColour(fctx, hairMask, hairTint, state, w, h, raw)
    let B = need.has('pose') ? bodyFrom(pose) : null
    // cross-check the body model against the face: shoulders must be below the chin and about 1.5 to 4.5 face widths apart.
    // A reading that fails (e.g. a close-up with the shoulders out of the picture) is not used, so nothing is drawn on the head.
    if (B && M && M.alpha > 0.5) {
      const ch = M.P[152], below = -((B.mid.x - ch.x) * M.up.x + (B.mid.y - ch.y) * M.up.y), ratio = B.sw / M.fw3
      stat.bodyCheck = [+below.toFixed(0), +(M.fh * 0.15).toFixed(0), +ratio.toFixed(2)]
      if (below < M.fh * 0.15 || ratio < 1.5 || ratio > 4.5) { B = null; stat.bodyRejected = (stat.bodyRejected || 0) + 1 }
    }
    const outfitOn = Object.keys(state).some((id) => OUTFIT_IDS.has(id))
    if (outfitOn && B) { fctx.save(); fctx.globalAlpha = posePresence.a; drawOutfit(fctx, B, state, customImg, t, raw, pose, M); fctx.restore(); if (M) restoreFace(fctx, M) }
    if (M) {
      // face items fade together with tracking presence (no sudden pop in or out); a short miss keeps the last position
      const target = M.alpha < 0.999 ? lctx : fctx
      if (target === lctx) lctx.drawImage(fin, 0, 0)
      drawMakeup(target, M, state, raw)
      M.shoulders = B ? { l: B.l, r: B.r } : null
      drawJewellery(target, M, state, t)
      if (target === lctx) { fctx.save(); fctx.globalAlpha = M.alpha; fctx.drawImage(lay, 0, 0); fctx.restore() }
    }
    if (hands.length && (need.has('handOcc') || outfitOn)) restoreHands(fctx, w)
    if (need.has('hand')) drawNails(fctx, hands, state, t, raw, cam.mirror)
    // guidance
    const hm = note ? note : need.has('face') && tracker && !M ? 'Looking for your face... move into the frame'
      : tab === 'outfits' && outfitOn && models.pose?.t && !B ? 'Step back a little so your shoulders are in the frame'
      : tab === 'nails' && need.has('hand') && models.hand?.t && !hands.length ? 'Show your hand to the camera, back of the hand facing you' : ''
    if (hint.textContent !== hm) hint.textContent = hm
    hint.hidden = !hm
    octx.drawImage(fin, 0, 0)
    stat.drawMs = (stat.drawMs || 0) * 0.9 + (performance.now() - tDraw) * 0.1; stat.procMs = (stat.procMs || 0) * 0.9 + (performance.now() - now) * 0.1
    // adaptive budget: if a frame takes longer than the camera interval, run the secondary models less often (never the face)
    if (frameNo % 15 === 0) budgetK = stat.procMs > (phone ? 50 : 38) ? Math.min(4, budgetK + 1) : stat.procMs < (phone ? 28 : 22) ? Math.max(1, budgetK - 1) : budgetK
    if (debug) { drawDebug(w, h, need); window.__glamify = { frames: frameNo, budgetK, vfc: hasVfc, drawMs: +(stat.drawMs || 0).toFixed(1), procMs: +(stat.procMs || 0).toFixed(1), faceMissed: head.misses, faceRejected: head.rejects, presence: M ? +M.alpha.toFixed(2) : 0, yawDeg: M ? +(M.yaw * 57.3).toFixed(1) : null, faceMs: +stat.detMs.toFixed(1), hands: hands.length, handTip: hands.map((h) => [Math.round(h.P[4].x), Math.round(h.P[4].y), +h.alpha.toFixed(2)]), pose: !!pose, bodyCheck: stat.bodyCheck, bodyRejected: stat.bodyRejected || 0, ms: stat.ms, ears: M ? ['lobeL', 'lobeR'].map((n) => { const a = M.project(n); return [+a.x.toFixed(1), +a.y.toFixed(1)] }) : null } }
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
  // applying a product replaces any other one of the same kind (one hairstyle, one nail design, one base garment...)
  function addProduct(id) {
    const p = findProduct(id); if (!p || state[id]) return
    if (p.excl) Object.keys(state).forEach((k) => { if (findProduct(k)?.excl === p.excl) delete state[k] })
    state[id] = { shade: 0, v: p.v, ...(p.defaults || {}) }
    ;(p.ranges || []).forEach((r) => { state[id][r.k] = r.def })
  }
  const lookTab = () => tab === 'saved' || tab === 'compare' || tab === 'photo'
  const appliedHtml = () => { const ids = Object.keys(state); return ids.length ? '<span>Applied</span>' + ids.map((id) => `<button class="tag" data-rm="${id}">${esc(findProduct(id).label)} &times;</button>`).join('') : '' }
  const chip = (p) => `<button class="chip${state[p.id] ? ' on' : ''}${sel === p.id ? ' sel' : ''}" data-p="${p.id}">${iconOf(p)}${isFav(p.id) ? '&#9733; ' : ''}${esc(p.label)}</button>`

  function renderList() {
    dirty = true
    const looks = lookTab()
    $('.ts-list').hidden = looks; $('.ts-looks').hidden = !(tab === 'saved' || tab === 'compare'); $('.ts-photo').hidden = tab !== 'photo'
    if (tab === 'photo') photo.show(); else photo.hide()
    $('.ts-applied').innerHTML = appliedHtml()
    if (looks) { $('.ts-edit').hidden = true; if (tab !== 'photo') renderLooks(); return }
    const note = CATEGORIES[tab]?.note
    $('.ts-list').innerHTML = (note ? `<div class="ts-grp"><p class="ts-note">${esc(note.text)}</p><div class="ts-chips"><button class="chip" data-tab="photo" data-mode="${note.mode}">${esc(note.button)}</button></div></div>` : '') + groupsOf(tab).map((g) => `<div class="ts-grp"><h3>${esc(g.name)}</h3><div class="ts-chips">${g.items.map(chip).join('')}</div></div>`).join('')
    const ed = $('.ts-edit'), p = sel && findProduct(sel), st = sel && state[sel]
    if (!p || !st || categoryOf(sel) !== tab) ed.hidden = true
    else {
      const cat = categoryOf(sel), sizeLabel = cat === 'nails' ? 'Colour strength' : cat === 'outfits' || cat === 'jewellery' ? 'Size' : 'Intensity'
      ed.hidden = false
      ed.innerHTML = `<div class="ts-et">${esc(p.label)}</div>
        <div class="ts-sw">${p.shades.map((s, i) => `<button class="sw${i === st.shade ? ' on' : ''}" data-s="${i}" style="background:${s.c}" title="${esc(s.n)}" aria-label="${esc(s.n)}"></button>`).join('')}</div>
        <div class="ts-sn">${esc(p.shades[st.shade].n)}</div>
        ${p.noSize ? '' : `<label class="ts-rng">${sizeLabel}<input type="range" min="0" max="1" step="0.01" value="${st.v}"></label>`}
        ${(p.ranges || []).map((r) => `<label class="ts-rng">${esc(r.label)}<input type="range" min="${r.min}" max="${r.max}" step="0.01" value="${st[r.k] ?? r.def}" data-k="${r.k}"></label>`).join('')}
        ${(p.opts || []).map((o) => `<div class="ts-opt"><span>${esc(o.label)}</span><div class="ts-chips">${o.values.map(([v, l]) => `<button class="chip${st[o.k] === v ? ' on' : ''}" data-opt="${o.k}:${v}">${esc(l)}</button>`).join('')}</div></div>`).join('')}
        ${p.upload ? `<label class="ts-up">Choose a clothing photo<input type="file" accept="image/png,image/jpeg,image/webp" data-up></label><p class="ts-note">${esc(customNote)}</p>` : ''}
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
    Object.entries(l.state).forEach(([k, v]) => { if (findProduct(k) && !(k === 'o-custom' && !customImg)) state[k] = v })
    sel = null; tab = 'makeup'; root.querySelectorAll('.ts-tabs button').forEach((b) => b.classList.toggle('on', b.dataset.tab === tab)); renderList()
    $('.ts-view').scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }

  const photo = initPhoto($('.ts-photo'), {
    save: (dataUrl, label) => { // keep a small copy of the AI result in Saved looks (this browser only)
      const im = new Image()
      im.onload = () => {
        const k = Math.min(1, 360 / im.width), c = document.createElement('canvas'); c.width = Math.round(im.width * k); c.height = Math.round(im.height * k)
        c.getContext('2d').drawImage(im, 0, 0, c.width, c.height)
        const l = saveLook({}, c.toDataURL('image/jpeg', 0.75), label)
        say(l ? `Saved as ${l.name}. Find it under Saved.` : 'Your browser would not store this result (private mode or storage full).'); setTimeout(() => say(''), 2500)
      }
      im.src = dataUrl
    },
  })

  root.addEventListener('click', (e) => {
    const t = e.target.closest('button'); if (!t || t.closest('.ts-photo')) return
    if (t.dataset.tab) { tab = t.dataset.tab; if (t.dataset.mode) photo.setMode(t.dataset.mode); root.querySelectorAll('.ts-tabs button').forEach((b) => b.classList.toggle('on', b.dataset.tab === tab)); renderList() }
    else if (t.dataset.p) { addProduct(t.dataset.p); sel = t.dataset.p; renderList() }
    else if (t.dataset.fp) { const id = t.dataset.fp; addProduct(id); sel = id; tab = categoryOf(id); root.querySelectorAll('.ts-tabs button').forEach((b) => b.classList.toggle('on', b.dataset.tab === tab)); renderList() }
    else if (t.dataset.opt) { const [k, v] = t.dataset.opt.split(':'); if (state[sel]) state[sel][k] = v; renderList() }
    else if (t.dataset.s) { state[sel].shade = +t.dataset.s; renderList() }
    else if (t.dataset.fav) { toggleFav(t.dataset.fav); renderList() }
    else if (t.dataset.rm) { delete state[t.dataset.rm]; if (sel === t.dataset.rm) sel = null; renderList() }
    else if (t.dataset.lkOpen) openLook(t.dataset.lkOpen)
    else if (t.dataset.lkDel) { deleteLook(t.dataset.lkDel); renderList() }
    else if (t.dataset.a) action(t.dataset.a)
  })
  root.addEventListener('change', async (e) => {
    const f = e.target.closest('[data-up]'); if (!f || !f.files[0]) return
    const file = f.files[0]
    if (!/^image\/(png|jpe?g|webp)$/.test(file.type) || file.size > 8e6) { customNote = 'Please choose a PNG, JPG or WebP image under 8 MB.'; renderList(); return }
    try { const r = prepGarment(await createImageBitmap(file)); customImg = r.canvas; customNote = r.cleaned ? 'Plain background removed. If the edges look rough, use a photo on a plain background.' : 'Photo added. A garment on a plain background works best.' }
    catch { customNote = 'That image could not be read. Try another one.' }
    renderList()
  })
  root.addEventListener('change', (e) => { const s = e.target.closest('[data-cmp]'); if (s) { if (s.dataset.cmp === 'A') cmpA = +s.value; else cmpB = +s.value; renderLooks() } })
  root.addEventListener('input', (e) => { dirty = true; if (e.target.matches('.ts-rng input') && state[sel]) state[sel][e.target.dataset.k || 'v'] = +e.target.value })

  async function action(a) {
    if (a === 'close') close()
    else if (a === 'start') start()
    else if (a === 'stop') stop()
    else if (a === 'switch') { try { await cam.switch(); resetTracking() } catch (e) { say(describeError(e)); setTimeout(() => say(''), 2500) } }
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
    photo.hide(); cam.stop(); stopLoop(); root.hidden = true; document.body.classList.remove('studio-open')
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
