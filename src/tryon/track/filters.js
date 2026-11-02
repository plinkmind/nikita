// Smoothing and tracking-confidence helpers shared by every tracker.
//
// One Euro filter (Casiez, Roussel & Vogel, CHI 2012): a low-pass filter whose cut-off frequency rises with speed.
// Still -> low cut-off -> jitter removed. Moving fast -> high cut-off -> almost no lag.
// Unlike the previous fixed-factor smoothing, it uses the REAL time between detections (dt), so it behaves the same
// on a 60 Hz laptop, a 120 Hz phone and a slow phone that only manages 12 detections a second.

const TAU = Math.PI * 2
const alpha = (cutoff, dt) => { const r = TAU * cutoff * dt; return r / (r + 1) }

export class OneEuro {
  constructor(minCutoff = 1, beta = 0, dCutoff = 1) { this.minCutoff = minCutoff; this.beta = beta; this.dCutoff = dCutoff; this.reset() }
  reset() { this.x = null; this.dx = 0 }
  // speedScale converts the speed into the units `beta` was tuned in (e.g. 1 / face width in pixels). Only the SPEED is
  // normalised, never the value itself: dividing positions by a size that jitters would make the whole face jump.
  filter(v, dt, speedScale = 1) {
    if (this.x === null || !(dt > 0)) { this.x = v; this.dx = 0; return v }
    const dv = (v - this.x) / dt // as in the original paper
    this.dx += alpha(this.dCutoff, dt) * (dv - this.dx)
    const cutoff = this.minCutoff + this.beta * Math.abs(this.dx) * speedScale
    this.x += alpha(cutoff, dt) * (v - this.x)
    return this.x
  }
}

// Filters a whole landmark set at once (x, y, z per point). `scale` (e.g. hand size in pixels) only normalises the SPEED,
// so the same settings work for a hand near the camera (big) or far away (small) without positions jumping when it jitters.
export class PointSetFilter {
  constructor({ minCutoff = 1, beta = 4, dCutoff = 1 } = {}) { this.p = { minCutoff, beta, dCutoff }; this.reset() }
  reset() { this.f = null; this.out = null }
  // pts: [{x,y,z}] in pixels. Returns a NEW array of filtered points (same length).
  filter(pts, dt, scale) {
    const n = pts.length, s = scale || 1
    if (!this.f || this.f.length !== n * 3) {
      this.f = Array.from({ length: n * 3 }, () => new OneEuro(this.p.minCutoff, this.p.beta, this.p.dCutoff))
      this.out = pts.map((q) => (q.v !== undefined ? { x: q.x, y: q.y, z: q.z || 0, v: q.v } : { x: q.x, y: q.y, z: q.z || 0 }))
      return this.out.map((q) => ({ ...q }))
    }
    const out = this.out
    for (let i = 0; i < n; i++) {
      const q = pts[i], k = i * 3
      out[i].x = this.f[k].filter(q.x, dt, 1 / s)
      out[i].y = this.f[k + 1].filter(q.y, dt, 1 / s)
      out[i].z = this.f[k + 2].filter(q.z || 0, dt, 1 / s)
      if (q.v !== undefined) out[i].v = q.v
    }
    return out.map((q) => ({ ...q }))
  }
}

// Tracking presence with graceful loss handling:
//  - found: fades in quickly (no pop)
//  - lost: keeps the last position for `holdMs` (covers a missed frame or a blink), then fades out over `fadeMs`
//    instead of leaving the item floating in the wrong place or snapping off.
//  - `stale()` tells the tracker to reset its filters if tracking was gone long enough that sliding from the
//    old position would look wrong.
export class Presence {
  constructor(holdMs = 160, fadeMs = 220, inMs = 90) { this.holdMs = holdMs; this.fadeMs = fadeMs; this.inMs = inMs; this.a = 0; this.lastSeen = -1e9; this.t = 0 }
  update(now, seen, confidence = 1) {
    const dt = Math.max(0, now - (this.t || now)); this.t = now
    if (seen) {
      this.lastSeen = now
      this.a = Math.min(confidence, this.a + dt / this.inMs)
    } else if (now - this.lastSeen > this.holdMs) {
      this.a = Math.max(0, this.a - dt / this.fadeMs)
    }
    return this.a
  }
  stale(now, ms = 600) { return now - this.lastSeen > ms }
  reset() { this.a = 0; this.lastSeen = -1e9 }
}

export const clamp = (v, a, b) => Math.max(a, Math.min(b, v))
export const smoothstep = (a, b, v) => { const t = clamp((v - a) / (b - a), 0, 1); return t * t * (3 - 2 * t) }
