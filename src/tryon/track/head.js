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
import { FACE_NORMALS } from './normals.js'
import { fitSimilarity, apply, rotate } from './geometry.js'
import { OneEuro, PointSetFilter, Presence, smoothstep, clamp } from './filters.js'

// rigid landmarks (do not move with expressions)
const STABLE = [33, 133, 362, 263, 130, 359, 168, 6, 197, 195, 5, 4, 10, 151, 9, 8, 109, 338, 67, 297, 103, 332, 54, 284, 21, 251, 162, 389, 127, 356, 234, 454, 116, 345, 93, 323]
const C = (i) => [CANON[i * 3], CANON[i * 3 + 1], CANON[i * 3 + 2]]
const CANON_STABLE = STABLE.map(C)
const CANON_ALL = Array.from({ length: 468 }, (_, i) => C(i))
const CANON_C = [0, 1, 2].map((k) => CANON_STABLE.reduce((t, p) => t + p[k], 0) / CANON_STABLE.length) // centre of the rigid points
const IRIS_AT = [159, 159, 159, 159, 159, 386, 386, 386, 386, 386] // iris points (468-477) take the depth of their eye
const FACE_WIDTH_CM = 15.32 // canonical distance 234 <-> 454

// Anchor points on the canonical head (centimetres, x = image right, y = up, z = toward camera) with an outward normal
// used for visibility. Ear lobes (piercing point): about level with the base of the nose, outside the face contour and
// ~5 cm BEHIND the face surface. Measured on a 3D head scan turning +-45 deg (tests/rig): the earlier point (z -3.4) was 1.4 cm
// too far forward, which only shows when the head turns (error grew from 0.7 to 1.5 cm at 45 deg). Height is a compromise
// between the scan (-2.0) and the portrait photo (-1.3): real ears differ by about +-1 cm between people.
export const ANCHORS = {
  lobeL: { p: [-8.0, -1.7, -4.8], n: [-1, 0, 0] }, // the person's right ear (image left in an un-mirrored camera)
  lobeR: { p: [8.0, -1.7, -4.8], n: [1, 0, 0] },
  noseL: { p: [-1.92, -0.95, 5.0], n: [-0.8, 0, 0.6] }, // outside of the nostril wing (ala)
  noseR: { p: [1.92, -0.95, 5.0], n: [0.8, 0, 0.6] },
  // front base of the neck (collarbone notch) - only the FALLBACK when the body model has no shoulders. Measured on the
  // head scan: the earlier point (-15.5) was 3.4 cm too low. Use with projectPartial(): the neck only follows part of the
  // head's rotation (the notch is on the chest, it does not swing when you turn or nod your head).
  neck: { p: [0, -11.9, -1.7], n: [0, 0, 1] },
}

// NAMED FACE ANCHORS (M.anchor(name)). Every anchor is named after the PERSON's side (eyeR = the person's right eye, which is
// on the left of an un-mirrored camera picture and on the right of the selfie view). Two kinds:
//  - on the face mesh: the mean of a few landmarks, so it follows expressions (lips, brows, cheeks move with a smile);
//    its surface direction comes from the canonical face normals turned with the head
//  - off the mesh (ear lobes, nostril wings, neck): fixed points on the fitted 3D head (ANCHORS above)
// Each returns { x, y, z (picture pixels, depth), normal {x,y,z} (display space: x right, y down, z toward the viewer),
// facing (1 = turned to the camera, below 0 = turned away), visible (0..1, from facing), scale (pixels per cm), angle (head roll
// in the picture, radians) }. For jewellery, makeup and future items: never borrow a "nearby" landmark, ask for the anchor.
export const FACE_ANCHORS = {
  eyeR: [33, 133, 159, 145], eyeL: [263, 362, 386, 374], eyeCornerOutR: [33], eyeCornerInR: [133], eyeCornerOutL: [263], eyeCornerInL: [362],
  browR: [70, 63, 105, 66, 107], browL: [300, 293, 334, 296, 336],
  noseTip: [1], noseBridge: [168], noseBase: [2],
  lips: [13, 14], upperLip: [0], lowerLip: [17], lipCornerR: [61], lipCornerL: [291],
  cheekR: [50, 116], cheekL: [280, 345], cheekboneR: [117], cheekboneL: [346],
  chin: [152], jawR: [172], jawL: [397], jawLineR: [132, 58, 172, 136], jawLineL: [361, 288, 397, 365],
  forehead: [10, 151],
}
const HEAD_ANCHORS = { earR: 'lobeL', earL: 'lobeR', nostrilR: 'noseL', nostrilL: 'noseR', neck: 'neck' }
export const ANCHOR_NAMES = [...Object.keys(FACE_ANCHORS), ...Object.keys(HEAD_ANCHORS)]

