// Face tracking test bench on the 3D head rig (Node only, no browser): replays the recorded real Face Landmarker results of a
// scanned head with known ground truth, through the studio's head tracker, under realistic and hard conditions.
// usage: node tests/rig/face.mjs [--json out.json]
//
// Scenarios (all with webcam-like landmark jitter: 0.9 px per point + a shared shift):
//   normal   - every frame detected
//   dropout  - 15% of the frames during movement have NO detection (motion blur, a hand passing, a slow phone)
//   glitch   - 3% of the frames get a WRONG detection (the landmark set of a frame 12 frames away, as when the detector
//              briefly locks onto the wrong thing) - the overlay must not jump there
//   slow     - only every 2nd frame (a phone that manages 15 frames per second): the jump guard must not hold back fast moves
//   mirror   - the selfie (mirrored) view: errors must equal the normal view (coordinate mapping check)
// Reported per anchor group (eyes, brows, nose, lips, cheeks, jaw, ears) and per movement (left-right, up-down, turn, nod,
// tilt, closer/farther, light): median and 95th-percentile error in cm, still jitter in px, and the largest single error.
import fs from 'node:fs'
import { HeadTracker } from '../../src/tryon/track/head.js'

const D0 = JSON.parse(fs.readFileSync('tests/rig/data/seq.json', 'utf8')), { W, H, fps } = D0
let seed = 777; const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648 }
const gauss = () => { let u = 0, v = 0; while (!u) u = rnd(); while (!v) v = rnd(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v) }
const MOVING = new Set(['yaw', 'pitch', 'roll', 'side', 'updown', 'depth', 'body', 'combo'])
export const GROUPS = { eyes: [33, 133, 263, 362, 145, 159, 374, 386], brows: [105, 334], nose: [1, 4, 98, 327], lips: [0, 13, 14, 17, 61, 291], cheeks: [50, 116, 205, 280, 345, 425], jaw: [152, 234, 454], forehead: [10] }
import { FACE_ANCHORS } from '../../src/tryon/track/head.js'
const ANCHOR_GT = Object.fromEntries(Object.entries(FACE_ANCHORS).filter(([, ids]) => ids.every((i) => D0.map[i] !== undefined)))
const SEGS = { 'left-right': ['side'], 'up-down': ['updown'], turn: ['yaw'], nod: ['pitch'], tilt: ['roll'], 'closer/farther': ['depth'], light: ['light'], combined: ['body', 'combo'] }

function scenario(kind) {
  seed = 777
  const frames = D0.frames.map((f) => { if (!f.lm) return { ...f }; const cx = gauss() * 0.9 * 0.7, cy = gauss() * 0.9 * 0.7; return { ...f, lm: f.lm.map(([x, y, z]) => [x + (cx + gauss() * 0.9) / W, y + (cy + gauss() * 0.9) / H, z + (gauss() * 0.9) / W]) } })
  seed = 4242
  frames.forEach((f, i) => {
    f.dropped = false; f.glitch = false
    if (kind === 'dropout' && MOVING.has(f.seg) && f.lm && rnd() < 0.15) { f.lm = null; f.dropped = true }
    if (kind === 'slow' && i % 2) f.skip = true // a slow phone: 15 camera frames per second
    if (kind === 'glitch' && f.lm && i > 15 && rnd() < 0.03) { const o = frames[Math.max(0, i - 12)].lm || frames[i].lm; f.lm = o.map((p) => [...p]); f.glitch = true }
  })
  return frames
}

const q = (a, p) => { if (!a.length) return NaN; const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(p * (s.length - 1)))] }

