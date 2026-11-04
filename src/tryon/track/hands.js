// Hand tracker: turns MediaPipe Hand Landmarker results into stable hands for the nail renderer (and hand occlusion).
//
// Per hand: 21 picture points (camera pixels, NOT mirrored) and the same 21 points in real-world metres (world landmarks).
// What it adds on top of the raw detector (measured with tests/harness.js "nailmotion"):
//  - IDENTITY BY POSITION: a detection is matched to the hand that was closest last frame, not to the model's "Left"/"Right"
//    label. The label is voted over time (it flips for single frames, which used to swap the nails between hands and flip which
//    side of the finger counts as the nail side).
//  - smoothing with a One Euro filter per hand (2D and 3D), speed measured in hand sizes so it works near and far
//  - MISSED FRAMES: the hand keeps moving with its measured speed for up to 200 ms (fast hand moves blur the picture)
//  - JUMP GUARD: a detection far from where the hand can be is held back for up to 2 frames
//  - presence fade in/out; a hand seen in only one frame is not "sure" (used before anything is erased for it)
import { PointSetFilter, Presence } from './filters.js'

export const HAND_SMOOTH = { minCutoff: 1.2, beta: 30, dCutoff: 1 }
const PRED_TAU = 0.1, PRED_MAX_MS = 200, GUARD = 0.2, GUARD_TURN = 0.3 // guard per 1/30 s beyond the prediction: hand sizes, radians

const size2d = (P) => Math.hypot(P[0].x - P[9].x, P[0].y - P[9].y) || 100
const centre = (P) => ({ x: (P[0].x + P[5].x + P[9].x + P[13].x + P[17].x) / 5, y: (P[0].y + P[5].y + P[9].y + P[13].y + P[17].y) / 5 })

export class HandTracker {
  constructor(opts = {}) {
    this.smooth = opts.smooth || HAND_SMOOTH; this.identity = opts.identity ?? true; this.predict = opts.predict ?? true; this.guard = opts.guard ?? true; this.guardDist = opts.guardDist ?? GUARD; this.guardTurn = opts.guardTurn ?? GUARD_TURN
    this.slots = []; this.seenAt = -1e9; this.jumps = 0; this.lastCall = null
  }
  reset() { this.slots = []; this.lastCall = null }
  _newSlot() { return { f: new PointSetFilter(this.smooth), fw: new PointSetFilter(this.smooth), pr: new Presence(150, 220, 90), t: null, vote: 0, streak: 0, suspect: 0 } }

  // the slot's points `age` seconds after its last detection, continued with the filters' own speed estimates
  _predicted(s, age) {
    if (!this.predict || !s.P) return s.P
    const k = PRED_TAU * (1 - Math.exp(-age / PRED_TAU)), f = s.f.f
    return s.P.map((p, i) => ({ x: p.x + f[i * 3].dx * k, y: p.y + f[i * 3 + 1].dx * k, z: p.z + f[i * 3 + 2].dx * k }))
  }

