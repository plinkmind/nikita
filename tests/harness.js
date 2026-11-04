// Test harness (NOT part of the website build). Runs the REAL MediaPipe models on real photos in a browser and measures
// the tracking pipeline. Driven by tests/run.mjs through Playwright. Results are put on window.__result.
import { createFaceTracker, createHandTracker, createPoseTracker } from '../src/tryon/track/mediapipe.js'
import { HeadTracker, earVisibility } from '../src/tryon/track/head.js'
import { Face as OldFace } from './old/face.js'
import { earAnchors as oldEars } from './old/headpose.js'

const q = new URLSearchParams(location.search), test = q.get('test') || 'anchors'
const cv = document.getElementById('c'), cx = cv.getContext('2d'), out = document.getElementById('out')
const log = (...a) => { out.textContent += a.join(' ') + '\n' }
const load = (src) => new Promise((ok, no) => { const i = new Image(); i.onload = () => ok(i); i.onerror = no; i.src = src })

// --- seeded noise so every run is identical ---
let seed = 12345; const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648 }
const gauss = () => { let u = 0, v = 0; while (!u) u = rnd(); while (!v) v = rnd(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v) }

// draws the photo into a W x H "camera frame" with a known similarity transform (tx, ty in px, rotation, scale about the frame centre)
// plus camera sensor noise, so the detector sees slightly different pixels every frame (like a real camera)
function frame(img, W, H, T, noise) {
  const c = frame.c || (frame.c = document.createElement('canvas')); c.width = W; c.height = H
  const x = c.getContext('2d', { willReadFrequently: true }); x.fillStyle = '#d9d6d0'; x.fillRect(0, 0, W, H)
  const k = (H / img.height) * 0.95 * T.s
  x.save(); x.translate(W / 2 + T.tx, H / 2 + T.ty); x.rotate(T.r); x.drawImage(img, (-img.width * k) / 2, (-img.height * k) / 2, img.width * k, img.height * k); x.restore()
  if (noise) {
    const d = x.getImageData(0, 0, W, H), p = d.data, g = noise * (0.7 + 0.6 * rnd())
    for (let i = 0; i < p.length; i += 4) { const n = gauss() * g; p[i] += n; p[i + 1] += n; p[i + 2] += n }
    x.putImageData(d, 0, 0)
  }
  return c
}
// where a point of the untransformed frame goes under T
const mapPt = (p, W, H, T) => { const dx = p.x - W / 2, dy = p.y - H / 2, c = Math.cos(T.r), s = Math.sin(T.r); return { x: W / 2 + T.tx + T.s * (c * dx - s * dy), y: H / 2 + T.ty + T.s * (s * dx + c * dy) } }

async function anchors() {
  const img = await load('./img/' + (q.get('img') || 'portrait.png')), W = 960, H = 720
  const det = await createFaceTracker(), mirror = q.get('mirror') === '1'
  const head = new HeadTracker(), old = new OldFace()
  let M, Mo, t = 0, lm
  for (let i = 0; i < 20; i++) { t += 33; lm = det.detectForVideo(frame(img, W, H, { tx: 0, ty: 0, r: 0, s: 1 }, 3), t).faceLandmarks[0]; M = head.update(lm, W, H, mirror, t); Mo = old.update(lm, W, H, mirror, t / 1000) || Mo }
  cv.width = W; cv.height = H
  cx.save(); if (mirror) { cx.translate(W, 0); cx.scale(-1, 1) } cx.drawImage(frame(img, W, H, { tx: 0, ty: 0, r: 0, s: 1 }, 0), 0, 0); cx.restore()
  cx.fillStyle = 'rgba(0,255,90,.8)'; M.P.forEach((p) => cx.fillRect(p.x - 0.8, p.y - 0.8, 1.6, 1.6))
  const dot = (p, col, r = 5) => { cx.beginPath(); cx.arc(p.x, p.y, r, 0, 7); cx.fillStyle = col; cx.fill(); cx.strokeStyle = '#000'; cx.stroke() }
  const res = { delegate: det.__delegate, yaw: M.yaw, pitch: M.pitch, cm: M.cm, fw: M.fw, fw3: M.fw3, anchors: {} }
  ;['lobeL', 'lobeR', 'noseL', 'noseR', 'neck'].forEach((n) => { const a = M.project(n); res.anchors[n] = a; dot(a, n.startsWith('lobe') ? '#ff2d6f' : n === 'neck' ? '#ffd400' : '#29b6ff') })
  if (Mo) oldEars(Mo.frame).forEach((e) => dot(e, '#ffffff', 4))
  window.__result = res; log(JSON.stringify(res, null, 1))
}

// Motion test: a sequence of frames of the same photo moving with KNOWN transforms. The real detector runs once per frame
// (results cached), then every pipeline is evaluated on the same landmarks. For every pipeline we know where its anchor SHOULD
// be (its own still-frame estimate moved by the known transform) and measure: jitter while still, error while moving (lag +
// noise) and the largest single error (jumps). "cam" adds landmark jitter typical of a real webcam (common-mode + per-point).
import { RIGID, SHAPE } from '../src/tryon/track/head.js'
async function detectSequence(img, W, H, N, seq, noise) {
  const det = await createFaceTracker(), lms = []; let ms = 0
  for (let i = 0; i < N; i++) { const t0 = performance.now(); const lm = det.detectForVideo(frame(img, W, H, seq[i], noise), i * 33.333).faceLandmarks[0] || null; ms += performance.now() - t0; lms.push(lm && lm.map((p) => ({ x: p.x, y: p.y, z: p.z }))) }
  return { lms, ms: ms / N, delegate: det.__delegate }
}
function makeSeq(N) {
  const seq = []
  for (let i = 0; i < N; i++) {
    const t = i / 30; let T
    if (t < 2) T = { tx: 0, ty: 0, r: 0, s: 1 }
    else if (t < 4) { const u = (t - 2) / 2; T = { tx: 140 * Math.sin(u * Math.PI * 2), ty: 0, r: 0, s: 1 } } // side to side, up to ~440 px/s
    else if (t < 6) { const u = (t - 4) / 2; T = { tx: 0, ty: 0, r: 0.22 * Math.sin(u * Math.PI * 2), s: 1 } } // tilt +-12.6 deg
    else { const u = (t - 6) / 2; T = { tx: 0, ty: 0, r: 0, s: 1 + 0.25 * Math.sin(u * Math.PI * 2) } } // closer / farther
    seq.push(T)
  }
  return seq
}
function addCamNoise(lms, W, H, px) { // px: per-point sigma in pixels; common-mode shift 0.7*px
  seed = 777
  return lms.map((lm) => { if (!lm) return null; const cx = gauss() * px * 0.7, cy = gauss() * px * 0.7; return lm.map((p) => ({ x: p.x + (cx + gauss() * px) / W, y: p.y + (cy + gauss() * px) / H, z: p.z + gauss() * px / W })) })
}
function evaluate(lms, seq, W, H, mirror, pipes) {
  const N = lms.length, rec = {}, lips = {}
  for (const k in pipes) { rec[k] = []; lips[k] = [] }
  const cp = (a) => a && a.map((p) => ({ x: p.x, y: p.y }))
  for (const k in pipes) {
    const P = pipes[k]()
    for (let i = 0; i < N; i++) { const r = P(lms[i], i * 33.333); rec[k].push(cp(r && r.ear)); lips[k].push(cp(r && r.lip)) }
  }
  const mapM = (p, T) => { if (!mirror) return mapPt(p, W, H, T); const q2 = mapPt({ x: W - p.x, y: p.y }, W, H, T); return { x: W - q2.x, y: q2.y } }
  const stats = (series) => {
    const k = series.find(Boolean).length, still = series.slice(15, 60).filter(Boolean)
    const base = Array.from({ length: k }, (_, j) => ({ x: still.reduce((s, a) => s + a[j].x, 0) / still.length, y: still.reduce((s, a) => s + a[j].y, 0) / still.length }))
    let jit = 0, n = 0, err = [], missing = 0
    still.forEach((a) => a.forEach((p, j) => { jit += (p.x - base[j].x) ** 2 + (p.y - base[j].y) ** 2; n++ }))
    for (let i = 60; i < N; i++) { const a = series[i]; if (!a) { missing++; continue } a.forEach((p, j) => { const g = mapM(base[j], seq[i]); err.push(Math.hypot(p.x - g.x, p.y - g.y)) }) }
    err.sort((x, y) => x - y)
    return { still: +Math.sqrt(jit / n).toFixed(2), mean: +(err.reduce((s, v) => s + v, 0) / err.length).toFixed(2), p95: +err[Math.floor(err.length * 0.95)].toFixed(2), max: +err[err.length - 1].toFixed(2), missing }
  }
  const res = {}; for (const k in pipes) res[k] = { ear: stats(rec[k]), lip: stats(lips[k]) }
  return res
}
const LIP = [61, 291, 0, 17, 13, 14]
function pipelines(W, H, mirror, extra = {}) {
  const ORIG_LOBE = (M) => [[234, 454], [454, 234]].map(([e, o]) => { const P = M.P, d = { x: P[e].x - P[o].x, y: P[e].y - P[o].y }, l = Math.hypot(d.x, d.y) || 1; return { x: P[e].x + (d.x / l) * M.fw * 0.045 - M.up.x * M.fh * 0.15, y: P[e].y + (d.y / l) * M.fw * 0.045 - M.up.y * M.fh * 0.15 } })
  return {
    raw: () => { const h = new HeadTracker({ pos: [1e4, 0], rot: [1e4, 0], scale: [1e4, 0] }, { minCutoff: 1e4, beta: 0 }); return (lm, t) => { const M = lm && h.update(lm, W, H, mirror, t); return M && { ear: ['lobeL', 'lobeR'].map((n) => M.project(n)), lip: LIP.map((k) => M.P[k]) } } },
    orig: () => { const f = new OrigFace(); return (lm) => { if (!lm) return null; f.update(lm, W, H, mirror); const M = f.update(lm, W, H, mirror); return { ear: ORIG_LOBE(M), lip: LIP.map((k) => M.P[k]) } } },
    prev: () => { const f = new OldFace(); let last = null; return (lm, t) => { const M = lm && f.update(lm, W, H, mirror, t / 1000); if (M) last = M; return last && { ear: oldEars(last.frame), lip: LIP.map((k) => last.Pm[k]) } } },
    new: () => { const h = new HeadTracker(); return (lm, t) => { const M = h.update(lm, W, H, mirror, t); return M && { ear: ['lobeL', 'lobeR'].map((n) => M.project(n)), lip: LIP.map((k) => M.P[k]) } } },
    ...extra,
  }
}
let OrigFace
async function motion() {
  OrigFace = (await import('./orig/face.js')).Face
  const img = await load('./img/' + (q.get('img') || 'portrait.png')), W = 960, H = 720, mirror = q.get('mirror') !== '0', N = +(q.get('n') || 240)
  const seq = makeSeq(N), d = window.__cache || await detectSequence(img, W, H, N, seq, 4)
  const res = { delegate: d.delegate, detectMs: +d.ms.toFixed(1), clean: evaluate(d.lms, seq, W, H, mirror, pipelines(W, H, mirror)), cam: evaluate(addCamNoise(d.lms, W, H, 0.9), seq, W, H, mirror, pipelines(W, H, mirror)) }
  window.__lms = d.lms
  if (q.get('grid')) { // parameter search for the rigid filter
    const grid = []
    for (const pc of [1, 1.6]) for (const pb of [30, 45, 70, 100]) for (const rb of [16, 30, 50]) {
      const prof = { pos: [pc, pb], rot: [pc, rb], scale: [pc, pb] }
      const mk = { t: () => { const h = new HeadTracker(prof); return (lm, t) => { const M = h.update(lm, W, H, mirror, t); return M && { ear: ['lobeL', 'lobeR'].map((n) => M.project(n)), lip: LIP.map((k) => M.P[k]) } } } }
      const a = evaluate(d.lms, seq, W, H, mirror, mk).t, b = evaluate(addCamNoise(d.lms, W, H, 0.9), seq, W, H, mirror, mk).t
      grid.push({ pc, pb, rb, cleanEar: a.ear, camEar: b.ear, camLip: b.lip })
    }
    grid.sort((x, y) => (x.camEar.still * 3 + x.camEar.mean) - (y.camEar.still * 3 + y.camEar.mean))
    res.grid = grid.slice(0, 8)
  }
  window.__result = res; log(JSON.stringify(res, null, 1))
}

