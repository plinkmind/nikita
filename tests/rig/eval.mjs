// Scores the live studio's head tracker against the 3D head rig's ground truth.
// usage: node tests/rig/eval.mjs [tests/rig/data/seq.json] [--mirror]
// Reports, per movement segment: face found, head-angle error, ear-lobe error (cm), ear visibility mistakes, surface-point
// error for makeup landmarks (cm), still jitter (px) and the raw detector error for comparison.
import fs from 'node:fs'
import { HeadTracker, earVisibility, earAway } from '../../src/tryon/track/head.js'
import { PointSetFilter } from '../../src/tryon/track/filters.js'
import { bodyFrom } from '../../src/tryon/outfit.js'
import { FACE_OVAL } from '../../src/tryon/hair.js'
import { neckFrame, resetJewellery } from '../../src/tryon/jewellery.js'
const inside = (pt, poly) => { let c = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const a = poly[i], b = poly[j]; if ((a.y > pt.y) !== (b.y > pt.y) && pt.x < ((b.x - a.x) * (pt.y - a.y)) / (b.y - a.y) + a.x) c = !c } return c }

const file = process.argv.find((a) => a.endsWith('.json')) || 'tests/rig/data/seq.json'
const mirror = process.argv.includes('--mirror')
const D = JSON.parse(fs.readFileSync(file, 'utf8'))
const { W, H, fps } = D

export function run(D, makeTracker = () => new HeadTracker(), opts = {}) {
  const { W, H, fps } = D, mir = !!opts.mirror
  const tr = makeTracker(), rows = [], poseF = new PointSetFilter({ minCutoff: 1.0, beta: 25 }); let poseT = 0
  resetJewellery()
  const mx = (x) => (mir ? W - x : x)
  D.frames.forEach((f, i) => {
    const now = i * (1000 / fps) + 1
    const lm = f.lm && f.lm.map(([x, y, z]) => ({ x, y, z }))
    const M = tr.update(lm, W, H, mir, now)
    const pxcm = (f.gt.lobeL[3] + f.gt.lobeR[3]) / 2
    const row = { i, seg: f.seg, hidden: f.hidden, found: !!lm, M: !!M, alpha: M ? M.alpha : 0, pxcm, pose: f.pose }
    if (M) {
      row.yaw = M.yaw * (mir ? -1 : 1); row.pitch = M.pitch; row.roll = M.roll
      // the angle the CAMERA sees (a head beside / above the camera axis is seen slightly from the side / below)
      const P = f.pose; row.tyaw = P.yaw + (P.body || 0) + Math.atan2(P.x, P.dist); row.tpitch = P.pitch - Math.atan2(P.y, P.dist)
      // body model exactly as the studio uses it: filtered points, shoulders, cross-check against the face
      let B = null
      if (f.pl) { const dt = poseT ? (now - poseT) / 1000 : 0; poseT = now; const pts = f.pl.map(([x, y, z, v]) => ({ x: (mir ? 1 - x : x) * W, y: y * H, z: z * W, v })); const pp = poseF.filter(pts, dt, Math.hypot(pts[11].x - pts[12].x, pts[11].y - pts[12].y) || W * 0.3); B = bodyFrom(pp)
        if (B) { const ch = M.P[152], below = -((B.mid.x - ch.x) * M.up.x + (B.mid.y - ch.y) * M.up.y), ratio = B.sw / M.fw3; if (below < M.fh * 0.15 || ratio < 1.5 || ratio > 4.5) B = null } }
      M.shoulders = opts.noBody || !B ? null : { l: B.l, r: B.r }
      if (f.gt.neck) { const a = opts.neck ? opts.neck(M, f, tr) : neckFrame(M, now / 1000).o; row.neck = { dx: (mx(a.x) - f.gt.neck[0]) / f.gt.neck[3], dy: (a.y - f.gt.neck[1]) / f.gt.neck[3] } }
      row.ears = {}
      for (const n of ['lobeL', 'lobeR']) {
        const a = M.project(n), g = f.gt[n], vis = earVisibility(a.facing), away = earAway(a.facing)
        const hiddenByFace = away > 0.5 && inside(a, FACE_OVAL.map((k) => M.P[k]))
        row.ears[n] = { dx: (mx(a.x) - g[0]) / g[3], dy: (a.y - g[1]) / g[3], trueVis: g[2], vis, painted: vis > 0.5 && !hiddenByFace }
      }
      row.surf = {}
      for (const id of Object.keys(D.map)) { const g = f.gt[id], p = M.P[+id]; if (!g || !p) continue; row.surf[id] = { dx: (mx(p.x) - g[0]) / pxcm, dy: (p.y - g[1]) / pxcm, v: g[2], px: [mx(p.x), p.y] } }
    }
    if (lm) { row.raw = {}; for (const id of Object.keys(D.map)) { const g = f.gt[id]; row.raw[id] = { dx: (lm[+id].x * W - g[0]) / pxcm, dy: (lm[+id].y * H - g[1]) / pxcm, v: g[2], px: [lm[+id].x * W, lm[+id].y * H] } } }
    rows.push(row)
  })
  return rows
}

const insideWrong = (e) => e.painted // painted while the real lobe is hidden and the face does not cover it
const q = (a, p) => { if (!a.length) return NaN; const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(p * (s.length - 1)))] }
const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN)
const f1 = (v) => (Number.isFinite(v) ? v.toFixed(2) : '-')