  // r: HandLandmarker result; w, h: frame size; now: ms. Returns [{ P, Wd, right, alpha, sure, id }]
  update(r, w, h, now) {
    const frameDt = this.lastCall == null ? 0 : Math.min(0.5, (now - this.lastCall) / 1000); this.lastCall = now
    const dets = []
    ;(r?.landmarks || []).forEach((lm, i) => {
      const hd = r.handedness?.[i]?.[0]; if (!hd || hd.score < 0.6) return // not sure it is a hand: ignore it
      const P = lm.map((q) => ({ x: q.x * w, y: q.y * h, z: (q.z || 0) * w }))
      dets.push({ P, Wd: r.worldLandmarks[i].map((q) => ({ x: q.x, y: q.y, z: q.z })), right: hd.categoryName === 'Left', c: centre(P), sz: size2d(P) }) // the model assumes a mirrored image; we analyse the un-mirrored picture
    })
    if (dets.length) this.seenAt = now
    // match detections to hands
    const used = new Set()
    if (this.identity) {
      const pairs = []
      this.slots.forEach((s, si) => { if (!s.P) return; const age = s.t == null ? 0 : (now - s.t) / 1000, pc = centre(this._predicted(s, age)), ssz = size2d(s.P); dets.forEach((d, di) => pairs.push([Math.hypot(d.c.x - pc.x, d.c.y - pc.y) / ssz, si, di])) })
      pairs.sort((a, b) => a[0] - b[0])
      const ang = (P) => Math.atan2(P[9].y - P[0].y, P[9].x - P[0].x)
      const takenS = new Set()
      for (const [dist, si, di] of pairs) { if (takenS.has(si) || used.has(di) || dist > 2.5) continue; takenS.add(si); used.add(di); const s = this.slots[si], turn = Math.abs(((ang(dets[di].P) - ang(s.P)) + 3 * Math.PI) % (2 * Math.PI) - Math.PI); this._feed(s, dets[di], now, frameDt, dist, turn) }
      dets.forEach((d, di) => { if (used.has(di)) return; if (this.slots.length >= 2) { const free = this.slots.findIndex((s) => !s.P); if (free < 0) return; this.slots[free] = this._newSlot(); this._feed(this.slots[free], d, now, frameDt, 0) } else { const s = this._newSlot(); this.slots.push(s); this._feed(s, d, now, frameDt, 0) } used.add(di) })
    } else { // previous behaviour: one slot per label
      dets.forEach((d) => { const key = d.right ? 1 : 0; this.slots[key] ||= this._newSlot(); this._feed(this.slots[key], d, now, frameDt, 0) })
    }
    const out = []
    this.slots.forEach((s, si) => {
      if (!s) return
      const seen = s.fedAt === now
      const a = s.pr.update(now, seen)
      s.streak = seen ? s.streak + 1 : 0
      if (a > 0 && s.P) {
        s.sure = s.streak >= 2 || (s.sure && a > 0)
        const age = s.t == null ? 0 : (now - s.t) / 1000, P = !seen && now - s.t < PRED_MAX_MS ? this._predicted(s, age) : s.P
        out.push({ P, Wd: s.Wd, right: this.identity ? s.vote > 0 : s.right, alpha: a, sure: s.sure, id: si })
      } else if (!seen) { s.f.reset(); s.fw.reset(); s.P = null; s.sure = false; s.vote = 0; s.t = null } // (seen but not faded in yet: keep it)
    })
    return out
  }

  _feed(s, d, now, frameDt, distFromPrediction, turn = 0) {
    // jump guard: far from where this hand can be (or turned much more than it can in one frame) -> hold back for up to 2 frames,
    // unless it keeps saying so (then it is real: a very fast move)
    // A wrong detection is a single odd frame; a real fast move keeps going: so a held detection is confirmed as soon as the next one
    // agrees with it (one frame of delay at most), and dropped when the next one is back where the hand was expected.
    const k = Math.max(1, frameDt * 30), ang = Math.atan2(d.P[9].y - d.P[0].y, d.P[9].x - d.P[0].x)
    // faster hands get more room (the prediction is less exact when the hand speeds up or slows down)
    const sp = s.P ? (Math.hypot(s.f.f[27].dx, s.f.f[28].dx) / (size2d(s.P) || 1)) / 30 : 0 // middle knuckle speed, hand sizes per 1/30 s
    const odd = this.guard && s.P && (distFromPrediction > this.guardDist * k + sp || turn > this.guardTurn * k + sp)
    if (odd) {
      const pd = s.pending, agrees = pd && Math.hypot(d.c.x - pd.c.x, d.c.y - pd.c.y) / d.sz < this.guardDist * k && Math.abs(((ang - pd.ang) + 3 * Math.PI) % (2 * Math.PI) - Math.PI) < this.guardTurn * k
      if (!agrees) { s.pending = { c: d.c, ang }; this.jumps++; return }
    }
    s.pending = null; s.suspect = 0
    const dt = s.t == null ? 0 : (now - s.t) / 1000; s.t = now; s.fedAt = now
    if (s.pr.stale(now)) { s.f.reset(); s.fw.reset() }
    s.P = s.f.filter(d.P, dt, d.sz); s.Wd = s.fw.filter(d.Wd, dt, 0.09); s.right = d.right
    s.vote = Math.max(-4, Math.min(4, s.vote + (d.right ? 1 : -1))) // handedness: majority of the recent frames
    if (s.vote === 0) s.vote = d.right ? 1 : -1
  }
}