// Nails on a real hand photo: real Hand Landmarker -> nail geometry -> nail rendering. Screenshot for visual review.
import { drawNails, nailGeometry } from '../src/tryon/nails.js'
async function nails() {
  const img = await load('./img/' + (q.get('img') || 'hand3.png')), H = 720, W = Math.round(img.width * H / img.height), mirror = q.get('mirror') === '1'
  const det = await createHandTracker()
  const f = document.createElement('canvas'); f.width = W; f.height = H; f.getContext('2d').drawImage(img, 0, 0, W, H)
  let r; for (let i = 0; i < 5; i++) r = det.detectForVideo(f, i * 33 + 1)
  const hands = r.landmarks.map((lm, i) => ({ P: lm.map((p) => ({ x: p.x * W, y: p.y * H })), Wd: r.worldLandmarks[i], right: r.handedness[i][0].categoryName === 'Left', label: r.handedness[i][0].categoryName, score: r.handedness[i][0].score }))
  cv.width = W; cv.height = H
  const raw = document.createElement('canvas'); raw.width = W; raw.height = H; const rx = raw.getContext('2d'); if (mirror) { rx.translate(W, 0); rx.scale(-1, 1) } rx.drawImage(f, 0, 0)
  cx.drawImage(raw, 0, 0)
  const state = { [q.get('p') || 'np-red']: { shade: +(q.get('shade') || 0), v: 0.9, shape: q.get('shape') || 'round', finish: 'gloss', show: q.get('show') || 'auto' } }
  drawNails(cx, hands, state, 0, raw, mirror)
  if (q.get('dots')) hands.forEach((h) => h.P.forEach((p, i) => { cx.fillStyle = '#0f0'; cx.fillRect((mirror ? W - p.x : p.x) - 2, p.y - 2, 4, 4) }))
  const res = { delegate: det.__delegate, hands: hands.map((h) => ({ label: h.label, score: +h.score.toFixed(2), nails: nailGeometry(h).map((g) => ({ f: g.f, facing: +g.facing.toFixed(2), vis: +g.vis.toFixed(2), centre: [+(g.base.x + g.along.x / 2).toFixed(1), +(g.base.y + g.along.y / 2).toFixed(1)], len: +Math.hypot(g.along.x, g.along.y).toFixed(1) })), P: h.P.map((p) => [+p.x.toFixed(1), +p.y.toFixed(1)]) })) }
  window.__result = res; log(JSON.stringify(res))
}

import { createSegmenter } from '../src/tryon/track/mediapipe.js'
async function seg() {
  const img = await load('./img/portrait.png'), W = 960, H = 720, det = await createSegmenter()
  const f = frame(img, W, H, { tx: 0, ty: 0, r: 0, s: 1 }, 0)
  let info
  for (let i = 0; i < 3; i++) det.segmentForVideo(f, i * 33 + 1, (r) => { const m = r.categoryMask; const a = m.getAsUint8Array(); const hist = {}; a.forEach((v) => { hist[v] = (hist[v] || 0) + 1 }); info = { w: m.width, h: m.height, hist, labels: det.getLabels ? det.getLabels() : null }
    if (i === 2) { cv.width = W; cv.height = H; cx.drawImage(f, 0, 0); const id = cx.getImageData(0, 0, W, H); for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const v = a[Math.floor(y * m.height / H) * m.width + Math.floor(x * m.width / W)]; if (v === 1) { const k = (y * W + x) * 4; id.data[k] = 255; id.data[k + 1] *= 0.4 } } cx.putImageData(id, 0, 0) } })
  window.__result = info; log(JSON.stringify(info))
}
;({ anchors, motion, nails, seg, occl, hairc, nailmotion, garment, outfit, outfitgeo, posecost, outfitjitter })[test]().catch((e) => { window.__result = { error: String(e && e.stack || e) }; log('ERROR', e && e.stack || e) })