// Smoothing profiles. Different features need different behaviour:
//  rigid  - the head as a whole: quick to follow (jewellery, hair colour region, face restore)
//  shape  - expression on top of the head pose: calmer, so lipstick/eyeliner edges do not shimmer
// [minCutoff Hz, beta]. Units: position in face-widths, rotation in quaternion units, scale as log(size).
// Re-tuned with tests/rig/face.mjs (Update 12): a faster speed estimate (dCutoff 2 Hz) lets the filter open up sooner when the
// head starts to move: lag error in quick left-right / up-down moves -22% / -25% for +2.5% still jitter (0.444 -> 0.455 px).
export const RIGID = { pos: [0.6, 45], rot: [0.6, 60], scale: [0.6, 45], dCutoff: 2 }
export const SHAPE = { minCutoff: 2.0, beta: 0.15, dCutoff: 1 } // units: canonical cm

// Perspective (optional, OFF by default). A pinhole camera shows a point 5 cm behind the face (an ear lobe) closer to the
// picture centre than a flat ("weak-perspective") head model does. Measured on the 3D head rig (tests/rig/persp.mjs), a
// perspective fit did NOT place ear lobes better: median ear error 0.45 cm flat vs 0.87 cm perspective with today's anchor and
// 0.36 cm even after re-fitting the anchor for it, because Face Landmarker's points themselves behave close to a flat
// projection. Head-turn angle improved (2.6 -> 2.1 deg) but nod got worse (1.1 -> 1.5 deg). So the flat model stays; FOCAL
// (focal length / longer frame side, e.g. 0.75) switches the perspective model on for future tests.
export const FOCAL = 0
const VIEW_FOCAL = 0.75 // for visibility only: typical phone / webcam field of view (about 67 deg across the long side)

// Missed frames and wrong detections (measured with tests/rig/face.mjs)
const PREDICT = true, PRED_TAU = 0.12, PRED_MAX_MS = 250 // continue the movement for up to 250 ms without a detection
const GUARD = true, GUARD_MOVE = 0.3, GUARD_SCALE = 0.15, GUARD_TURN = 0.2 // per 1/30 s beyond the prediction: face widths, log size, radians (11.5 deg); allowed more after a longer gap

export class HeadTracker {
  constructor(rigid = RIGID, shape = SHAPE, focal = FOCAL) {
    this.focal = focal
    const dc = rigid.dCutoff ?? 1
    this.fp = [0, 1, 2].map(() => new OneEuro(...rigid.pos, dc))
    this.fq = [0, 1, 2, 3].map(() => new OneEuro(...rigid.rot, dc))
    this.fs = new OneEuro(...rigid.scale, dc)
    this.shape = new PointSetFilter(shape)
    this.presence = new Presence(160, 240, 90)
    this.M = null; this.q = null; this.t = null; this.misses = 0; this.rejects = 0; this.jumps = 0; this.suspect = 0; this.guard = GUARD; this.predict = PREDICT
  }
  reset() { this.fp.forEach((f) => f.reset()); this.fq.forEach((f) => f.reset()); this.fs.reset(); this.shape.reset(); this.q = null; this.t = null; this.M = null; this.fit = null; this.suspect = 0 }

  // where the head should be `age` seconds after the last detection, from the filters' own speed estimates. The speed is
  // trusted less the longer the gap (it fades with a 0.12 s time constant), so a missed frame continues the movement
  // smoothly instead of freezing the overlay while the real head moves on.
  _predict(age) {
    const fit = this.fit, k = PRED_TAU * (1 - Math.exp(-age / PRED_TAU))
    const t = fit.t.map((v, i) => v + this.fp[i].dx * k), s = fit.s * Math.exp(this.fs.dx * k)
    let q = this.q.map((v, i) => v + this.fq[i].dx * k); const l = Math.hypot(...q) || 1; q = q.map((v) => v / l)
    return { s, R: quatToMat(q), t, q }
  }
  // is this detection far from where the head can be? (a wrong detection for one or two frames: a hand, motion blur)
  _implausible(raw, now) {
    if (!this.fit || this.t === null) return false
    const gap = Math.max(0, (now - this.t) / 1000), p = this._predict(gap), fw = p.s * FACE_WIDTH_CM, k = Math.max(1, (this.frameDt || 0) * 30) // slow phones (longer time between camera frames) allow a bigger change
    const move = Math.hypot(raw.t[0] - p.t[0], raw.t[1] - p.t[1]) / fw, grow = Math.abs(Math.log(raw.s / p.s))
    const q = matToQuat(raw.R), dot = Math.abs(q[0] * p.q[0] + q[1] * p.q[1] + q[2] * p.q[2] + q[3] * p.q[3]), turn = 2 * Math.acos(Math.min(1, dot))
    return move > k * (this.gMove ?? GUARD_MOVE) || grow > k * (this.gScale ?? GUARD_SCALE) || turn > k * (this.gTurn ?? GUARD_TURN)
  }

