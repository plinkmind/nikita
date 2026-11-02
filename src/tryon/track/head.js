// Head tracker: turns 478 Face Landmarker points into a STABLE, 3D-aware face for the renderers.
//
// How it works (one pass per NEW camera frame):
//  1. Fit MediaPipe's canonical 3D face model to the landmarks with a similarity transform (rotation + scale + position),
//     using only rigid points (eye corners, nose bridge, forehead, temples) - so blinking or talking cannot move the head.
//     All 3D work happens in the camera's own (un-mirrored) coordinates; mirroring is applied only to the final 2D output.
//     (The previous version mixed mirrored x with un-mirrored depth, which flips 3D handedness - one cause of earrings
//     landing on the cheek or nose.)
//  2. Filter the RIGID head motion (position, size, rotation) with a responsive One Euro filter -> little lag.
//  3. Filter the NON-RIGID part (expression: lips, lids, brows) separately with a calmer filter -> stable makeup masks.
//  4. Things that are not on the face mesh (ear lobes, nose piercings, neck) are fixed points on the canonical head.
//     They are positioned ONLY through the fitted head transform, never by borrowing a nearby landmark, so they cannot
//     jump to the cheek, mouth or nose. Their visibility comes from the fitted 3D rotation.
import { CANON } from './canonical.js'
import { fitSimilarity, apply, rotate } from './geometry.js'
import { OneEuro, PointSetFilter, Presence, smoothstep, clamp } from './filters.js'

// rigid landmarks (do not move with expressions)
const STABLE = [33, 133, 362, 263, 130, 359, 168, 6, 197, 195, 5, 4, 10, 151, 9, 8, 109, 338, 67, 297, 103, 332, 54, 284, 21, 251, 162, 389, 127, 356, 234, 454, 116, 345, 93, 323]
const C = (i) => [CANON[i * 3], CANON[i * 3 + 1], CANON[i * 3 + 2]]
const CANON_STABLE = STABLE.map(C)
const CANON_ALL = Array.from({ length: 468 }, (_, i) => C(i))
const FACE_WIDTH_CM = 15.32 // canonical distance 234 <-> 454

// Anchor points on the canonical head (centimetres, x = image right, y = up, z = toward camera) with an outward normal
// used for visibility. Ear lobes: level with the base of the nose, just outside and behind the face contour (234 / 454).
export const ANCHORS = {
  lobeL: { p: [-8.3, -1.3, -3.4], n: [-1, 0, 0] }, // the person's right ear (image left in an un-mirrored camera)
  lobeR: { p: [8.3, -1.3, -3.4], n: [1, 0, 0] },
  noseL: { p: [-1.92, -0.95, 5.0], n: [-0.8, 0, 0.6] }, // outside of the nostril wing (ala)
  noseR: { p: [1.92, -0.95, 5.0], n: [0.8, 0, 0.6] },
  neck: { p: [0, -15.5, -1.5], n: [0, 0, 1] },         // front base of the neck (fallback when the body model is off)
}

// Smoothing profiles. Different features need different behaviour:
//  rigid  - the head as a whole: quick to follow (jewellery, hair colour region, face restore)
//  shape  - expression on top of the head pose: calmer, so lipstick/eyeliner edges do not shimmer
// [minCutoff Hz, beta]. Units: position in face-widths, rotation in quaternion units, scale as log(size). Tuned with tests/harness.js.
export const RIGID = { pos: [1, 45], rot: [1, 30], scale: [1, 45] }
export const SHAPE = { minCutoff: 2.0, beta: 0.15, dCutoff: 1 } // units: canonical cm

export class HeadTracker {
  constructor(rigid = RIGID, shape = SHAPE) {
    this.fp = [0, 1, 2].map(() => new OneEuro(...rigid.pos, 1))
    this.fq = [0, 1, 2, 3].map(() => new OneEuro(...rigid.rot, 1))
    this.fs = new OneEuro(...rigid.scale, 1)
    this.shape = new PointSetFilter(shape)
    this.presence = new Presence(160, 240, 90)
    this.M = null; this.q = null; this.t = null; this.misses = 0; this.rejects = 0
  }
  reset() { this.fp.forEach((f) => f.reset()); this.fq.forEach((f) => f.reset()); this.fs.reset(); this.shape.reset(); this.q = null; this.t = null; this.M = null }

  // lm: normalized landmarks or null; W,H: frame size; mirror: selfie view; now: ms. Returns the face model to draw (or null).
  update(lm, W, H, mirror, now) {
    if (this.presence.stale(now) && this.M && !lm) { /* keep fading below */ }
    let ok = false
    if (lm && lm.length >= 468) {
      const u = lm.map((q) => [q.x * W, q.y * H, (q.z || 0) * W]) // camera pixels; depth uses the x scale (MediaPipe convention)
      const raw = fitSimilarity(CANON_STABLE, STABLE.map((i) => u[i]))
      const rel = raw.rms / raw.s // residual in canonical cm: big when the landmarks do not form a plausible face
      if (Number.isFinite(rel) && rel < 0.9 && raw.s > 0) {
        if (this.presence.stale(now, 500)) this.reset() // back after a real loss: start fresh instead of sliding from the old place
        this._ingest(u, raw, now)
        ok = true
      } else this.rejects++
    }
    if (!ok) this.misses++
    const a = this.presence.update(now, ok)
    if (!this.M) return null
    if (a <= 0) { this.M = null; this.reset(); return null }
    this.M.alpha = a
    if (ok) this._output(W, H, mirror)
    return this.M
  }