// Hair mask refinement + makeup occlusion on a real portrait: raw segmenter labels vs guided-filter mask, and makeup drawn
// without / with the occlusion cut. Tiles: [raw mask] [refined mask] [makeup, no cut] [makeup, cut].
import { createMasks, cutOccluders } from '../src/tryon/render/masks.js'
import { drawMakeup } from '../src/tryon/makeup.js'
import { createFaceMesh } from '../src/tryon/render/facemesh.js'
import { FACE_OVAL } from '../src/tryon/hair.js'
async function occl() {
  const img = await load('./img/' + (q.get('img') || 'portrait.png')), W = 960, H = 720
  const det = await createFaceTracker(), seg = await createSegmenter(), head = new HeadTracker(), masks = createMasks(false), mesh = createFaceMesh()
  const f = frame(img, W, H, { tx: 0, ty: 0, r: 0, s: +(q.get('s') || 1) }, 0)
  let M, labels, mw, mh
  for (let i = 0; i < 8; i++) { M = head.update(det.detectForVideo(f, i * 33 + 1).faceLandmarks[0], W, H, false, i * 33 + 1); seg.segmentForVideo(f, i * 33 + 1, (r) => { const m = r.categoryMask; labels = m.getAsUint8Array().slice(); mw = m.width; mh = m.height }) }
  let ms = 0; for (let k = 0; k < 6; k++) { const t0 = performance.now(); masks.update(labels, mw, mh, f, false, 0); ms = performance.now() - t0 } // steady state (after warm-up)
  const masksP = createMasks(true); let msP = 0; for (let k = 0; k < 6; k++) { const t0 = performance.now(); masksP.update(labels, mw, mh, f, false, 0); msP = performance.now() - t0 }
  const tile = 400, cxp = M.P[1].x, cyp = M.P[1].y - 40, sz = 520
  cv.width = tile * 4; cv.height = tile
  const put = (src, k) => cx.drawImage(src, cxp - sz / 2, cyp - sz / 2, sz, sz, k * tile, 0, tile, tile)
  const tint = (maskCv, smooth) => { const c = document.createElement('canvas'); c.width = W; c.height = H; const x = c.getContext('2d'); x.drawImage(f, 0, 0); const m = document.createElement('canvas'); m.width = W; m.height = H; const mx = m.getContext('2d'); mx.imageSmoothingEnabled = smooth; mx.drawImage(maskCv, 0, 0, W, H); mx.globalCompositeOperation = 'source-in'; mx.fillStyle = 'rgba(255,0,90,0.55)'; mx.fillRect(0, 0, W, H); x.drawImage(m, 0, 0); return c }
  const rawCv = document.createElement('canvas'); rawCv.width = mw; rawCv.height = mh; const rx = rawCv.getContext('2d'), id = rx.createImageData(mw, mh); labels.forEach((v, i) => { id.data[i * 4 + 3] = v === 1 ? 255 : 0 }); rx.putImageData(id, 0, 0)
  put(tint(rawCv, false), 0); put(tint(masks.hair, true), 1)
  const state = JSON.parse(q.get('state') || '{"foundation":{"shade":1,"v":0.7},"blush":{"shade":2,"v":0.9},"lipstick":{"shade":0,"v":0.8},"eyeliner":{"shade":0,"v":0.9},"brows":{"shade":0,"v":0.8}}')
  const mk = (cut) => { const c = document.createElement('canvas'); c.width = W; c.height = H; const x = c.getContext('2d'); x.drawImage(f, 0, 0); const L = document.createElement('canvas'); L.width = W; L.height = H; drawMakeup(L.getContext('2d'), M, state, f, mesh); if (cut) cutOccluders(L.getContext('2d'), masks, FACE_OVAL.map((i) => M.P[i]), W, H, [[33, 246, 161, 160, 159, 158, 157, 173, 133, 155, 154, 153, 145, 144, 163, 7], [263, 466, 388, 387, 386, 385, 384, 398, 362, 382, 381, 380, 374, 373, 390, 249], [46, 53, 52, 65, 55, 107, 66, 105, 63, 70], [276, 283, 282, 295, 285, 336, 296, 334, 293, 300]].map((ix) => ({ poly: ix.map((i) => M.P[i]), pad: M.fw * 0.03 }))); x.drawImage(L, 0, 0); return c }
  put(mk(false), 2); put(mk(true), 3)
  const hairPx = labels.reduce((n, v) => n + (v === 1), 0)
  window.__result = { mw, mh, hairPx, refineMs: +ms.toFixed(1), work: masks.size, refineMsPhoneSize: +msP.toFixed(1), workPhone: masksP.size }
}

