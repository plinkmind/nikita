// Perspective head fit vs the earlier flat (weak-perspective) fit on the 3D head rig, with webcam-like jitter.
// The rig camera's real focal length is 0.769 x the frame width; the studio assumes 0.75. Wrong guesses are tried too,
// because a phone's real field of view is not known. usage: node tests/rig/persp.mjs
import fs from 'node:fs'
import { run, summarise } from './eval.mjs'
import { HeadTracker, RIGID, SHAPE } from '../../src/tryon/track/head.js'
const D0 = JSON.parse(fs.readFileSync('tests/rig/data/seq.json', 'utf8')), px = 0.9
let seed = 777; const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648 }
const gauss = () => { let u = 0, v = 0; while (!u) u = rnd(); while (!v) v = rnd(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v) }
const D = { ...D0, frames: D0.frames.map((f) => { if (!f.lm) return f; const cx = gauss() * px * 0.7, cy = gauss() * px * 0.7; return { ...f, lm: f.lm.map(([x, y, z]) => [x + (cx + gauss() * px) / D0.W, y + (cy + gauss() * px) / D0.H, z + (gauss() * px) / D0.W]) } }) }
const cols = [['ALL', 'earMed'], ['ALL', 'earP95'], ['depth', 'earMed'], ['depth', 'earP95'], ['yaw', 'earP95'], ['combo', 'earP95'], ['ALL', 'surfMed'], ['depth', 'surfP95'], ['ALL', 'yawErr'], ['ALL', 'pitchErr'], ['still', 'jitPx'], ['ALL', 'neckMed']]
console.log('focal'.padEnd(22) + cols.map(([a, b]) => `${a}.${b}`.padStart(13)).join(''))
for (const [label, f] of [['flat (before)', 0], ['0.60 (too wide)', 0.6], ['0.75 (studio)', 0.75], ['0.769 (true)', 0.769], ['0.95 (too narrow)', 0.95]]) {
  const S = summarise(run(D, () => new HeadTracker(RIGID, SHAPE, f)), D)
  console.log(label.padEnd(22) + cols.map(([a, b]) => S[a][b].toFixed(2).padStart(13)).join(''))
}
