// Head rig tests (NOT part of the website). Driven by tests/rig/run.mjs.
import { createRig } from './scene.js'
import { createFaceTracker, createPoseTracker } from '../../src/tryon/track/mediapipe.js'
import { HeadTracker } from '../../src/tryon/track/head.js'

const q = new URLSearchParams(location.search), test = q.get('test') || 'explore'
const out = document.getElementById('out'), cv = document.getElementById('c'), cx = cv.getContext('2d')
const log = (...a) => { out.textContent += a.join(' ') + '\n' }

async function explore() {
  const R = await createRig()
  R.pose({ yaw: +(q.get('yaw') || 0), pitch: +(q.get('pitch') || 0), dist: +(q.get('dist') || 55) })
  const img = R.render()
  const det = await createFaceTracker(), head = new HeadTracker()
  let lm = null, M = null
  for (let i = 0; i < 6; i++) { lm = det.detectForVideo(img, i * 33 + 1).faceLandmarks[0] || null; M = head.update(lm, R.W, R.H, false, i * 33 + 1) }
  cv.width = R.W; cv.height = R.H; cx.drawImage(img, 0, 0)
  if (M) { cx.fillStyle = '#39ff14'; M.P.forEach((p) => cx.fillRect(p.x - 1, p.y - 1, 2, 2)); ['lobeL', 'lobeR', 'noseL', 'noseR', 'neck'].forEach((n) => { const a = M.project(n); cx.fillStyle = '#ff2d6f'; cx.fillRect(a.x - 4, a.y - 4, 8, 8) }) }
  window.__result = { bbox: [R.bb.min, R.bb.max], size: R.size, k: R.k, verts: R.count, found: !!lm, yaw: M && M.yaw * 57.3, pitch: M && M.pitch * 57.3, cm: M && M.cm }
}

const tests = { explore }

// find the ear lobes on the scan: lowest ear vertex on each side (ears stick out sideways from the head)
async function ears() {
  const R = await createRig()
  const v = new R.THREE.Vector3(), cand = { L: [], R: [] }
  for (let i = 0; i < R.count; i++) { R.vtx(i, v); const y = v.y - R.ctr.y, x = v.x - R.ctr.x, z = v.z - R.ctr.z; if (y > 0.3 && y < 2.4 && Math.abs(x) > 1.3) cand[x < 0 ? 'L' : 'R'].push({ i, x, y, z }) }
  const res = {}
  for (const s of ['L', 'R']) {
    const c = cand[s].sort((a, b) => Math.abs(b.x) - Math.abs(a.x))
    const maxX = Math.abs(c[0].x)
    const ear = c.filter((p) => Math.abs(p.x) > maxX - 0.35)
    const lobe = ear.reduce((a, b) => (b.y < a.y ? b : a))
    res[s] = { maxX, n: ear.length, lobe, yRange: [Math.min(...ear.map((p) => p.y)), Math.max(...ear.map((p) => p.y))], zRange: [Math.min(...ear.map((p) => p.z)), Math.max(...ear.map((p) => p.z))] }
  }
  const yaw = +(q.get('yaw') || 1.4)
  R.pose({ yaw, dist: 70 }); const img = R.render(); cv.width = R.W; cv.height = R.H; cx.drawImage(img, 0, 0)
  for (const s of ['L', 'R']) { const p = R.project(R.world(res[s].lobe.i)); cx.fillStyle = '#ff2d6f'; cx.fillRect(p.x - 4, p.y - 4, 8, 8); res[s].px = p }
  window.__result = res
}
tests.ears = ears