// ---------- hair colour pipeline: before (binary mask + 2D tint), Update 11 (refined mask + 2D tint), new (protected mask + GPU) ----------
// Real photos, real Hair Segmenter + Face Landmarker. Measures, per shade:
//   skin spill  - average colour change on face skin below the eyebrows (should be ~0)
//   bg spill    - average colour change on bright background pixels near the hair (halo)
//   texture     - correlation of fine brightness detail (strands) in the hair before vs after (1 = all texture kept)
//   hue error   - angle between the result's mean hair colour and the shade, in the a/b colour plane (degrees)
// plus mask alignment while the head moves with the segmenter running on every 3rd frame (IoU vs a fresh mask), flicker on a
// still noisy picture, and hue error under dim and warm light.
import { createHairRenderer, HAIR } from '../src/tryon/hair.js'
import { tintRegion, meanLum } from '../src/tryon/render/tint.js'
async function hairc() {
  const which = q.get('img') || 'portrait.png', W = 960, H = 720
  let img = await load('./img/' + which)
  if (q.get('crop')) { const [x, y, s] = q.get('crop').split(',').map(Number), c = document.createElement('canvas'); c.width = c.height = s; c.getContext('2d').drawImage(img, x, y, s, s, 0, 0, s, s); img = c }
  const det = await createFaceTracker(), seg = await createSegmenter()
  const shades = HAIR[0].shades.filter((s) => ['Black', 'Honey blonde', 'Platinum', 'Burgundy', 'Rose pink', 'Copper'].includes(s.n))
  let clock = 1; const KEEP_OFF = q.get('keep') === '0'
  const analyse = (f, _t, head, masks, motion) => {
    const t = (clock += 34)
    const lm = det.detectForVideo(f, t).faceLandmarks[0] || null, M = head.update(lm, W, H, false, t); let labels, mw, mh
    seg.segmentForVideo(f, t, (r) => { const m = r.categoryMask; labels = m.getAsUint8Array().slice(); mw = m.width; mh = m.height })
    if (masks) masks.update(labels, mw, mh, f, false, motion, M && KEEP_OFF !== true ? { x: M.P[1].x, y: M.P[1].y - M.fh * 0.1, rx: M.fw3 * 0.65, ry: M.fh * 0.8 } : null)
    return { lm, M, labels, mw, mh }
  }
  const binMask = (labels, mw, mh) => { const c = document.createElement('canvas'); c.width = mw; c.height = mh; const x = c.getContext('2d'), d = x.createImageData(mw, mh); labels.forEach((v, i) => { d.data[i * 4 + 3] = v === 1 ? 255 : 0 }); x.putImageData(d, 0, 0); return c }
  const px = (c) => c.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, W, H).data
  const lab = (r, g, b) => { const f = (v) => { v /= 255; return v > 0.04045 ? ((v + 0.055) / 1.055) ** 2.4 : v / 12.92 }; const R = f(r), G = f(g), B = f(b); const X = 0.4124 * R + 0.3576 * G + 0.1805 * B, Y = 0.2126 * R + 0.7152 * G + 0.0722 * B, Z = 0.0193 * R + 0.1192 * G + 0.9505 * B; const g3 = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116); const fx = g3(X / 0.9505), fy = g3(Y), fz = g3(Z / 1.089); return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)] }
  // ---- 1. still frame: quality per shade ----
  const head0 = new HeadTracker(), masks0 = createMasks(false)
  const f0 = frame(img, W, H, { tx: 0, ty: 0, r: 0, s: 1 }, 2); let A
  for (let i = 0; i < 6; i++) A = analyse(f0, i * 33 + 1, head0, masks0, null)
  const M = A.M, base = px(f0), bin = binMask(A.labels, A.mw, A.mh), binD = bin.getContext('2d').getImageData(0, 0, A.mw, A.mh).data
  // regions
  const reg = document.createElement('canvas'); reg.width = W; reg.height = H; const rx = reg.getContext('2d', { willReadFrequently: true })
  const poly = (ids) => { rx.beginPath(); ids.forEach((i, k) => (k ? rx.lineTo(M.P[i].x, M.P[i].y) : rx.moveTo(M.P[i].x, M.P[i].y))); rx.closePath() }
  const browY = Math.max(M.P[105].y, M.P[334].y) + M.fw * 0.03
  rx.fillStyle = '#f00'; poly(FACE_OVAL); rx.fill(); rx.clearRect(0, 0, W, browY)
  rx.globalCompositeOperation = 'destination-out'; [[33, 133, 145, 159], [263, 362, 374, 386], [61, 0, 291, 17]].forEach((ids) => { rx.beginPath(); rx.arc(ids.reduce((s, i) => s + M.P[i].x, 0) / 4, ids.reduce((s, i) => s + M.P[i].y, 0) / 4, M.fw * 0.12, 0, 7); rx.fill() })
  const skinR = rx.getImageData(0, 0, W, H).data
  const isHair = (x, y) => binD[(Math.floor(y * A.mh / H) * A.mw + Math.floor(x * A.mw / W)) * 4 + 3] > 0
  const core = new Uint8Array(W * H), near = new Uint8Array(W * H)
  for (let y = 6; y < H - 6; y++) for (let x = 6; x < W - 6; x++) {
    const i = y * W + x, hHere = isHair(x, y)
    if (hHere && isHair(x - 5, y) && isHair(x + 5, y) && isHair(x, y - 5) && isHair(x, y + 5)) core[i] = 1
    if (!hHere) { let nh = false; for (const [dx, dy] of [[-12, 0], [12, 0], [0, -12], [0, 12], [-8, -8], [8, -8]]) if (isHair(x + dx, y + dy)) nh = true; const o = i * 4; if (nh && base[o] > 200 && base[o + 1] > 200 && base[o + 2] > 200) near[i] = 1 }
  }
  const blurL = (d) => { const c = document.createElement('canvas'); c.width = W; c.height = H; const x = c.getContext('2d'); const id = x.createImageData(W, H); id.data.set(d); x.putImageData(id, 0, 0); const b = document.createElement('canvas'); b.width = W; b.height = H; const bx = b.getContext('2d', { willReadFrequently: true }); bx.filter = 'blur(2px)'; bx.drawImage(c, 0, 0); return bx.getImageData(0, 0, W, H).data }
  const baseBlur = blurL(base)
  const score = (out, col) => {
    const ob = blurL(out); let ss = 0, sn = 0, bs = 0, bn = 0, sxy = 0, sxx = 0, syy = 0, L = [0, 0, 0], ln = 0
    for (let i = 0; i < W * H; i++) {
      const o = i * 4, dd = (Math.abs(out[o] - base[o]) + Math.abs(out[o + 1] - base[o + 1]) + Math.abs(out[o + 2] - base[o + 2])) / 3
      if (skinR[o + 3]) { ss += dd; sn++ }
      if (near[i]) { bs += dd; bn++ }
      if (core[i]) { const yb = 0.299 * (base[o] - baseBlur[o]) + 0.587 * (base[o + 1] - baseBlur[o + 1]) + 0.114 * (base[o + 2] - baseBlur[o + 2]), yo = 0.299 * (out[o] - ob[o]) + 0.587 * (out[o + 1] - ob[o + 1]) + 0.114 * (out[o + 2] - ob[o + 2]); sxy += yb * yo; sxx += yb * yb; syy += yo * yo; const l = lab(out[o], out[o + 1], out[o + 2]); L[0] += l[0]; L[1] += l[1]; L[2] += l[2]; ln++ }
    }
    const t = lab(...[1, 3, 5].map((k) => parseInt(col.slice(k, k + 2), 16))), m = L.map((v) => v / ln)
    const hueErr = Math.hypot(t[1], t[2]) < 8 ? null : Math.abs(((Math.atan2(m[2], m[1]) - Math.atan2(t[2], t[1])) * 57.3 + 540) % 360 - 180)
    return { skinSpill: +(ss / sn).toFixed(2), bgSpill: +(bs / (bn || 1)).toFixed(2), texture: +(sxy / Math.sqrt(sxx * syy || 1)).toFixed(3), hueErr: hueErr == null ? null : +hueErr.toFixed(1), meanL: +m[0].toFixed(1), targetL: +t[0].toFixed(1) }
  }
  const before = (c, col, v) => { const lum = meanLum(f0, bin); tintRegion(c, bin, col, v, lum, W, H, { minScale: 0.3, lighten: 0.75, richness: 0.25 }) }
  const upd11 = (c, col, v) => { const lum = meanLum(f0, masks0.hair); tintRegion(c, masks0.hair, col, v, lum, W, H, { minScale: 0.3, lighten: 0.75, richness: 0.25 }) }
  const hr = createHairRenderer()
  const render = (kind, sh, src = f0, Mx = M, maskCv = masks0.hair) => { const c = document.createElement('canvas'); c.width = W; c.height = H; const x = c.getContext('2d'); x.drawImage(src, 0, 0); const st = { haircolor: { shade: HAIR[0].shades.indexOf(sh), v: 0.85 } }; if (kind === 'before') before(x, sh.c, 0.85); else if (kind === 'update11') upd11(x, sh.c, 0.85); else { hr.reset(); hr.draw(x, maskCv, st, W, H, src, Mx, null) } return c }
  const res = { img: which, quality: {} }
  cv.width = 3 * 300; cv.height = shades.length * 300
  const cropC = (c, k, r) => { const s = M.fw * 2.2; cx.drawImage(c, M.P[1].x - s / 2, M.P[1].y - s * 0.62, s, s, k * 300, r * 300, 300, 300) }
  shades.forEach((sh, r) => {
    res.quality[sh.n] = {}
    ;['before', 'update11', 'new'].forEach((kind, k) => {
      const c = render(kind, sh)
      res.quality[sh.n][kind] = score(px(c), sh.c); cropC(c, k, r)
    })
  })
  // ---- 2. movement: segmenter every 3rd frame; how well the (moved) mask matches a fresh one ----
  const N = 36, seq = Array.from({ length: N }, (_, i) => { const u = i / N; return { tx: 70 * Math.sin(u * 2 * Math.PI), ty: 20 * Math.sin(u * 4 * Math.PI), r: 0.2 * Math.sin(u * 2 * Math.PI + 1), s: 1 + 0.12 * Math.sin(u * 2 * Math.PI + 2) } })
  const headM = new HeadTracker(), masksM = createMasks(false), masksF = createMasks(false), hrm = createHairRenderer()
  let segEyes = null, segNose = null; const iou = { none: [], move: [], moveTurn: [] }
  const eyesOf = (lm) => [{ x: lm[33].x * W, y: lm[33].y * H }, { x: lm[263].x * W, y: lm[263].y * H }]
  const simT = (from, to) => { const [A1, B1] = from, [A2, B2] = to, vx = B1.x - A1.x, vy = B1.y - A1.y, ux = B2.x - A2.x, uy = B2.y - A2.y; const k = Math.hypot(ux, uy) / Math.hypot(vx, vy), rr = Math.atan2(uy, ux) - Math.atan2(vy, vx), a = k * Math.cos(rr), b = k * Math.sin(rr); return { a, b, c: -b, d: a, e: A2.x - (a * A1.x - b * A1.y), f: A2.y - (b * A1.x + a * A1.y) } }
  const maskAt = (maskCv, T) => { const c = document.createElement('canvas'); c.width = W; c.height = H; const x = c.getContext('2d'); if (T) x.setTransform(T.a, T.b, T.c, T.d, T.e, T.f); x.drawImage(maskCv, 0, 0, W, H); return x.getImageData(0, 0, W, H).data }
  for (let i = 0; i < N; i++) {
    const f = frame(img, W, H, seq[i], 2), t = (clock += 34)
    const lm = det.detectForVideo(f, t).faceLandmarks[0]; if (!lm) continue
    const eyes = eyesOf(lm), nose = { x: lm[168].x * W, y: lm[168].y * H }
    let labels, mw, mh; seg.segmentForVideo(f, t, (r) => { const m = r.categoryMask; labels = m.getAsUint8Array().slice(); mw = m.width; mh = m.height })
    if (i % 3 === 0) { masksM.update(labels, mw, mh, f, false, null); segEyes = eyes; segNose = nose; continue }
    masksF.reset(); masksF.update(labels, mw, mh, f, false, null)
    const fresh = maskAt(masksF.hair, null)
    for (const [k, T] of [['none', null], ['move', { a: 1, b: 0, c: 0, d: 1, e: nose.x - segNose.x, f: nose.y - segNose.y }], ['moveTurn', simT(segEyes, eyes)]]) {
      const d = maskAt(masksM.hair, T); let inter = 0, uni = 0
      for (let p = 3; p < d.length; p += 16) { const a1 = d[p] > 127, b1 = fresh[p] > 127; if (a1 && b1) inter++; if (a1 || b1) uni++ }
      iou[k].push(inter / (uni || 1))
    }
  }
  const avg = (a) => +(a.reduce((s, v) => s + v, 0) / a.length).toFixed(3)
  res.movementIoU = { none: avg(iou.none), positionOnly: avg(iou.move), positionSizeRotation: avg(iou.moveTurn) }
  // ---- 3. flicker on a still, noisy picture: average frame-to-frame change of the mask at the hair edge ----
  const masksS = createMasks(false); let prevB = null, prevN = null; const flick = { binary: [], refined: [] }
  for (let i = 0; i < 12; i++) {
    const f = frame(img, W, H, { tx: 0, ty: 0, r: 0, s: 1 }, 3), t = (clock += 34); let labels, mw, mh
    seg.segmentForVideo(f, t, (r) => { const m = r.categoryMask; labels = m.getAsUint8Array().slice(); mw = m.width; mh = m.height })
    masksS.update(labels, mw, mh, f, false, { dx: 0, dy: 0, rel: 0 })
    const b = maskAt(binMask(labels, mw, mh), null), n = maskAt(masksS.hair, null)
    if (prevB) { let db = 0, dn = 0, c = 0; for (let p = 3; p < b.length; p += 8) { const edge = (b[p] > 0) !== (prevB[p] > 0) || (n[p] > 20 && n[p] < 235); if (!edge && !(b[p] > 0 && b[p] < 255)) continue; db += Math.abs(b[p] - prevB[p]); dn += Math.abs(n[p] - prevN[p]); c++ } if (i > 3) { flick.binary.push(db / (c || 1) / 255); flick.refined.push(dn / (c || 1) / 255) } }
    prevB = b; prevN = n
  }
  res.flicker = { binary: avg(flick.binary), refined: avg(flick.refined) }
  // ---- 4. lighting: hue error with dim and warm light ----
  res.lighting = {}
  for (const [name, mul] of [['dim', [0.55, 0.55, 0.55]], ['warm', [1.08, 0.92, 0.7]], ['cool', [0.85, 0.95, 1.1]]]) {
    const f = document.createElement('canvas'); f.width = W; f.height = H; const fx = f.getContext('2d', { willReadFrequently: true }); fx.drawImage(f0, 0, 0); const id = fx.getImageData(0, 0, W, H); for (let p = 0; p < id.data.length; p += 4) for (let k = 0; k < 3; k++) id.data[p + k] = Math.min(255, id.data[p + k] * mul[k]); fx.putImageData(id, 0, 0)
    const hL = new HeadTracker(), mL = createMasks(false); let B2; for (let i = 0; i < 5; i++) B2 = analyse(f, 20000 + i * 33, hL, mL, null)
    res.lighting[name] = {}
    for (const sh of shades.filter((s) => ['Burgundy', 'Copper', 'Rose pink'].includes(s.n))) {
      const c = document.createElement('canvas'); c.width = W; c.height = H; const x = c.getContext('2d'); x.drawImage(f, 0, 0); const hr2 = createHairRenderer(); hr2.draw(x, mL.hair, { haircolor: { shade: HAIR[0].shades.indexOf(sh), v: 0.85 } }, W, H, f, B2.M, null)
      const o = px(c); let L = [0, 0, 0], n = 0; for (let i = 0; i < W * H; i++) if (core[i]) { const l = lab(o[i * 4], o[i * 4 + 1], o[i * 4 + 2]); L[0] += l[0]; L[1] += l[1]; L[2] += l[2]; n++ }
      const t = lab(...[1, 3, 5].map((k) => parseInt(sh.c.slice(k, k + 2), 16))), m = L.map((v) => v / n)
      res.lighting[name][sh.n] = +Math.abs(((Math.atan2(m[2], m[1]) - Math.atan2(t[2], t[1])) * 57.3 + 540) % 360 - 180).toFixed(1)
    }
  }
  window.__result = res
}