  _ingest(u, raw, now) {
    const dt = this.t === null ? 0 : Math.max(1e-3, (now - this.t) / 1000); this.t = now
    // rigid part: position (normalized by face size so settings work near and far), scale, rotation (quaternion)
    const sz = raw.s * FACE_WIDTH_CM
    const pos = raw.t.map((v, k) => this.fp[k].filter(v, dt, 1 / sz))
    const s = Math.exp(this.fs.filter(Math.log(raw.s), dt))
    let q = matToQuat(raw.R); if (this.q && q[0] * this.q[0] + q[1] * this.q[1] + q[2] * this.q[2] + q[3] * this.q[3] < 0) q = q.map((v) => -v)
    q = q.map((v, k) => this.fq[k].filter(v, dt)); const ql = Math.hypot(...q) || 1; q = q.map((v) => v / ql); this.q = q
    const fit = { s, R: quatToMat(q), t: pos }
    // non-rigid part: every landmark expressed in the head's own frame (canonical cm), filtered, then re-posed with the smooth head
    const RT = transpose(raw.R), local = u.map((p) => { const d = rotate(RT, [p[0] - raw.t[0], p[1] - raw.t[1], p[2] - raw.t[2]]); return { x: d[0] / raw.s, y: d[1] / raw.s, z: d[2] / raw.s } })
    const sh = this.shape.filter(local, dt, 1)
    this.fit = fit; this.local = sh
    if (!this.M) this.M = {}
  }

  _output(W, H, mirror) {
    const fit = this.fit, mx = (x) => (mirror ? W - x : x)
    const P = this.local.map((q) => { const p = apply(fit, [q.x, q.y, q.z]); return { x: mx(p[0]), y: p[1], z: p[2] } })
    const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y)
    // head axes in the picture (display space)
    const fwd = rotate(fit.R, [0, 0, 1]), up3 = rotate(fit.R, [0, 1, 0])
    const sx = mirror ? -1 : 1
    let yaw = Math.atan2(fwd[0], -fwd[2]) * sx, pitch = Math.atan2(fwd[1], -fwd[2]) // + = looking down
    const upL = Math.hypot(up3[0], up3[1]) || 1
    let a = P[33], b = P[263]; if (a.x > b.x) [a, b] = [b, a]
    const project = (name) => {
      const A = ANCHORS[name], p = apply(fit, A.p), n = rotate(fit.R, A.n)
      return { x: mx(p[0]), y: p[1], z: p[2], facing: -n[2] } // facing > 0: surface turned toward the camera
    }
    Object.assign(this.M, {
      P, W, H, fit, mirror, project,
      fw: dist(P[234], P[454]), fh: dist(P[10], P[152]),
      cm: fit.s,                        // pixels per centimetre at the face: true size, does not shrink when the head turns
      fw3: fit.s * FACE_WIDTH_CM,       // true face width in pixels
      up: { x: (sx * up3[0]) / upL, y: up3[1] / upL }, // chin -> forehead direction in the picture (y is negative when upright)
      roll: Math.atan2(b.y - a.y, b.x - a.x),
      yaw, pitch,
      inFrame: P.reduce((n, p) => n + (p.x >= 0 && p.x <= W && p.y >= 0 && p.y <= H ? 1 : 0), 0) / P.length,
    })
  }
}

// ear lobe visibility: the far ear disappears behind the head between about 25 and 40 degrees of turn
export const earVisibility = (facing) => 1 - smoothstep(0.42, 0.66, -facing)
export const noseVisibility = (facing) => smoothstep(-0.25, 0.1, facing)

function transpose(R) { return [[R[0][0], R[1][0], R[2][0]], [R[0][1], R[1][1], R[2][1]], [R[0][2], R[1][2], R[2][2]]] }
function matToQuat(R) {
  const tr = R[0][0] + R[1][1] + R[2][2]; let w, x, y, z
  if (tr > 0) { const s = Math.sqrt(tr + 1) * 2; w = s / 4; x = (R[2][1] - R[1][2]) / s; y = (R[0][2] - R[2][0]) / s; z = (R[1][0] - R[0][1]) / s }
  else if (R[0][0] > R[1][1] && R[0][0] > R[2][2]) { const s = Math.sqrt(1 + R[0][0] - R[1][1] - R[2][2]) * 2; w = (R[2][1] - R[1][2]) / s; x = s / 4; y = (R[0][1] + R[1][0]) / s; z = (R[0][2] + R[2][0]) / s }
  else if (R[1][1] > R[2][2]) { const s = Math.sqrt(1 + R[1][1] - R[0][0] - R[2][2]) * 2; w = (R[0][2] - R[2][0]) / s; x = (R[0][1] + R[1][0]) / s; y = s / 4; z = (R[1][2] + R[2][1]) / s }
  else { const s = Math.sqrt(1 + R[2][2] - R[0][0] - R[1][1]) * 2; w = (R[1][0] - R[0][1]) / s; x = (R[0][2] + R[2][0]) / s; y = (R[1][2] + R[2][1]) / s; z = s / 4 }
  return [w, x, y, z]
}
function quatToMat([w, x, y, z]) {
  return [[1 - 2 * (y * y + z * z), 2 * (x * y - w * z), 2 * (x * z + w * y)], [2 * (x * y + w * z), 1 - 2 * (x * x + z * z), 2 * (y * z - w * x)], [2 * (x * z - w * y), 2 * (y * z + w * x), 1 - 2 * (x * x + y * y)]]
}
export { CANON_ALL, clamp }