// ear lobe piercing point: the ear vertex (seen from the side) nearest to a pixel picked on the side view
async function pick() {
  const R = await createRig(), yaw = +q.get('yaw'), px = +q.get('x'), py = +q.get('y'), side = q.get('side')
  R.pose({ yaw, dist: +(q.get('dist') || 70) }); const img = R.render(); cv.width = R.W; cv.height = R.H; cx.drawImage(img, 0, 0)
  const v = new R.THREE.Vector3(); let best = null
  for (let i = 0; i < R.count; i++) {
    R.vtx(i, v); const x = v.x - R.ctr.x; if (side !== 'any' && ((side === 'L') !== (x < 0) || Math.abs(x) < 1.2)) continue
    const w = R.world(i), p = R.project(w), d = Math.hypot(p.x - px, p.y - py)
    if (d < 7 && (!best || p.depth < best.depth - 0.3 || (Math.abs(p.depth - best.depth) <= 0.3 && d < best.d))) best = { i, d, depth: p.depth, p, local: R.local(i) }
  }
  cx.fillStyle = '#ff2d6f'; cx.fillRect(best.p.x - 3, best.p.y - 3, 6, 6)
  window.__result = best
}
tests.pick = pick

// ---------- motion recording ----------
// Scripted movement (seconds, 30 fps). Returns per frame: the TRUE pose, the true pixel position of reference points on the
// scan (ear lobes + surface points under chosen landmarks) with their true visibility, and the raw Face Landmarker output.
export const LOBES = { lobeL: 7834, lobeR: 3203 }
export const NECK = 4190 // suprasternal notch (where a necklace sits)
const SURF = [61, 291, 13, 14, 0, 17, 33, 133, 263, 362, 159, 386, 145, 374, 50, 280, 1, 4, 98, 327, 105, 334, 152, 10, 234, 454, 116, 345, 205, 425]
const ease = (u) => Math.sin(u * Math.PI * 2)
export function script(t) {
  const P = { yaw: 0, pitch: 0, roll: 0, x: 0, y: 0, dist: 60 }, L = { intensity: 1, colour: '#ffffff', side: 0.6, ambient: 1 }
  let hidden = false, seg = 'still'
  const at = (a, b) => t >= a && t < b, u = (a, b) => (t - a) / (b - a)
  if (at(0, 2)) seg = 'still'
  else if (at(2, 5)) { seg = 'yaw'; P.yaw = 0.79 * ease(u(2, 5)) }                 // turn left/right +-45 deg
  else if (at(5, 7.5)) { seg = 'pitch'; P.pitch = 0.44 * ease(u(5, 7.5)) }         // nod +-25 deg
  else if (at(7.5, 9.5)) { seg = 'roll'; P.roll = 0.35 * ease(u(7.5, 9.5)) }       // tilt +-20 deg
  else if (at(9.5, 11.5)) { seg = 'side'; P.x = 12 * ease(u(9.5, 11.5)) }          // move left/right +-12 cm
  else if (at(11.5, 13)) { seg = 'updown'; P.y = 7 * ease(u(11.5, 13)) }           // up/down +-7 cm
  else if (at(13, 15.5)) { seg = 'depth'; P.dist = 60 + 25 * ease(u(13, 15.5)) }   // 35 .. 85 cm from the camera
  else if (at(15.5, 18.5)) { // lighting: dim, warm, side light, back to normal (head still, small sway)
    seg = 'light'; const k = u(15.5, 18.5)
    if (k < 0.33) { L.intensity = 0.3; L.ambient = 0.35 } else if (k < 0.66) { L.colour = '#ffb070'; L.side = -1.2 } else { L.intensity = 1.6; L.ambient = 0.6; L.side = 1.4 }
    P.yaw = 0.1 * ease(k)
  } else if (at(18.5, 19.2)) { seg = 'lost'; hidden = true }
  else if (at(19.2, 21)) { seg = 'back'; P.x = -6; P.yaw = 0.25 }                   // reappears elsewhere, turned
  else if (at(21, 23)) { seg = 'body'; const k = u(21, 23); P.body = 0.35 * ease(k); P.yaw = 0.35 * ease(k) }   // whole upper body turns +-20 deg
  else { seg = 'combo'; const k = u(23, 26); P.yaw = 0.6 * ease(k); P.pitch = 0.2 * Math.sin(k * Math.PI * 4); P.x = 6 * ease(k * 0.5); P.dist = 60 - 10 * ease(k) }
  return { P, L, hidden, seg }
}