// ---------- hands and nails under movement (track/hands.js + nails.js nailGeometry) ----------
// A real hand photo moved with KNOWN transforms (side to side, up and down, wrist rotation +-29 deg in the picture plane,
// closer / farther 0.7x-1.3x) with camera noise; the real Hand Landmarker runs on every frame. The nails found on the still
// picture, moved by the known transform, are the ground truth. Scenarios: normal, 15% missed frames, 20% of frames with the
// left/right label flipped, 3% wrong detections. Compares the previous hand tracking with the new one.
import { HandTracker } from '../src/tryon/track/hands.js'
async function nailmotion() {
  const img = await load('./img/' + (q.get('img') || 'hand1.jpg')), H = 720, W = Math.round(Math.min(1280, (img.width * H) / img.height))
  const det = await createHandTracker(); let clock = 1
  const detect = (f) => { const r = det.detectForVideo(f, (clock += 34)); return { landmarks: r.landmarks.map((l) => l.map((p) => ({ ...p }))), worldLandmarks: r.worldLandmarks.map((l) => l.map((p) => ({ ...p }))), handedness: r.handedness.map((h) => h.map((c) => ({ ...c }))) } }
  const still = frame(img, W, H, { tx: 0, ty: 0, r: 0, s: 1 }, 2); let ref
  { const tr = new HandTracker(); let hs; for (let i = 0; i < 12; i++) hs = tr.update(detect(still), W, H, i * 33.3); ref = hs.map((h) => nailGeometry(h)) }
  const centre = (g) => ({ x: g.base.x + g.along.x * 0.5, y: g.base.y + g.along.y * 0.5 })
  const N = +(q.get('n') || 90), seq = Array.from({ length: N }, (_, i) => { const u = i / N, s = Math.sin; return { tx: 90 * s(u * 2 * Math.PI), ty: 40 * s(u * 4 * Math.PI), r: 0.5 * s(u * 2 * Math.PI + 1), s: 1 + 0.3 * s(u * 2 * Math.PI + 2) } })
  const dets = seq.map((T) => detect(frame(img, W, H, T, 3)))
  let seed2 = 99; const rnd2 = () => { seed2 = (seed2 * 1103515245 + 12345) % 2147483648; return seed2 / 2147483648 }
  const scen = (kind) => { seed2 = 99; return dets.map((r, i) => { if (kind === 'dropout' && rnd2() < 0.15) return { landmarks: [], worldLandmarks: [], handedness: [] }; if (kind === 'flip' && rnd2() < 0.2) return { ...r, handedness: r.handedness.map((h) => h.map((c) => ({ ...c, categoryName: c.categoryName === 'Left' ? 'Right' : 'Left' }))) }; if (kind === 'glitch' && i > 12 && rnd2() < 0.03) return dets[i - 10]; return r }) }
  const run = (mk, kind) => {
    const tr = mk(), errs = [], angs = [], sizes = [], visFlips = []; const sc = scen(kind); let prevVis = null
    sc.forEach((r, i) => {
      const hs = tr.update(r, W, H, 1000 + i * 33.3); if (!hs.length || !ref.length) return
      const gs = nailGeometry(hs[0]), T = seq[i]
      ref[0].forEach((g0, f) => {
        if (g0.vis < 0.5) return
        const g = gs[f], c = centre(g), t = mapPt(centre(g0), W, H, T), L0 = Math.hypot(g0.along.x, g0.along.y) * T.s
        errs.push(Math.hypot(c.x - t.x, c.y - t.y) / L0)
        angs.push(Math.abs(((Math.atan2(g.along.y, g.along.x) - Math.atan2(g0.along.y, g0.along.x) - T.r) * 57.3 + 540) % 360 - 180))
        sizes.push(Math.hypot(g.along.x, g.along.y) / L0)
      })
      const vis = gs.map((g) => g.vis > 0.5); if (prevVis) visFlips.push(vis.filter((v, f) => v !== prevVis[f] && ref[0][f].vis > 0.5).length); prevVis = vis
    })
    const sorted = [...errs].sort((a, b) => a - b), qq = (p) => +(sorted[Math.floor(p * (sorted.length - 1))] || 0).toFixed(3)
    return { n: errs.length, posMed: qq(0.5), posP95: qq(0.95), posMax: qq(1), angMed: +(angs.sort((a, b) => a - b)[angs.length >> 1] || 0).toFixed(1), sizeMed: +(sizes.sort((a, b) => a - b)[sizes.length >> 1] || 0).toFixed(3), visibilityFlips: visFlips.reduce((a, b) => a + b, 0) }
  }
  const gd = q.get('gd') ? +q.get('gd') : undefined, gt = q.get('gt') ? +q.get('gt') : undefined
  const OLD = () => new HandTracker({ identity: false, predict: false, guard: false }), NEW = () => new HandTracker({ guardDist: gd, guardTurn: gt })
  const res = { img: q.get('img') || 'hand1.jpg', refNails: ref[0]?.map((g) => +g.vis.toFixed(2)), detected: dets.filter((r) => r.landmarks.length).length + '/' + N }
  for (const kind of ['normal', 'dropout', 'flip', 'glitch']) res[kind] = { old: run(OLD, kind), new: run(NEW, kind) }
  window.__result = res
}

