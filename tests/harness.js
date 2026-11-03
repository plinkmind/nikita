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
  const res = { delegate: det.__delegate, hands: hands.map((h) => ({ label: h.label, score: +h.score.toFixed(2), nails: nailGeometry(h).map((g) => ({ f: g.f, facing: +g.facing.toFixed(2), vis: +g.vis.toFixed(2) })) })) }
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
;({ anchors, motion, nails, seg, occl })[test]().catch((e) => { window.__result = { error: String(e && e.stack || e) }; log('ERROR', e && e.stack || e) })

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