let seed = 4242; const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648 }
const gauss = () => { let a = 0, b = 0; while (!a) a = rnd(); while (!b) b = rnd(); return Math.sqrt(-2 * Math.log(a)) * Math.cos(2 * Math.PI * b) }
export function addNoise(src, sigma, dst) { // webcam sensor noise (luma + a little chroma)
  dst = dst || document.createElement('canvas'); dst.width = src.width; dst.height = src.height
  const x = dst.getContext('2d', { willReadFrequently: true }); x.drawImage(src, 0, 0)
  if (sigma > 0) { const d = x.getImageData(0, 0, dst.width, dst.height), p = d.data; for (let i = 0; i < p.length; i += 4) { const n = gauss() * sigma; p[i] += n + gauss() * sigma * 0.3; p[i + 1] += n; p[i + 2] += n + gauss() * sigma * 0.3 } x.putImageData(d, 0, 0) }
  return dst
}

export async function groundTruthSetup(R, det) {
  // map chosen landmarks to scan vertices once, at the frontal pose (nearest front-facing vertex under the detected landmark)
  R.pose({ dist: 60 }); R.light({}); const img = R.render(); let lm
  for (let i = 0; i < 5; i++) lm = det.detectForVideo(addNoise(img, 0), 1e6 + i * 33).faceLandmarks[0]
  const ray = new R.THREE.Raycaster(), map = {}
  for (const id of SURF) {
    const px = lm[id].x * R.W, py = lm[id].y * R.H
    ray.setFromCamera(new R.THREE.Vector2((px / R.W) * 2 - 1, -(py / R.H) * 2 + 1), R.camera)
    const hit = ray.intersectObject(R.mesh)[0]
    if (hit) { const f = hit.face; const cand = [f.a, f.b, f.c]; let best = cand[0], bd = 1e9; for (const vi of cand) { const d = R.world(vi).distanceTo(hit.point); if (d < bd) { bd = d; best = vi } } map[id] = best }
  }
  return map
}
export function visible(R, wp) { // true if nothing on the scan is between the camera and this point
  const ray = new R.THREE.Raycaster(new R.THREE.Vector3(0, 0, 0), wp.clone().normalize()); const hit = ray.intersectObject(R.mesh)[0]
  return !hit || hit.distance > wp.length() - 0.4
}

async function record() {
  const R = await createRig(), det = await createFaceTracker(), fps = 30, dur = +(q.get('dur') || 26), noise = +(q.get('noise') ?? 3)
  const map = await groundTruthSetup(R, det)
  const det2 = await createFaceTracker() // fresh detector for the sequence (no tracking state from the set-up)
  const poseDet = q.get('pose') === '0' ? null : await createPoseTracker()
  const frames = [], N = Math.round(dur * fps); let ms = 0, nc = null
  for (let i = 0; i < N; i++) {
    const t = i / fps, s = script(t); R.pose(s.P); R.light(s.L); R.mesh.visible = !s.hidden
    const img = R.render(); nc = addNoise(img, noise, nc)
    const t0 = performance.now(); const r = det2.detectForVideo(nc, i * (1000 / fps) + 1); ms += performance.now() - t0
    const lm = r.faceLandmarks[0] || null
    const pl = poseDet ? poseDet.detectForVideo(nc, i * (1000 / fps) + 1).landmarks[0] || null : null
    const gt = {}
    { const w = R.world(NECK), p = R.project(w); gt.neck = [+p.x.toFixed(2), +p.y.toFixed(2), s.hidden ? 0 : 1, +R.pxPerCm(w).toFixed(3)] }
    for (const [n, vi] of Object.entries(LOBES)) { const w = R.world(vi), p = R.project(w); gt[n] = [+p.x.toFixed(2), +p.y.toFixed(2), s.hidden ? 0 : visible(R, w) ? 1 : 0, +R.pxPerCm(w).toFixed(3)] }
    for (const [id, vi] of Object.entries(map)) { const w = R.world(vi), p = R.project(w); gt[id] = [+p.x.toFixed(2), +p.y.toFixed(2), s.hidden ? 0 : visible(R, w) ? 1 : 0] }
    frames.push({ t, seg: s.seg, pose: s.P, hidden: s.hidden, gt, lm: lm && lm.map((p) => [+p.x.toFixed(5), +p.y.toFixed(5), +p.z.toFixed(5)]), pl: pl && pl.map((p) => [+p.x.toFixed(5), +p.y.toFixed(5), +p.z.toFixed(5), +(p.visibility ?? 0).toFixed(3)]) })
    if (i % 60 === 0) log(i, s.seg, (ms / (i + 1)).toFixed(0) + ' ms')
  }
  window.__result = { W: R.W, H: R.H, fps, noise, delegate: det2.__delegate, detMs: ms / N, map, frames }
}
tests.record = record