  // lm: normalized landmarks or null; W,H: frame size; mirror: selfie view; now: ms. Returns the face model to draw (or null).
  update(lm, W, H, mirror, now) {
    this.frameDt = this.lastCall == null ? 0 : Math.min(0.5, (now - this.lastCall) / 1000); this.lastCall = now
    if (this.presence.stale(now) && this.M && !lm) { /* keep fading below */ }
    let ok = false
    if (lm && lm.length >= 468) {
      const u = lm.map((q) => [q.x * W, q.y * H, (q.z || 0) * W]) // camera pixels; depth uses the x scale (MediaPipe convention)
      let raw = fitSimilarity(CANON_STABLE, STABLE.map((i) => u[i]))
      if (this.focal && raw.s > 0) { // undo perspective with the fitted depth of every point, then fit again (2 rounds)
        const f = this.focal * Math.max(W, H), cx = W / 2, cy = H / 2
        for (let it = 0; it < 2; it++) {
          const zr = apply(raw, CANON_C)[2]
          for (let i = 0; i < u.length; i++) { const q = lm[i], k = (f + apply(raw, CANON_ALL[i < 468 ? i : IRIS_AT[i - 468]])[2] - zr) / f; u[i][0] = cx + (q.x * W - cx) * k; u[i][1] = cy + (q.y * H - cy) * k }
          raw = fitSimilarity(CANON_STABLE, STABLE.map((i) => u[i]))
        }
      }
      const rel = raw.rms / raw.s // residual in canonical cm: big when the landmarks do not form a plausible face
      if (Number.isFinite(rel) && rel < 0.9 && raw.s > 0) {
        if (this.presence.stale(now, 500)) this.reset() // back after a real loss: start fresh instead of sliding from the old place
        // JUMP GUARD: a detection far from the predicted head is held back for up to 2 frames. If it is still there on the 3rd,
        // the head really is there (a very fast move, or the face came back elsewhere): jump to it without sliding.
        if (this.guard && this._implausible(raw, now) && this.suspect < 2) { this.suspect++; this.jumps++ }
        else { if (this.suspect >= 2) this.reset(); this.suspect = 0; this._ingest(u, raw, now); ok = true }
      } else this.rejects++
    }
    if (!ok) this.misses++
    const a = this.presence.update(now, ok)
    if (!this.M) return null
    if (a <= 0) { this.M = null; this.reset(); return null }
    this.M.alpha = a
    if (ok) this._output(W, H, mirror)
    else if (this.predict && this.fit && this.t !== null && now - this.t < PRED_MAX_MS) this._output(W, H, mirror, this._predict((now - this.t) / 1000)) // missed frame: continue the movement
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

  _output(W, H, mirror, fit = this.fit) {
    const mx = (x) => (mirror ? W - x : x)
    // weak-perspective point -> camera picture: nearer points spread out from the picture centre, farther ones move in
    const f = this.focal ? this.focal * Math.max(W, H) : 0, cx = W / 2, cy = H / 2, zr = apply(fit, CANON_C)[2]
    const persp = (p) => { if (!f) return [p[0], p[1], p[2], 1]; const k = f / Math.max(f * 0.3, f + p[2] - zr); return [cx + (p[0] - cx) * k, cy + (p[1] - cy) * k, p[2], k] }
    const P = this.local.map((q) => { const p = persp(apply(fit, [q.x, q.y, q.z])); return { x: mx(p[0]), y: p[1], z: p[2] } })
    const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y)
    // head axes in the picture (display space)
    const fwd = rotate(fit.R, [0, 0, 1]), up3 = rotate(fit.R, [0, 1, 0])
    const sx = mirror ? -1 : 1
    let yaw = Math.atan2(fwd[0], -fwd[2]) * sx, pitch = Math.atan2(fwd[1], -fwd[2]) // + = looking down
    const upL = Math.hypot(up3[0], up3[1]) || 1
    let a = P[33], b = P[263]; if (a.x > b.x) [a, b] = [b, a]
    const project = (name) => {
      const A = ANCHORS[name], p = persp(apply(fit, A.p)), n = rotate(fit.R, A.n)
      // facing is measured against the camera's line of sight to THIS point: a head beside the middle of the picture is seen
      // slightly from the side, so its far ear goes out of view earlier (tests/rig "partial": a head 15 cm off centre)
      const F = VIEW_FOCAL * Math.max(W, H), vx = (p[0] - W / 2) / F, vy = (p[1] - H / 2) / F, vl = Math.hypot(vx, vy, 1)
      return { x: mx(p[0]), y: p[1], z: p[2], k: p[3], facing: -(n[0] * vx + n[1] * vy + n[2]) / vl } // facing > 0: surface turned toward the camera; k: size factor vs the face
    }
    // like project(), but with only a fraction `beta` of the head's rotation away from facing the camera (for points that sit
    // below the head, on the neck/chest, which turn less than the head does)
    const projectPartial = (name, beta) => {
      const A = ANCHORS[name], Rb = matMul(rotFraction(matMul(fit.R, BASE), beta), BASE), p = persp(apply({ s: fit.s, R: Rb, t: fit.t }, A.p))
      return { x: mx(p[0]), y: p[1], z: p[2] }
    }
    // named anchors (see FACE_ANCHORS), computed when asked for and cached for this frame
    const cache = {}
    const anchor = (name) => {
      if (cache[name]) return cache[name]
      let r
      if (HEAD_ANCHORS[name]) { const a = project(HEAD_ANCHORS[name]), n = rotate(fit.R, ANCHORS[HEAD_ANCHORS[name]].n); r = { x: a.x, y: a.y, z: a.z, normal: { x: sx * n[0], y: n[1], z: -n[2] }, facing: a.facing } }
      else {
        const ids = FACE_ANCHORS[name]; if (!ids) return null
        let x = 0, y = 0, z = 0, nx = 0, ny = 0, nz = 0
        for (const i of ids) { x += P[i].x; y += P[i].y; z += P[i].z; nx += FACE_NORMALS[i * 3]; ny += FACE_NORMALS[i * 3 + 1]; nz += FACE_NORMALS[i * 3 + 2] }
        const k = ids.length, n = rotate(fit.R, [nx / k, ny / k, nz / k]), nl = Math.hypot(...n) || 1
        r = { x: x / k, y: y / k, z: z / k, normal: { x: (sx * n[0]) / nl, y: n[1] / nl, z: -n[2] / nl }, facing: -n[2] / nl }
      }
      r.visible = smoothstep(-0.05, 0.25, r.facing); r.scale = fit.s; r.angle = roll
      return (cache[name] = r)
    }
    const roll = Math.atan2(b.y - a.y, b.x - a.x)
    Object.assign(this.M, {
      P, W, H, fit, mirror, project, projectPartial, persp, focal: f, anchor,
      fw: dist(P[234], P[454]), fh: dist(P[10], P[152]),
      cm: fit.s,                        // pixels per centimetre at the face: true size, does not shrink when the head turns
      fw3: fit.s * FACE_WIDTH_CM,       // true face width in pixels
      up: { x: (sx * up3[0]) / upL, y: up3[1] / upL }, // chin -> forehead direction in the picture (y is negative when upright)
      roll,
      yaw, pitch,
      inFrame: P.reduce((n, p) => n + (p.x >= 0 && p.x <= W && p.y >= 0 && p.y <= H ? 1 : 0), 0) / P.length,
    })
  }
}

