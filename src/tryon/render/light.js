// Room light estimate, shared by every renderer (jewellery metal, gloss and nail highlights, 3D jewellery).
//
// How: about twice a second, the brightness of the real skin is sampled at ~300 points of the tracked 3D face mask. Each point
// also has a known surface direction (normal) from the fitted 3D head. Skin brightness = ambient + directional x (normal . light),
// solved by least squares, gives the DIRECTION the main light comes from and how strong it is against the ambient light
// ("contrast"). Because it compares the face with itself, it does not depend on skin tone.
// The overall picture also gives: a colour cast (grey-world white balance of the whole frame, so a warm lamp makes metals
// warmer) and an exposure level (bright parts of the frame, so a dim room makes metals dimmer). Values are smoothed over time.
import { CANON } from '../track/canonical.js'
import { FACE_TRI } from '../track/facemesh.js'
import { rotate } from '../track/geometry.js'

const N = 468

const NORMALS = (() => { // outward normals of the canonical face (same as render/facemesh.js)
  const n = new Float32Array(N * 3)
  for (let t = 0; t < FACE_TRI.length; t += 3) {
    const i = FACE_TRI[t] * 3, j = FACE_TRI[t + 1] * 3, k = FACE_TRI[t + 2] * 3
    const u = [CANON[j] - CANON[i], CANON[j + 1] - CANON[i + 1], CANON[j + 2] - CANON[i + 2]], v = [CANON[k] - CANON[i], CANON[k + 1] - CANON[i + 1], CANON[k + 2] - CANON[i + 2]]
    const x = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]]
    for (const a of [i, j, k]) { n[a] += x[0]; n[a + 1] += x[1]; n[a + 2] += x[2] }
  }
  for (let a = 0; a < n.length; a += 3) { const l = Math.hypot(n[a], n[a + 1], n[a + 2]) || 1; n[a] /= l; n[a + 1] /= l; n[a + 2] /= l }
  return n
})()
// skin points only: not eyes, brows, lips or the nostrils (they are darker for reasons other than light)
const NOT_SKIN = new Set([33, 246, 161, 160, 159, 158, 157, 173, 133, 155, 154, 153, 145, 144, 163, 7, 263, 466, 388, 387, 386, 385, 384, 398, 362, 382, 381, 380, 374, 373, 390, 249,
  46, 53, 52, 65, 55, 70, 63, 105, 66, 107, 276, 283, 282, 295, 285, 300, 293, 334, 296, 336,
  61, 185, 40, 39, 37, 0, 267, 269, 270, 409, 291, 375, 321, 405, 314, 17, 84, 181, 91, 146, 78, 191, 80, 81, 82, 13, 312, 311, 310, 415, 308, 324, 318, 402, 317, 14, 87, 178, 88, 95,
  79, 166, 75, 60, 20, 238, 239, 241, 242, 99, 98, 97, 2, 326, 327, 328, 290, 305, 309, 458, 459, 461, 462, 250])
const SKIN = Array.from({ length: N }, (_, i) => i).filter((i) => !NOT_SKIN.has(i) && i % 2 === 0)

// Default light: a little above and in front (what the 2D drawings assumed before)
export const DEFAULT_LIGHT = { dir: { x: -0.35, y: -0.6, z: 0.72 }, contrast: 0.35, tint: [1, 1, 1], bright: 1, ok: false }

// solve the 4x4 normal equations A x = b (Gaussian elimination)
function solve4(A, b) {
  const m = A.map((r, i) => [...r, b[i]])
  for (let c = 0; c < 4; c++) {
    let p = c; for (let r = c + 1; r < 4; r++) if (Math.abs(m[r][c]) > Math.abs(m[p][c])) p = r
    if (Math.abs(m[p][c]) < 1e-9) return null; [m[c], m[p]] = [m[p], m[c]]
    for (let r = 0; r < 4; r++) if (r !== c) { const f = m[r][c] / m[c][c]; for (let k = c; k < 5; k++) m[r][k] -= f * m[c][k] }
  }
  return m.map((r, i) => r[4] / r[i])
}