// ---------- visual check: the studio's own renderers drawn on the rendered head ----------
import { drawMakeup } from '../../src/tryon/makeup.js'
import { drawJewellery, resetJewellery } from '../../src/tryon/jewellery.js'
import { createFaceMesh } from '../../src/tryon/render/facemesh.js'
async function look() {
  const R = await createRig(), det = await createFaceTracker(), mesh = q.get('mesh') === '0' ? null : createFaceMesh()
  const poses = JSON.parse(q.get('poses') || '[{"yaw":0},{"yaw":0.5},{"yaw":-0.7},{"pitch":0.35},{"roll":0.3,"x":5}]')
  const state = JSON.parse(q.get('state') || '{"lipstick":{"shade":0,"v":0.8},"blush":{"shade":0,"v":0.6},"eyeliner":{"shade":0,"v":0.9},"eyeshadow":{"shade":1,"v":0.6},"jhumkas":{"shade":0,"v":0.5},"nosepin":{"shade":0,"v":0.5,"side":"left"}}')
  const crop = +(q.get('crop') || 0.55), tile = 420
  cv.width = tile * poses.length; cv.height = tile
  const fin = document.createElement('canvas'); fin.width = R.W; fin.height = R.H; const fx = fin.getContext('2d')
  let t = 0, nc = null; const res = []
  for (let k = 0; k < poses.length; k++) {
    const head = new HeadTracker(); resetJewellery(); let M = null
    for (let i = 0; i < 12; i++) { R.pose({ dist: 60, ...poses[k] }); const img = R.render(); nc = addNoise(img, 2, nc); t += 33.3; const lm = det.detectForVideo(nc, t).faceLandmarks[0] || null; M = head.update(lm, R.W, R.H, false, t) }
    fx.drawImage(nc, 0, 0)
    if (M && k === 0) { M.shoulders = null; drawJewellery(fx, M, state, 0); await new Promise((r) => setTimeout(r, 1500)); fx.drawImage(nc, 0, 0) } // let product photos load
    const base = fx.getImageData(0, 0, R.W, R.H).data
    const t0 = performance.now()
    if (M) { drawMakeup(fx, M, state, nc, mesh); M.shoulders = null; drawJewellery(fx, M, state, t / 1000) }
    const drawMs = performance.now() - t0
    // paint that landed on the BACKGROUND (outside the head): must be zero for a mask that stays on the face
    const now = fx.getImageData(0, 0, R.W, R.H).data, bg = [base[0], base[1], base[2]]; let changed = 0, spill = 0
    for (let i = 0; i < now.length; i += 4) { const dd = Math.abs(now[i] - base[i]) + Math.abs(now[i + 1] - base[i + 1]) + Math.abs(now[i + 2] - base[i + 2]); if (dd > 12) { changed++; if (Math.abs(base[i] - bg[0]) + Math.abs(base[i + 1] - bg[1]) + Math.abs(base[i + 2] - bg[2]) < 24) spill++ } }
    // crop around the head
    const c = R.project(R.world(LOBES.lobeL)), d = R.project(R.world(LOBES.lobeR)), cxp = (c.x + d.x) / 2, cyp = (c.y + d.y) / 2 - 20, sz = R.H * crop
    cx.drawImage(fin, cxp - sz / 2, cyp - sz / 2, sz, sz, k * tile, 0, tile, tile)
    res.push({ pose: poses[k], found: !!M, yaw: M && +(M.yaw * 57.3).toFixed(1), changed, spill, drawMs: +drawMs.toFixed(1) })
  }
  if (q.get('dump') && mesh?.lastTexture) { // the texture of the last mesh product, beside the tiles
    const keep = document.createElement('canvas'); keep.width = cv.width; keep.height = cv.height; keep.getContext('2d').drawImage(cv, 0, 0)
    cv.width += tile; cx.drawImage(keep, 0, 0); cx.fillStyle = '#777'; cx.fillRect(keep.width, 0, tile, tile); cx.drawImage(mesh.lastTexture, keep.width, 0, tile, tile)
  }
  window.__result = res
}
tests.look = look