// ---- garment cut-out: synthetic garment photos (known true outline) on plain and busy backgrounds; old (plain flood fill only) vs new ----
async function garment() {
  const { prepGarment } = await import('../src/tryon/outfit.js'), { cutBusy } = await import('../src/tryon/garmentcut.js')
  const tee = await load('./img/garment-tee.png'), photo = await load('./img/pose.jpg'), W = 600, H = 700
  // true garment shape from the synthetic tee (blue on white)
  const mk = () => { const c = document.createElement('canvas'); c.width = W; c.height = H; return c }
  const tm = mk(), tx = tm.getContext('2d', { willReadFrequently: true }); tx.drawImage(tee, 0, 0, W, H)
  const td = tx.getImageData(0, 0, W, H).data, shape = new Uint8Array(W * H); for (let o = 0; o < W * H; o++) shape[o] = td[o * 4 + 2] - td[o * 4] > 60 ? 1 : 0
  const S = +(q.get('S') || 0.75), OX = W * (1 - S) / 2 + 8, OY = H * (1 - S) / 2 + 6 // garment placed a little smaller than the photo, slightly off-centre
  const gt = new Uint8Array(W * H); for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) { const si = Math.round((i - OX) / S), sj = Math.round((j - OY) / S); gt[j * W + i] = si >= 0 && sj >= 0 && si < W && sj < H ? shape[sj * W + si] : 0 }
  const fills = {
    blue: (x) => { x.fillStyle = '#1e5aa0'; x.fillRect(0, 0, W, H) },
    stripes: (x) => { for (let j = 0; j < H; j += 28) { x.fillStyle = (j / 28) % 2 ? '#f4f1ea' : '#b8282e'; x.fillRect(0, j, W, 28) } },
    vstripes: (x) => { for (let i = 0; i < W; i += 22) { x.fillStyle = (i / 22) % 2 ? '#f4f1ea' : '#2c4f8c'; x.fillRect(i, 0, 22, H) } },
    print: (x) => { x.fillStyle = '#efe6d2'; x.fillRect(0, 0, W, H); seed = 7; const cols = ['#d94f3d', '#2f7d5b', '#f2b134', '#3a4fa0', '#7a3b69']; for (let n = 0; n < 160; n++) { x.fillStyle = cols[n % 5]; x.beginPath(); x.arc(rnd() * W, rnd() * H, 8 + rnd() * 22, 0, 7); x.fill() } },
    charcoal: (x) => { x.fillStyle = '#2b2b2e'; x.fillRect(0, 0, W, H) },
    beige: (x) => { x.fillStyle = '#c9b79a'; x.fillRect(0, 0, W, H) },
  }
  const bgs = {
    white: (x) => { x.fillStyle = '#ffffff'; x.fillRect(0, 0, W, H) },
    checker: (x) => { for (let j = 0; j < H; j += 20) for (let i = 0; i < W; i += 20) { x.fillStyle = ((i + j) / 20) % 2 ? '#cccccc' : '#ffffff'; x.fillRect(i, j, 20, 20) } },
    gradient: (x) => { const g = x.createLinearGradient(0, 0, W, H); g.addColorStop(0, '#e8dcc8'); g.addColorStop(1, '#8f8a84'); x.fillStyle = g; x.fillRect(0, 0, W, H) },
    wood: (x) => { seed = 3; for (let j = 0; j < H; j += 70) { const b = 120 + rnd() * 40; x.fillStyle = `rgb(${b + 40},${b},${b - 45})`; x.fillRect(0, j, W, 70); x.fillStyle = 'rgba(40,20,0,0.5)'; x.fillRect(0, j, W, 3); for (let n = 0; n < 30; n++) { x.fillStyle = `rgba(60,30,0,${0.08 + rnd() * 0.12})`; x.fillRect(0, j + rnd() * 70, W, 1 + rnd() * 3) } } },
    bedsheet: (x) => { x.fillStyle = '#9fb7c9'; x.fillRect(0, 0, W, H); seed = 5; for (let n = 0; n < 40; n++) { const yy = rnd() * H; const g = x.createLinearGradient(0, yy - 30, 0, yy + 30); g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(0.5, `rgba(${rnd() < 0.5 ? '255,255,255' : '20,30,50'},0.18)`); g.addColorStop(1, 'rgba(0,0,0,0)'); x.fillStyle = g; x.fillRect(0, yy - 30, W, 60) } },
    cobbles: (x) => x.drawImage(photo, 0, 390, 420, 250, 0, 0, W, H),
    trees: (x) => x.drawImage(photo, 120, 0, 330, 220, 0, 0, W, H),
    street: (x) => x.drawImage(photo, 560, 20, 400, 240, 0, 0, W, H),
  }
  const shapeCanvas = mk(), sx = shapeCanvas.getContext('2d'); const sid = sx.createImageData(W, H); for (let o = 0; o < W * H; o++) sid.data[o * 4 + 3] = gt[o] * 255; sx.putImageData(sid, 0, 0)
  const compose = (bg, fill) => {
    const c = mk(), x = c.getContext('2d', { willReadFrequently: true }); bgs[bg](x)
    // soft contact shadow under the garment (like a real flat-lay photo)
    x.save(); x.filter = 'blur(10px)'; x.globalAlpha = 0.35; x.drawImage(shapeCanvas, 6, 10); x.restore(); x.save(); x.globalCompositeOperation = 'source-over'
    const g = mk(), gx = g.getContext('2d'); fills[fill](gx); gx.globalCompositeOperation = 'destination-in'; gx.drawImage(shapeCanvas, 0, 0)
    gx.globalCompositeOperation = 'source-atop'; const sh = gx.createLinearGradient(0, 0, W, 0); sh.addColorStop(0, 'rgba(0,0,0,0.18)'); sh.addColorStop(0.5, 'rgba(255,255,255,0.06)'); sh.addColorStop(1, 'rgba(0,0,0,0.2)'); gx.fillStyle = sh; gx.fillRect(0, 0, W, H) // fabric shading
    x.drawImage(g, 0, 0); x.restore()
    const d = x.getImageData(0, 0, W, H); seed = 11; for (let i = 0; i < d.data.length; i += 4) { const n = gauss() * 3; d.data[i] += n; d.data[i + 1] += n; d.data[i + 2] += n } x.putImageData(d, 0, 0) // camera noise
    return c
  }
  const score = (r) => { // IoU of the cut-out (alpha > 50%) with the true garment, in original photo pixels
    const out = r.canvas, b = out.box || { x: 0, y: 0 }, a = new Uint8Array(W * H)
    const od = out.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, out.width, out.height).data
    for (let j = 0; j < out.height; j++) for (let i = 0; i < out.width; i++) { const X = Math.round(b.x + i), Y = Math.round(b.y + j); if (X >= 0 && Y >= 0 && X < W && Y < H) a[Y * W + X] = od[(j * out.width + i) * 4 + 3] > 127 ? 1 : 0 }
    let inter = 0, uni = 0, miss = 0, extra = 0; for (let o = 0; o < W * H; o++) { inter += a[o] & gt[o]; uni += a[o] | gt[o]; if (gt[o] && !a[o]) miss++; if (a[o] && !gt[o]) extra++ }
    const area = gt.reduce((p, q) => p + q, 0); return { iou: +(inter / uni).toFixed(3), garmentLost: +(miss / area).toFixed(3), backgroundKept: +(extra / area).toFixed(3), mode: r.mode || (r.cleaned ? 'plain' : 'none') }
  }
  const rows = [], show = []
  for (const bg of Object.keys(bgs)) for (const fill of Object.keys(fills)) {
    if (q.get('only') && !q.get('only').split(',').includes(bg)) continue
    const img = compose(bg, fill)
    const o = score(prepGarment(img, { busy: false })), t0 = performance.now(), rn = prepGarment(img), ms = Math.round(performance.now() - t0), n = score(rn)
    rows.push({ bg, fill, old: o, new: { ...n, ms, why: cutBusy.last, diag: rn.diag } }); cutBusy.last = null; if ((q.get('show') || 'print,stripes').split(',').includes(fill)) show.push([img, rn])
  }
  // contact sheet: photo | cut-out on a magenta check (shows what was kept)
  const tw = 150, th = 175; cv.width = tw * 4; cv.height = th * Math.ceil(show.length / 2)
  show.forEach(([img, r], n) => { const X = (n % 2) * tw * 2, Y = ((n / 2) | 0) * th; cx.drawImage(img, X, Y, tw, th); for (let j = 0; j < th; j += 12) for (let i = 0; i < tw; i += 12) { cx.fillStyle = ((i + j) / 12) % 2 ? '#ff00ff' : '#ffb3ff'; cx.fillRect(X + tw + i, Y + j, 12, 12) } const b = r.canvas.box; cx.drawImage(r.canvas, X + tw + b.x * tw / W, Y + b.y * th / H, r.canvas.width * tw / W, r.canvas.height * th / H) })
  const summ = (k, filt) => { const v = rows.filter(filt).map((r) => r[k].iou).sort((a, b) => a - b); return { median: v[v.length >> 1], worst: v[0], n: v.length } }
  const busy = (r) => !['white', 'checker'].includes(r.bg), plainB = (r) => ['white', 'checker'].includes(r.bg)
  window.__result = { summary: { plainOld: summ('old', plainB), plainNew: summ('new', plainB), busyOld: summ('old', busy), busyNew: summ('new', busy), keptAsIs: rows.filter((r) => busy(r) && r.new.mode === 'none').length }, rows }
}