// make(): () => tracker. Returns per-frame errors (cm) for every ground-truth landmark and the ear lobes.
export function replay(make, kind = 'normal', mirror = false) {
  const frames = scenario(kind), tr = make(), rows = [], mx = (x) => (mirror ? W - x : x)
  frames.forEach((f, i) => {
    if (f.skip) return
    const now = i * (1000 / fps) + 1
    const M = tr.update(f.lm && f.lm.map(([x, y, z]) => ({ x, y, z })), W, H, mirror, now)
    const pxcm = (f.gt.lobeL[3] + f.gt.lobeR[3]) / 2, r = { i, seg: f.seg, hidden: f.hidden, dropped: f.dropped, glitch: f.glitch, shown: !!M, e: {}, px: {} }
    if (M && !f.hidden) {
      for (const id of Object.keys(D0.map)) { const g = f.gt[id], p = M.P[+id]; if (!g || !g[2] || !p) continue; r.e[id] = [(mx(p.x) - g[0]) / pxcm, (p.y - g[1]) / pxcm]; r.px[id] = [mx(p.x), p.y] }
      for (const n of ['lobeL', 'lobeR']) { const g = f.gt[n]; if (!g[2]) continue; const a = M.project(n); r.e[n] = [(mx(a.x) - g[0]) / g[3], (a.y - g[1]) / g[3]] }
      // named anchors (M.anchor) whose landmarks all have ground truth: position vs the mean ground truth, visibility vs the scan
      if (M.anchor) { r.anc = {}; for (const [name, ids] of Object.entries(ANCHOR_GT)) { const gs = ids.map((i) => f.gt[i]); if (gs.some((g) => !g)) continue; const a = M.anchor(name); const gx = gs.reduce((t, g) => t + g[0], 0) / gs.length, gy = gs.reduce((t, g) => t + g[1], 0) / gs.length; r.anc[name] = { e: [(mx(a.x) - gx) / pxcm, (a.y - gy) / pxcm], vis: a.visible > 0.5, trueVis: gs.every((g) => g[2]) } } }
    }
    rows.push(r)
  })
  // a landmark's definition differs slightly from the scan vertex chosen under it: remove that constant offset (measured still)
  const bias = {}, still = rows.filter((r) => r.seg === 'still' && r.i > 15)
  for (const id of Object.keys(rows.find((r) => Object.keys(r.e).length)?.e || {})) bias[id] = [q(still.map((r) => r.e[id]?.[0]).filter(Number.isFinite), 0.5) || 0, q(still.map((r) => r.e[id]?.[1]).filter(Number.isFinite), 0.5) || 0]
  rows.forEach((r) => { for (const id of Object.keys(r.e)) { const b = id.startsWith('lobe') ? [0, 0] : bias[id] || [0, 0]; r.d = r.d || {}; r.d[id] = Math.hypot(r.e[id][0] - b[0], r.e[id][1] - b[1]) } })
  return rows
}

export function summary(rows) {
  const pick = (filter, ids) => { const v = []; rows.filter(filter).forEach((r) => r.d && ids.forEach((id) => { if (r.d[id] != null) v.push(r.d[id]) })); return v }
  const all = Object.values(GROUPS).flat().map(String)
  const out = { groups: {}, segs: {} }
  for (const [g, ids] of Object.entries({ ...GROUPS, ears: ['lobeL', 'lobeR'] })) { const v = pick((r) => !r.hidden, ids.map(String)); out.groups[g] = { med: q(v, 0.5), p95: q(v, 0.95) } }
  for (const [s, segs] of Object.entries(SEGS)) { const v = pick((r) => segs.includes(r.seg), all), e = pick((r) => segs.includes(r.seg), ['lobeL', 'lobeR']); out.segs[s] = { face: q(v, 0.5), faceP95: q(v, 0.95), ear: q(e, 0.5) } }
  const v = pick((r) => !r.hidden, all); out.max = q(v, 1); out.p99 = q(v, 0.99)
  const dr = pick((r) => r.dropped, all); out.onDropped = { med: q(dr, 0.5), p95: q(dr, 0.95), shown: rows.filter((r) => r.dropped && r.shown).length, of: rows.filter((r) => r.dropped).length }
  const gl = pick((r) => r.glitch, all); out.onGlitch = { med: q(gl, 0.5), p95: q(gl, 0.95), max: q(gl, 1) }
  // anchors: error after removing each anchor's still offset, and how often its visibility agrees with the scan
  out.anchors = {}
  const still2 = rows.filter((r) => r.seg === 'still' && r.i > 15 && r.anc)
  for (const name of Object.keys(ANCHOR_GT)) {
    const b = [q(still2.map((r) => r.anc[name]?.e[0]).filter(Number.isFinite), 0.5) || 0, q(still2.map((r) => r.anc[name]?.e[1]).filter(Number.isFinite), 0.5) || 0]
    const e = [], agree = []; rows.forEach((r) => { const a = r.anc?.[name]; if (!a || r.hidden) return; if (a.trueVis) e.push(Math.hypot(a.e[0] - b[0], a.e[1] - b[1])); agree.push(a.vis === a.trueVis ? 1 : 0) })
    out.anchors[name] = { med: q(e, 0.5), p95: q(e, 0.95), visAgree: agree.reduce((t, v) => t + v, 0) / (agree.length || 1) }
  }
  const jit = []; for (let k = 1; k < rows.length; k++) { const a = rows[k - 1], b = rows[k]; if (a.seg !== 'still' || b.seg !== 'still' || b.i < 16) continue; for (const id of ['33', '263', '1', '61', '291']) if (a.px[id] && b.px[id]) jit.push(Math.hypot(b.px[id][0] - a.px[id][0], b.px[id][1] - a.px[id][1])) }
  out.stillJitPx = q(jit, 0.5)
  return out
}

