// Jewellery anchors on the 3D head rig with webcam-like jitter (node tests/rig/jewel.mjs): ear lobe and neck (necklace) error
// per movement and the frame-to-frame jitter of both while the head is still.
import fs from 'node:fs'
import { run } from './eval.mjs'
const D0 = JSON.parse(fs.readFileSync('tests/rig/data/seq.json', 'utf8')), px = 0.9
let seed = 777; const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648 }
const gauss = () => { let u = 0, v = 0; while (!u) u = rnd(); while (!v) v = rnd(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v) }
const D = { ...D0, frames: D0.frames.map((f) => { if (!f.lm) return f; const cx = gauss() * px * 0.7, cy = gauss() * px * 0.7; return { ...f, lm: f.lm.map(([x, y, z]) => [x + (cx + gauss() * px) / D0.W, y + (cy + gauss() * px) / D0.H, z + (gauss() * px) / D0.W]), pl: f.pl && f.pl.map(([x, y, z, v]) => [x + gauss() * 1.5 / D0.W, y + gauss() * 1.5 / D0.H, z, v]) } }) }
const rows = run(D)
const q = (a, p) => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(p * (s.length - 1))] }
const segs = [...new Set(rows.map((r) => r.seg))].filter((s) => s !== 'lost')
console.log('movement'.padEnd(9) + 'ear med/p95 cm'.padStart(16) + 'neck med/p95 cm'.padStart(18))
for (const s of segs) { const R = rows.filter((r) => r.seg === s && r.M && !r.hidden); const e = R.flatMap((r) => ['lobeL', 'lobeR'].filter((n) => r.ears[n].trueVis).map((n) => Math.hypot(r.ears[n].dx, r.ears[n].dy))), n = R.filter((r) => r.neck).map((r) => Math.hypot(r.neck.dx, r.neck.dy)); console.log(s.padEnd(9) + `${q(e, 0.5).toFixed(2)}/${q(e, 0.95).toFixed(2)}`.padStart(16) + (n.length ? `${q(n, 0.5).toFixed(2)}/${q(n, 0.95).toFixed(2)}` : '-').padStart(18)) }
const st = rows.filter((r) => r.seg === 'still' && r.i > 15 && r.M), jn = [], je = []
for (let k = 1; k < st.length; k++) { const a = st[k - 1], b = st[k]; if (b.i !== a.i + 1) continue; if (a.neck && b.neck) jn.push(Math.hypot(b.neck.dx - a.neck.dx, b.neck.dy - a.neck.dy) * b.pxcm); for (const n of ['lobeL', 'lobeR']) je.push(Math.hypot(b.ears[n].dx - a.ears[n].dx, b.ears[n].dy - a.ears[n].dy) * b.pxcm) }
console.log(`still jitter (px per frame, median): ears ${q(je, 0.5).toFixed(2)}, necklace ${q(jn, 0.5).toFixed(2)}`)
