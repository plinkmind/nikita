// Tracking filter comparison on the 3D head rig WITH realistic webcam landmark jitter added (the rig renders are cleaner
// than a real webcam). usage: node tests/rig/tune.mjs [noisePx=0.9]
// For each candidate head tracker: still jitter (px, lower = calmer), movement error of surface points and ear lobes
// (cm, lower = less lag), head angle error.
import fs from 'node:fs'
import { run, summarise } from './eval.mjs'
import { HeadTracker } from '../../src/tryon/track/head.js'

const px = +(process.argv.find((a) => /^[\d.]+$/.test(a)) || 0.9)
const D0 = JSON.parse(fs.readFileSync('tests/rig/data/seq.json', 'utf8'))
let seed = 777; const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648 }
const gauss = () => { let u = 0, v = 0; while (!u) u = rnd(); while (!v) v = rnd(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v) }
// common-mode shift (the whole face shifts a little) + per-point jitter, as in tests/harness.js addCamNoise
const D = { ...D0, frames: D0.frames.map((f) => { if (!f.lm) return f; const cx = gauss() * px * 0.7, cy = gauss() * px * 0.7; return { ...f, lm: f.lm.map(([x, y, z]) => [x + (cx + gauss() * px) / D0.W, y + (cy + gauss() * px) / D0.H, z + (gauss() * px) / D0.W]) } }) }

export function score(make, label) {
  const S = summarise(run(D, make), D)
  const mv = ['yaw', 'pitch', 'roll', 'side', 'updown', 'depth', 'body', 'combo']
  const avg = (k) => mv.reduce((s, m) => s + S[m][k], 0) / mv.length
  const r = { label, stillJit: S.still.jitPx, lightJit: S.light.jitPx, moveSurf: avg('surfMed'), moveSurfP95: avg('surfP95'), moveEar: avg('earMed'), earP95: S.ALL.earP95, yaw: S.ALL.yawErr, yawP95: S.ALL.yawP95, rawSurf: avg('rawMed') }
  console.log([label.padEnd(34), ...['stillJit', 'lightJit', 'moveSurf', 'moveSurfP95', 'moveEar', 'earP95', 'yaw', 'yawP95', 'rawSurf'].map((k) => r[k].toFixed(3).padStart(8))].join(''))
  return r
}
if (import.meta.url === `file://${process.argv[1]}`) {
  console.log(`noise ${px}px | ` + ['label'.padEnd(26), 'stillJit', 'lightJit', 'moveSurf', 'mSurfP95', 'moveEar', 'earP95', 'yaw', 'yawP95', 'rawSurf'].map((s) => s.padStart(8)).join(''))
  score(() => new HeadTracker(), 'current')
  score(() => new HeadTracker({ pos: [1e4, 0], rot: [1e4, 0], scale: [1e4, 0] }, { minCutoff: 1e4, beta: 0 }), 'no filter')
}