export function summarise(rows, D) {
  const segs = [...new Set(rows.map((r) => r.seg))], out = {}
  // per-landmark bias measured while still (a landmark definition differs slightly from the scan vertex picked under it)
  const still = rows.filter((r) => r.seg === 'still' && r.i > 15 && r.surf), bias = {}
  for (const id of Object.keys(D.map)) { const xs = still.map((r) => r.surf[id]?.dx).filter(Number.isFinite), ys = still.map((r) => r.surf[id]?.dy).filter(Number.isFinite); bias[id] = [q(xs, 0.5), q(ys, 0.5)] }
  const rbias = {}
  for (const id of Object.keys(D.map)) { const xs = still.map((r) => r.raw?.[id]?.dx).filter(Number.isFinite), ys = still.map((r) => r.raw?.[id]?.dy).filter(Number.isFinite); rbias[id] = [q(xs, 0.5), q(ys, 0.5)] }
  for (const s of [...segs, 'ALL']) {
    const R = rows.filter((r) => (s === 'ALL' ? true : r.seg === s) && !r.hidden)
    const tracked = R.filter((r) => r.M)
    const ear = [], earVisErr = [], surf = [], raw = [], yawE = [], pitchE = [], neckE = []
    tracked.forEach((r) => {
      // "ear vis wrong": an earring drawn over the face where the real lobe is hidden, or hidden while the lobe is in view
      for (const n of ['lobeL', 'lobeR']) { const e = r.ears[n]; if (e.trueVis) ear.push(Math.hypot(e.dx, e.dy)); earVisErr.push(e.trueVis ? (e.vis < 0.5 ? 1 : 0) : e.painted && e.vis > 0.5 && r.ears[n].dy !== undefined && insideWrong(e) ? 1 : 0) }
      for (const [id, e] of Object.entries(r.surf)) if (e.v) surf.push(Math.hypot(e.dx - bias[id][0], e.dy - bias[id][1]))
      if (r.raw) for (const [id, e] of Object.entries(r.raw)) if (e.v) raw.push(Math.hypot(e.dx - rbias[id][0], e.dy - rbias[id][1]))
      yawE.push(Math.abs(r.yaw - r.tyaw) * 57.3); pitchE.push(Math.abs(r.pitch - r.tpitch) * 57.3); if (r.neck) neckE.push(Math.hypot(r.neck.dx, r.neck.dy))
    })
    // still jitter: frame-to-frame movement of surface points in px (only meaningful in 'still' and 'light')
    const jit = []
    for (let k = 1; k < tracked.length; k++) { const a = tracked[k - 1], b = tracked[k]; if (b.i !== a.i + 1) continue; for (const id of ['61', '291', '33', '263', '1']) if (a.surf[id] && b.surf[id]) jit.push(Math.hypot(b.surf[id].px[0] - a.surf[id].px[0], b.surf[id].px[1] - a.surf[id].px[1])) }
    const rjit = []
    for (let k = 1; k < R.length; k++) { const a = R[k - 1], b = R[k]; if (!a.raw || !b.raw) continue; for (const id of ['61', '291', '33', '263', '1']) rjit.push(Math.hypot(b.raw[id].px[0] - a.raw[id].px[0], b.raw[id].px[1] - a.raw[id].px[1])) }
    out[s] = {
      frames: R.length, found: R.filter((r) => r.found).length, shown: tracked.length,
      earMed: q(ear, 0.5), earP95: q(ear, 0.95), earMax: q(ear, 1), earVisWrong: mean(earVisErr),
      surfMed: q(surf, 0.5), surfP95: q(surf, 0.95), rawMed: q(raw, 0.5), rawP95: q(raw, 0.95),
      yawErr: q(yawE, 0.5), yawP95: q(yawE, 0.95), pitchErr: q(pitchE, 0.5), pitchP95: q(pitchE, 0.95),
      jitPx: q(jit, 0.5), rawJitPx: q(rjit, 0.5), neckMed: q(neckE, 0.5), neckP95: q(neckE, 0.95),
    }
  }
  return out
}

export function table(S) {
  const cols = [['frames', 'n'], ['shown', 'shown'], ['earMed', 'ear cm'], ['earP95', 'ear p95'], ['earMax', 'ear max'], ['earVisWrong', 'ear vis wrong'], ['surfMed', 'surf cm'], ['surfP95', 'surf p95'], ['rawMed', 'raw cm'], ['rawP95', 'raw p95'], ['yawErr', 'yaw err'], ['yawP95', 'yaw p95'], ['pitchErr', 'pitch err'], ['pitchP95', 'pitch p95'], ['jitPx', 'jit px'], ['rawJitPx', 'raw jit'], ['neckMed', 'neck cm'], ['neckP95', 'neck p95']]
  const lines = ['seg'.padEnd(7) + cols.map(([, l]) => l.padStart(9)).join('')]
  for (const [s, v] of Object.entries(S)) lines.push(s.padEnd(7) + cols.map(([k]) => (k === 'frames' || k === 'shown' ? String(v[k]) : f1(v[k])).padStart(9)).join(''))
  return lines.join('\n')
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const rows = run(D, undefined, { mirror, noBody: process.argv.includes('--nobody') })
  console.log(`${file}: ${D.frames.length} frames, ${W}x${H}, detector ${D.detMs.toFixed(0)} ms/frame (${D.delegate}), mirror=${mirror}`)
  console.log(table(summarise(rows, D)))
  if (process.argv.includes('--rows')) fs.writeFileSync('tests/rig/data/rows.json', JSON.stringify(rows))
}