// Ear visibility. The far ear lobe goes behind the cheek and jaw at only ~15-20 deg of turn, but an earring HANGS below the
// lobe and stays visible under the jaw much longer. So the part of an earring that is behind the face is cut away with the
// face outline (jewellery.js, earOcclusion), and the whole earring only fades when the ear is fully behind the head
// (about 35 to 55 deg). Before, the whole earring stayed until ~30 deg and was painted OVER the cheek from 15 to 30 deg.
export const earVisibility = (facing) => 1 - smoothstep(0.57, 0.82, -facing)
// how much an ear is turned away from the camera (0 = side-on or toward, 1 = clearly away): enables the face cut-out
export const earAway = (facing) => smoothstep(0.02, 0.12, -facing)
export const noseVisibility = (facing) => smoothstep(-0.25, 0.1, facing)

// canonical (y up, z toward camera) -> camera picture (y down, z away): the head facing the camera straight on
const BASE = [[1, 0, 0], [0, -1, 0], [0, 0, -1]]
const matMul = (A, B) => A.map((r) => [0, 1, 2].map((j) => r[0] * B[0][j] + r[1] * B[1][j] + r[2] * B[2][j]))
function rotFraction(R, beta) { // same rotation axis, beta x the angle
  const c = Math.max(-1, Math.min(1, (R[0][0] + R[1][1] + R[2][2] - 1) / 2)), ang = Math.acos(c); if (ang < 1e-6) return R
  const sn = Math.sin(ang), [x, y, z] = [(R[2][1] - R[1][2]) / (2 * sn), (R[0][2] - R[2][0]) / (2 * sn), (R[1][0] - R[0][1]) / (2 * sn)]
  const a = ang * beta, ca = Math.cos(a), sa = Math.sin(a), C = 1 - ca
  return [[ca + x * x * C, x * y * C - z * sa, x * z * C + y * sa], [y * x * C + z * sa, ca + y * y * C, y * z * C - x * sa], [z * x * C - y * sa, z * y * C + x * sa, ca + z * z * C]]
}
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
export { CANON_ALL, CANON_C, clamp }