const f2 = (v) => (Number.isFinite(v) ? v.toFixed(2) : '-').padStart(7)
export function report(label, make) {
  const res = {}
  for (const kind of ['normal', 'dropout', 'glitch', 'slow']) res[kind] = summary(replay(make, kind))
  res.mirror = summary(replay(make, 'normal', true))
  const n = res.normal
  console.log(`\n== ${label}`)
  console.log('anchor groups (cm, median / p95):  ' + Object.entries(n.groups).map(([g, v]) => `${g} ${v.med.toFixed(2)}/${v.p95.toFixed(2)}`).join('  '))
  console.log('movements (face cm median/p95, ear cm): ' + Object.entries(n.segs).map(([s, v]) => `${s} ${v.face.toFixed(2)}/${v.faceP95.toFixed(2)} ear ${v.ear.toFixed(2)}`).join(' | '))
  console.log('named anchors (cm median/p95, visibility agrees with the scan): ' + Object.entries(n.anchors).map(([a, v]) => `${a} ${v.med.toFixed(2)}/${v.p95.toFixed(2)} ${(v.visAgree * 100).toFixed(0)}%`).join('  '))
  console.log(`still jitter ${n.stillJitPx.toFixed(3)} px | p99 ${n.p99.toFixed(2)} cm | max ${n.max.toFixed(2)} cm`)
  console.log(`dropout: on missed frames ${res.dropout.onDropped.med.toFixed(2)}/${res.dropout.onDropped.p95.toFixed(2)} cm (${res.dropout.onDropped.shown}/${res.dropout.onDropped.of} still shown) | max ${res.dropout.max.toFixed(2)} cm`)
  console.log(`glitch: on wrong detections ${res.glitch.onGlitch.med.toFixed(2)}/${res.glitch.onGlitch.p95.toFixed(2)} max ${res.glitch.onGlitch.max.toFixed(2)} cm | overall p99 ${res.glitch.p99.toFixed(2)} max ${res.glitch.max.toFixed(2)} cm`)
  console.log(`slow phone (15 fps): movements ` + Object.entries(res.slow.segs).map(([s, v]) => `${s} ${v.face.toFixed(2)}/${v.faceP95.toFixed(2)}`).join(' | ') + ` | max ${res.slow.max.toFixed(2)} cm`)
  const mm = Math.abs(res.mirror.groups.eyes.med - n.groups.eyes.med) + Math.abs(res.mirror.groups.ears.med - n.groups.ears.med)
  console.log(`mirror check: eyes ${res.mirror.groups.eyes.med.toFixed(3)} vs ${n.groups.eyes.med.toFixed(3)}, ears ${res.mirror.groups.ears.med.toFixed(3)} vs ${n.groups.ears.med.toFixed(3)} -> ${mm < 0.005 ? 'same' : 'DIFFERENT'}`)
  return res
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const out = {}
  out.current = report('current head tracker', () => new HeadTracker())
  out.raw = report('no smoothing (raw detector, for reference)', () => new HeadTracker({ pos: [1e4, 0], rot: [1e4, 0], scale: [1e4, 0] }, { minCutoff: 1e4, beta: 0 }))
  const j = process.argv.indexOf('--json'); if (j > 0) fs.writeFileSync(process.argv[j + 1], JSON.stringify(out, null, 1))
}
