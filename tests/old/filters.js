// Settings were tuned on simulated landmark noise at 30 fps (see TRACKING-AUDIT.md): about 33% less jitter when still and
// 26-37% less error while moving than the old smoothing. They have NOT been tuned on real camera footage.
// One Euro Filter (Casiez, Roussel, Vogel, CHI 2012): a low-pass filter whose strength adapts to speed.
// Slow or still -> strong smoothing (no jitter). Fast -> light smoothing (no lag). It uses REAL timestamps, so it behaves the
// same at 30, 60 or 120 frames per second (the old smoothing was tied to the frame rate).
const alpha = (cutoff, dt) => 1 / (1 + 1 / (2 * Math.PI * cutoff) / dt)

export class OneEuro {
  constructor(minCutoff = 1, beta = 250, dCutoff = 1, floor = 0.15) { Object.assign(this, { minCutoff, beta, dCutoff, floor }); this.t = null }
  reset() { this.t = null }
  filter(x, t) {
    if (this.t === null) { this.x = x; this.dx = 0; this.t = t; return x }
    const dt = Math.max(1e-3, t - this.t)
    this.dx += alpha(this.dCutoff, dt) * ((x - this.x) / dt - this.dx) // smoothed speed
    // `floor` = speed that is just detection noise (ignored), so a still head is smoothed hard instead of treated as "moving"
    this.x += alpha(this.minCutoff + this.beta * Math.max(0, Math.abs(this.dx) - this.floor), dt) * (x - this.x)
    this.t = t
    return this.x
  }
}

// Filters a list of {x, y} points. Coordinates are divided by `scale` (for example the face width) first, so the same
// settings work for a face close to the camera and one far away.
export class PointSetFilter {
  constructor(opts = {}) { this.o = { minCutoff: 1, beta: 250, dCutoff: 1, floor: 0.15, ...opts }; this.fx = []; this.fy = []; this.fz = [] }
  reset() { this.fx = []; this.fy = []; this.fz = [] }
  apply(pts, tSec, scale) {
    return pts.map((p, i) => {
      const fx = (this.fx[i] ||= new OneEuro(this.o.minCutoff, this.o.beta, this.o.dCutoff, this.o.floor)), fy = (this.fy[i] ||= new OneEuro(this.o.minCutoff, this.o.beta, this.o.dCutoff, this.o.floor))
      const o = { ...p, x: fx.filter(p.x / scale, tSec) * scale, y: fy.filter(p.y / scale, tSec) * scale }
      if (p.z !== undefined) { const fz = (this.fz[i] ||= new OneEuro(this.o.minCutoff, this.o.beta, this.o.dCutoff, this.o.floor)); o.z = fz.filter(p.z / scale, tSec) * scale } // depth is filtered too
      return o
    })
  }
}