// ---- live outfit on a real photo (pose.jpg: bare arms, black top): old flat garment vs new warp, at 3 camera distances, shifted and tilted ----
// References: the pose model's own person mask at full size (spill outside the body outline, above the hips) and SKIN-coloured pixels
// along the FOREARMS (how much of the real forearms the garment covers; short sleeves should not cover them). Colour: chroma difference (Lab a,b) between the drawn garment and the
// garment photo's own colour (the plain blue tee), and the brightness change.
async function outfit() {
  const { drawOutfit, prepGarment, bodyFrom, resetOutfit } = await import('../src/tryon/outfit.js')
  const img = await load('./img/' + (q.get('img') || 'pose.jpg')), tee = await load('./img/garment-tee.png'), W = 960, H = 720
  const det = await createPoseTracker()
  const g = prepGarment(tee).canvas
  const lab = (r, gg, b) => { const f = (c) => { c /= 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4 }, R = f(r), G = f(gg), B = f(b); const X = (0.4124 * R + 0.3576 * G + 0.1805 * B) / 0.9505, Y = 0.2126 * R + 0.7152 * G + 0.0722 * B, Z = (0.0193 * R + 0.1192 * G + 0.9505 * B) / 1.089; const fl = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116); return [116 * fl(Y) - 16, 500 * (fl(X) - fl(Y)), 200 * (fl(Y) - fl(Z))] }
  const src = lab(30, 90, 160) // the tee's colour (#1e5aa0)
  const scen = [['near', { tx: 0, ty: 60, r: 0, s: 1.25 }], ['mid', { tx: 0, ty: 0, r: 0, s: 1 }], ['far', { tx: 0, ty: -20, r: 0, s: 0.7 }], ['left', { tx: -160, ty: 0, r: 0, s: 0.9 }], ['tilt+', { tx: 0, ty: 0, r: 0.12, s: 1 }], ['tilt-', { tx: 30, ty: 0, r: -0.12, s: 1 }]]
  let clock = 0; const rows = [], tiles = []
  const pc = document.createElement('canvas'); pc.width = Math.round(W / 5); pc.height = Math.round(H / 5)
  for (const [name, T] of scen) {
    const f = frame(img, W, H, T, 2); let res
    for (let i = 0; i < 4; i++) { clock += 34; res = det.detectForVideo(f, clock); if (i < 3) res.segmentationMasks?.forEach((m) => m.close()) }
    const lm = res.landmarks[0]; if (!lm) { rows.push({ name, error: 'no pose' }); continue }
    const P = lm.map((p) => ({ x: p.x * W, y: p.y * H, z: (p.z || 0) * W, v: p.visibility ?? 0 })), B = bodyFrom(P)
    const mk = res.segmentationMasks[0], mw = mk.width, mh = mk.height, mf = mk.getAsFloat32Array().slice(); mk.close()
    { const x = pc.getContext('2d'), d = x.createImageData(pc.width, pc.height); for (let j = 0; j < pc.height; j++) for (let i = 0; i < pc.width; i++) d.data[(j * pc.width + i) * 4 + 3] = mf[Math.min(mh - 1, ((j + 0.5) * mh / pc.height) | 0) * mw + Math.min(mw - 1, ((i + 0.5) * mw / pc.width) | 0)] * 255; x.putImageData(d, 0, 0) }
    const person = (i, j) => mf[Math.min(mh - 1, (j * mh / H) | 0) * mw + Math.min(mw - 1, (i * mw / W) | 0)] > 0.5
    if (!B) { rows.push({ name, error: 'no body' }); continue }
    const rd = f.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, W, H).data
    const hipY = P[23].v > 0.5 && P[24].v > 0.5 ? (P[23].y + P[24].y) / 2 : B.mid.y + B.sw * 1.35
    // arm skin reference: skin-coloured pixels within a wide band around shoulder -> elbow -> wrist
    const segD = (px, py, a, b) => { const vx = b.x - a.x, vy = b.y - a.y, t = Math.max(0, Math.min(1, ((px - a.x) * vx + (py - a.y) * vy) / (vx * vx + vy * vy))); return Math.hypot(px - a.x - vx * t, py - a.y - vy * t) }
    const nearArm = (i, j) => [[13, 15], [14, 16]].some(([a, b]) => P[a].v > 0.5 && P[b].v > 0.5 && segD(i, j, P[a], P[b]) < B.sw * 0.2)
    const skin = (o) => { const r = rd[o], gg = rd[o + 1], b = rd[o + 2]; return r > 95 && gg > 40 && b > 20 && r > gg && r > b && r - Math.min(gg, b) > 15 && Math.abs(r - gg) > 15 }
    const out = {}
    for (const mode of ['flat', 'warp']) {
      resetOutfit(); const c = document.createElement('canvas'); c.width = W; c.height = H; const x = c.getContext('2d', { willReadFrequently: true }); x.drawImage(f, 0, 0)
      drawOutfit(x, B, { 'o-custom': { v: 0.5, dy: 0, len: 1 } }, g, 0, f, P, null, { flat: mode === 'flat', person: mode === 'warp' ? { canvas: pc, off: { x: 0, y: 0 } } : null, light: null })
      { const t0 = performance.now(); for (let r = 0; r < 10; r++) drawOutfit(x, B, { 'o-custom': { v: 0.5, dy: 0, len: 1 } }, g, 0, f, P, null, { flat: mode === 'flat', person: mode === 'warp' ? { canvas: pc, off: { x: 0, y: 0 } } : null, light: null }); var drawMs = (performance.now() - t0) / 10 }
      x.drawImage(f, 0, 0); drawOutfit(x, B, { 'o-custom': { v: 0.5, dy: 0, len: 1 } }, g, 0, f, P, null, { flat: mode === 'flat', person: mode === 'warp' ? { canvas: pc, off: { x: 0, y: 0 } } : null, light: null })
      const cd = x.getImageData(0, 0, W, H).data
      let cov = 0, spill = 0, armSkin = 0, armCov = 0, dC = 0, dL = 0, nC = 0
      for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
        const o = (j * W + i) * 4, covered = Math.abs(cd[o] - rd[o]) + Math.abs(cd[o + 1] - rd[o + 1]) + Math.abs(cd[o + 2] - rd[o + 2]) > 24
        if (j < hipY && covered) { cov++; if (!person(i, j)) spill++ }
        if (nearArm(i, j) && skin(o) && person(i, j)) { armSkin++; if (covered) armCov++ }
        if (covered && (i + j) % 3 === 0 && cd[o + 2] > cd[o] + 30) { const L = lab(cd[o], cd[o + 1], cd[o + 2]); dC += Math.hypot(L[1] - src[1], L[2] - src[2]); dL += L[0] - src[0]; nC++ }
      }
      out[mode] = { spillAboveHips: +(spill / Math.max(1, cov)).toFixed(3), forearmCovered: +(armCov / Math.max(1, armSkin)).toFixed(3), chromaErr: +(dC / Math.max(1, nC)).toFixed(1), lightnessShift: +(dL / Math.max(1, nC)).toFixed(1), drawMs: +drawMs.toFixed(1) }
      tiles.push([name + ' ' + mode, c])
    }
    rows.push({ name, sw: Math.round(B.sw), ...out })
  }
  const big = q.get('big'), tl = big ? tiles.filter(([n]) => n.startsWith(big + ' ')) : tiles
  const tw = big ? 480 : 240, th = big ? 360 : 180; cv.width = tw * 2; cv.height = th * Math.ceil(tl.length / 2)
  tl.forEach(([n, c], k) => { const X = (k % 2) * tw, Y = ((k / 2) | 0) * th; cx.drawImage(c, X, Y, tw, th); cx.fillStyle = '#000a'; cx.fillRect(X, Y, 90, 16); cx.fillStyle = '#fff'; cx.font = '12px sans-serif'; cx.fillText(n, X + 4, Y + 12) })
  const avg = (m, k) => +(rows.filter((r) => r[m]).reduce((a, r) => a + r[m][k], 0) / rows.filter((r) => r[m]).length).toFixed(3)
  window.__result = { mean: Object.fromEntries(['flat', 'warp'].map((m) => [m, Object.fromEntries(['spillAboveHips', 'forearmCovered', 'chromaErr', 'lightnessShift', 'drawMs'].map((k) => [k, avg(m, k)]))])), rows }
}