// ---------- fake-camera video for the full studio test: held poses with short moves between them ----------
export const HOLDS = [
  ['front', { yaw: 0 }], ['turn right 30', { yaw: 0.52 }], ['turn left 45', { yaw: -0.79 }], ['nod down 25', { pitch: 0.44 }],
  ['look up 20', { pitch: -0.35 }], ['tilt 20', { roll: 0.35 }], ['closer', { dist: 38 }], ['farther', { dist: 90 }],
  ['dim light', { yaw: 0.1 }, { intensity: 0.3, ambient: 0.35 }], ['warm side light', { yaw: -0.1 }, { colour: '#ffb070', side: -1.2 }],
  ['gone', null], ['back, moved', { x: -8, yaw: 0.3 }],
]
// frame number written into the top-left corner as 12 black/white 10x10 blocks, so a test can tell which frame is on screen
function stamp(c, n) { const x = c.getContext('2d'); for (let b = 0; b < 12; b++) { x.fillStyle = (n >> b) & 1 ? '#fff' : '#000'; x.fillRect(b * 10, 0, 10, 10) } }
async function video() {
  const W = +(q.get('w') || 640), H = +(q.get('h') || 480), fps = +(q.get('fps') || 10), hold = +(q.get('hold') || 2.5), move = 0.5
  const R = await createRig(W, H); let nc = null, n = 0, prev = { yaw: 0 }
  const lerp = (a, b, t) => { const o = {}; for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) o[k] = (a[k] ?? (k === 'dist' ? 60 : 0)) + ((b[k] ?? (k === 'dist' ? 60 : 0)) - (a[k] ?? (k === 'dist' ? 60 : 0))) * t; return o }
  const plan = []
  for (const [name, P, L] of HOLDS) {
    if (P) for (let i = 1; i <= move * fps; i++) plan.push({ P: lerp(prev, P, i / (move * fps)), L: L || {}, name: 'move' })
    for (let i = 0; i < hold * fps; i++) plan.push({ P: P || prev, L: L || {}, name, hidden: !P })
    if (P) prev = P
  }
  for (const f of plan) { R.pose({ dist: 60, ...f.P }); R.light(f.L); R.mesh.visible = !f.hidden; nc = addNoise(R.render(), 3, nc); stamp(nc, n); await window.__saveFrame(n++, nc.toDataURL('image/png')) }
  window.__result = { frames: n, fps, plan: plan.map((f) => f.name) }
}
tests.video = video

tests[test]().catch((e) => { window.__result = { error: String(e && e.stack || e) } })