export function createLight() {
  const S = 160, cv = document.createElement('canvas'), cx = cv.getContext('2d', { willReadFrequently: true })
  let L = { ...DEFAULT_LIGHT, dir: { ...DEFAULT_LIGHT.dir } }, last = 0
  // M: tracked face (display coordinates); raw: the shown (mirrored) camera picture. Runs at most every `every` ms.
  function update(M, raw, now, every = 450) {
    if (!M?.fit || now - last < every) return L
    last = now
    const W = raw.width, H = raw.height, k = S / W, sh = Math.max(1, Math.round(H * k))
    if (cv.width !== S || cv.height !== sh) { cv.width = S; cv.height = sh }
    cx.drawImage(raw, 0, 0, S, sh); const d = cx.getImageData(0, 0, S, sh).data
    const sx = M.mirror ? -1 : 1
    // 1. light direction from the face: Y = a + b . n, n in display space (x right, y down, z toward the viewer).
    //    A surface turned away from the light gets only ambient light (Lambert's law is clamped at 0), which a straight-line fit
    //    gets wrong; so the fit is repeated 3 times, each time leaving out the points the previous fit says are in shadow.
    const pts = []
    for (const i of SKIN) {
      const p = M.P[i], x = Math.round(p.x * k), y = Math.round(p.y * k); if (x < 0 || y < 0 || x >= S || y >= sh) continue
      const n = rotate(M.fit.R, [NORMALS[i * 3], NORMALS[i * 3 + 1], NORMALS[i * 3 + 2]]), nz = -n[2]; if (nz < 0.15) continue // facing the camera only
      const o = (y * S + x) * 4
      pts.push([sx * n[0], n[1], nz, (0.299 * d[o] + 0.587 * d[o + 1] + 0.114 * d[o + 2]) / 255])
    }
    const target = { ...L, dir: { ...L.dir } }
    let dir = null, mag = 0, meanY = 0
    // the brightest 8% are left out too: they are shine (specular highlights on the nose and forehead), not diffuse light
    const ys = pts.map((p) => p[3]).sort((a, b) => a - b), yCap = ys.length ? ys[Math.floor(ys.length * 0.92)] : 1
    for (let it = 0, use = pts.filter((p) => p[3] <= yCap); it < 3 && use.length > 40; it++) {
      const A = [[0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]], bv = [0, 0, 0, 0]; let sY = 0
      for (const [a1, a2, a3, Y] of use) { const f = [1, a1, a2, a3]; for (let r = 0; r < 4; r++) { bv[r] += f[r] * Y; for (let c = 0; c < 4; c++) A[r][c] += f[r] * f[c] } sY += Y }
      const x = solve4(A, bv); if (!x || !x.every(Number.isFinite)) break
      mag = Math.hypot(x[1], x[2], x[3]); if (mag < 1e-4) break
      dir = { x: x[1] / mag, y: x[2] / mag, z: x[3] / mag }; meanY = sY / use.length
      use = pts.filter(([a1, a2, a3, Y]) => Y <= yCap && a1 * dir.x + a2 * dir.y + a3 * dir.z > -0.1) // lit points only for the next round
    }
    if (dir) {
      if (dir.z < 0.15) { dir.z = 0.15; const l = Math.hypot(dir.x, dir.y, dir.z); dir = { x: dir.x / l, y: dir.y / l, z: dir.z / l } } // a light behind the face cannot light it: keep it in front
      target.dir = dir; target.contrast = Math.max(0, Math.min(1.5, mag / Math.max(0.05, meanY))); target.ok = true
    }
    // 2. colour cast (grey world) and exposure (90th percentile brightness) from the whole picture
    let r = 0, g = 0, b = 0; const lum = new Uint8Array(256), n = S * sh
    for (let o = 0; o < d.length; o += 4) { r += d[o]; g += d[o + 1]; b += d[o + 2]; lum[(0.299 * d[o] + 0.587 * d[o + 1] + 0.114 * d[o + 2]) | 0]++ }
    const avg = (r + g + b) / 3 || 1, cl = (v) => Math.max(0.85, Math.min(1.15, v))
    target.tint = [cl(r / avg), cl(g / avg), cl(b / avg)]
    let acc = 0, p90 = 255; for (let v = 0; v < 256; v++) { acc += lum[v]; if (acc >= n * 0.9) { p90 = v; break } }
    target.bright = Math.max(0.55, Math.min(1.1, p90 / 220))
    // 3. smooth over time (no sudden jumps when someone walks past a lamp)
    const s = L.ok ? 0.35 : 1, mix = (a, b2) => a + (b2 - a) * s
    const md = { x: mix(L.dir.x, target.dir.x), y: mix(L.dir.y, target.dir.y), z: mix(L.dir.z, target.dir.z) }, dl = Math.hypot(md.x, md.y, md.z) || 1
    L = { dir: { x: md.x / dl, y: md.y / dl, z: md.z / dl }, contrast: mix(L.contrast, target.contrast), tint: L.tint.map((v, i) => mix(v, target.tint[i])), bright: mix(L.bright, target.bright), ok: target.ok || L.ok }
    return L
  }
  return { update, get value() { return L }, reset() { L = { ...DEFAULT_LIGHT, dir: { ...DEFAULT_LIGHT.dir } }; last = 0 } }
}

// 2D helpers for renderers
export const lightCss = (L) => { const k = L.bright; return `rgb(${Math.round(255 * Math.min(1, k * L.tint[0]))},${Math.round(255 * Math.min(1, k * L.tint[1]))},${Math.round(255 * Math.min(1, k * L.tint[2]))})` }