// ---- garment mesh geometry on synthetic poses (no camera): arms down / out / up / bent / akimbo, leaning, turned ----
// Checks: no folded-over triangles (area that flips), sleeve direction follows the upper arm, garment shoulder points on the body.
async function outfitgeo() {
  const { prepGarment, bodyFrom, garmentGeometry, drawOutfit } = await import('../src/tryon/outfit.js'), { bodyPose, warpMesh } = await import('../src/tryon/render/garmentwarp.js')
  const tee = await load('./img/garment-tee.png'), g = prepGarment(tee).canvas, G = garmentGeometry(g), W = 640, H = 720
  const base = (cxp, sy, sw, lean = 0, yawZ = 0) => { const P = Array.from({ length: 33 }, () => ({ x: 0, y: 0, z: 0, v: 0 })); const set = (i, x, y, z = 0) => { P[i] = { x, y, z, v: 1 } }
    const ux = Math.cos(lean), uy = Math.sin(lean); set(11, cxp + ux * sw / 2, sy + uy * sw / 2, yawZ); set(12, cxp - ux * sw / 2, sy - uy * sw / 2, -yawZ) // 11 = person's left = screen right (front view, not mirrored)
    const hx = cxp - uy * sw * 1.4, hy = sy + ux * sw * 1.4; set(23, hx + ux * sw * 0.32, hy + uy * sw * 0.32); set(24, hx - ux * sw * 0.32, hy - uy * sw * 0.32); return P }
  const arm = (P, s, e, w, a1, a2, L) => { const S = P[s]; P[e] = { x: S.x + Math.cos(a1) * L, y: S.y + Math.sin(a1) * L, z: 0, v: 1 }; P[w] = { x: P[e].x + Math.cos(a2) * L * 0.9, y: P[e].y + Math.sin(a2) * L * 0.9, z: 0, v: 1 } }
  const D = Math.PI / 180, poses = {
    down: (P, L) => { arm(P, 11, 13, 15, 80 * D, 88 * D, L); arm(P, 12, 14, 16, 100 * D, 92 * D, L) },
    out: (P, L) => { arm(P, 11, 13, 15, 0, 0, L); arm(P, 12, 14, 16, 180 * D, 180 * D, L) },
    up: (P, L) => { arm(P, 11, 13, 15, -60 * D, -80 * D, L); arm(P, 12, 14, 16, -120 * D, -100 * D, L) },
    akimbo: (P, L) => { arm(P, 11, 13, 15, 55 * D, 150 * D, L); arm(P, 12, 14, 16, 125 * D, 30 * D, L) },
    crossed: (P, L) => { arm(P, 11, 13, 15, 75 * D, 200 * D, L); arm(P, 12, 14, 16, 105 * D, -20 * D, L) },
    lean: (P, L) => { arm(P, 11, 13, 15, 80 * D, 88 * D, L); arm(P, 12, 14, 16, 100 * D, 92 * D, L) },
    turned: (P, L) => { arm(P, 11, 13, 15, 80 * D, 88 * D, L); arm(P, 12, 14, 16, 100 * D, 92 * D, L) },
  }
  const rows = [], tiles = []
  for (const [name, fn] of Object.entries(poses)) for (const sw of [110, 200]) {
    const P = base(W / 2, 220, sw, name === 'lean' ? 0.15 : 0, name === 'turned' ? sw * 0.35 : 0); fn(P, sw * 0.9)
    const B = bodyFrom(P), body = bodyPose(P, B), Wp = warpMesh(G.geo, G.mesh, body, { v: 0.5, dy: 0, len: 1 })
    // folded-over triangles: signed area flips sign vs the garment's own triangle
    let flip = 0, tot = 0
    const I = G.mesh.idx, uv = G.mesh.uv, ps = Wp.pos
    for (let t = 0; t < I.length; t += 3) { const [a, b, c] = [I[t], I[t + 1], I[t + 2]]; const s0 = (uv[b * 2] - uv[a * 2]) * (uv[c * 2 + 1] - uv[a * 2 + 1]) - (uv[c * 2] - uv[a * 2]) * (uv[b * 2 + 1] - uv[a * 2 + 1]); const s1 = (ps[b * 2] - ps[a * 2]) * (ps[c * 2 + 1] - ps[a * 2 + 1]) - (ps[c * 2] - ps[a * 2]) * (ps[b * 2 + 1] - ps[a * 2 + 1]); tot += Math.abs(s1); if (Math.sign(s0) !== Math.sign(s1)) flip += Math.abs(s1) }
    // sleeve direction on screen (mapped centre line of each sleeve) vs upper arm direction
    const map = (gx, gy) => { let best = 0, bd = 1e9; for (let n = 0; n < G.mesh.n; n++) { const d = (uv[n * 2] - gx) ** 2 + (uv[n * 2 + 1] - gy) ** 2; if (d < bd) { bd = d; best = n } } return { x: ps[best * 2], y: ps[best * 2 + 1] } }
    const errs = [[G.geo.sl, body.aL], [G.geo.sr, body.aR]].filter(([sg]) => sg).map(([sg, a]) => { const p0 = map(sg.S.x + sg.dir.x * sg.len * 0.25, sg.S.y + sg.dir.y * sg.len * 0.25), p1 = map(sg.S.x + sg.dir.x * sg.len * 0.85, sg.S.y + sg.dir.y * sg.len * 0.85); const d1 = Math.atan2(p1.y - p0.y, p1.x - p0.x), d2 = Math.atan2(a.E.y - a.S.y, a.E.x - a.S.x); return Math.abs(((d1 - d2) / D + 540) % 360 - 180) })
    // garment shoulder points vs the outside of the body's shoulders
    const sh = [map(G.geo.cx - G.geo.shHalf, G.geo.sh), map(G.geo.cx + G.geo.shHalf, G.geo.sh)], out = [{ x: B.l.x - B.ux.x * sw * 0.1, y: B.l.y - B.ux.y * sw * 0.1 }, { x: B.r.x + B.ux.x * sw * 0.1, y: B.r.y + B.ux.y * sw * 0.1 }]
    const shErr = Math.max(...sh.map((p, i) => Math.hypot(p.x - out[i].x, p.y - out[i].y))) / sw
    rows.push({ pose: name, sw, foldedArea: +(flip / tot).toFixed(4), sleeveAngleErrDeg: errs.map((e) => +e.toFixed(1)), shoulderErrSW: +shErr.toFixed(3), yawDeg: +(body.yaw / D).toFixed(1) })
    if (sw === 200) { const c = document.createElement('canvas'); c.width = W; c.height = H; const x = c.getContext('2d'); x.fillStyle = '#ddd'; x.fillRect(0, 0, W, H); const bg = document.createElement('canvas'); bg.width = W; bg.height = H; bg.getContext('2d').drawImage(c, 0, 0)
      drawOutfit(x, B, { 'o-custom': { v: 0.5, dy: 0, len: 1 } }, g, 0, bg, P, null, {})
      x.strokeStyle = '#e33'; x.lineWidth = 3; [[11, 13], [13, 15], [12, 14], [14, 16], [11, 12], [23, 24], [11, 23], [12, 24]].forEach(([a, b]) => { x.beginPath(); x.moveTo(P[a].x, P[a].y); x.lineTo(P[b].x, P[b].y); x.stroke() }); tiles.push([name, c]) }
  }
  const tw = 160, th = 180; cv.width = tw * tiles.length; cv.height = th
  tiles.forEach(([n, c], k) => { cx.drawImage(c, k * tw, 0, tw, th); cx.fillStyle = '#000'; cx.font = '12px sans-serif'; cx.fillText(n, k * tw + 4, 14) })
  window.__result = { dbg: { w: g.width, h: g.height, top: G.geo.top, bot: G.geo.bot, cx: G.geo.cx, prof: Array.from({ length: 20 }, (_, i) => Math.round(G.geo.prof[Math.round(G.geo.top + i * (G.geo.bot - G.geo.top) / 20)])) }, geo: { sleeves: G.geo.sleeves, pit: G.geo.pit, sh: G.geo.sh, shHalf: +G.geo.shHalf.toFixed(1), body: +G.geo.body.toFixed(1), sl: G.geo.sl && { dir: [+G.geo.sl.dir.x.toFixed(2), +G.geo.sl.dir.y.toFixed(2)], len: +G.geo.sl.len.toFixed(0) } }, rows }
}

// ---- cost of the person mask: pose model time with and without segmentation masks (+ reading the mask back) ----
async function posecost() {
  const img = await load('./img/pose.jpg'), W = 640, H = 480, f = frame(img, W, H, { tx: 0, ty: 0, r: 0, s: 1 }, 2), res = {}
  for (const seg of [false, true]) {
    const det = await createPoseTracker(seg); let clock = 0; const ts = []
    for (let i = 0; i < 25; i++) { clock += 34; const t0 = performance.now(); const r = det.detectForVideo(f, clock); const mk = r.segmentationMasks?.[0]; if (mk) { mk.getAsFloat32Array(); mk.close() } if (i >= 5) ts.push(performance.now() - t0) }
    ts.sort((a, b) => a - b); res[seg ? 'withMask' : 'noMask'] = { p50: +ts[ts.length >> 1].toFixed(1), p90: +ts[Math.floor(ts.length * 0.9)].toFixed(1), delegate: det.__delegate }
    det.close()
  }
  window.__result = res
}

// ---- outfit steadiness: a still person, camera noise only (30 frames), pose smoothed like the studio does. How much of the garment's
// outline changes from frame to frame (changed pixels / garment pixels), flat vs warp. The warp also follows elbows and hips, which
// are noisier than shoulders, so this checks that it does not wobble more.
async function outfitjitter() {
  const { drawOutfit, prepGarment, bodyFrom } = await import('../src/tryon/outfit.js'), { PointSetFilter } = await import('../src/tryon/track/filters.js')
  const img = await load('./img/' + (q.get('img') || 'pose.jpg')), tee = await load('./img/garment-tee.png'), W = 640, H = 480, g = prepGarment(tee).canvas
  const det = await createPoseTracker(false), N = 30, res = {}
  let clock = 0; const frames = [], poses = []
  const filt = new PointSetFilter({ minCutoff: 1.0, beta: 25 })
  for (let i = 0; i < N + 5; i++) { clock += 34; const f = frame(img, W, H, { tx: 0, ty: 0, r: 0, s: 1 }, 4); const lm = det.detectForVideo(f, clock).landmarks[0]; if (!lm) continue; const pts = lm.map((p) => ({ x: p.x * W, y: p.y * H, z: (p.z || 0) * W, v: p.visibility ?? 0 })); const P = filt.filter(pts, 0.034, Math.hypot(pts[11].x - pts[12].x, pts[11].y - pts[12].y)); if (i >= 5) { frames.push(f); poses.push(P.map((p) => ({ ...p }))) } }
  const { resetOutfit } = await import('../src/tryon/outfit.js')
  for (const mode of ['flat', 'warp']) {
    resetOutfit(); let prev = null, ch = 0, area = 0
    frames.forEach((f, i) => {
      const P = poses[i], B = bodyFrom(P), c = document.createElement('canvas'); c.width = W; c.height = H; const x = c.getContext('2d', { willReadFrequently: true })
      drawOutfit(x, B, { 'o-custom': { v: 0.5, dy: 0, len: 1 } }, g, 0, f, P, null, { flat: mode === 'flat' })
      const a = x.getImageData(0, 0, W, H).data, m = new Uint8Array(W * H); for (let o = 0; o < W * H; o++) m[o] = a[o * 4 + 3] > 127 && a[o * 4 + 2] > a[o * 4] + 30 ? 1 : 0 // garment (blue) pixels
      if (prev) { for (let o = 0; o < W * H; o++) { ch += m[o] ^ prev[o]; area += m[o] } } prev = m
    })
    res[mode] = { outlineChangePerFrame: +(ch / Math.max(1, area)).toFixed(4) }
  }
  window.__result = res
}
