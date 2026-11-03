// Outward surface direction (normal) of every vertex of MediaPipe's canonical face (468 points), computed once from the
// face mesh triangles. Rotated by the fitted head pose it tells which way each part of the face is turned.
import { CANON } from './canonical.js'
import { FACE_TRI } from './facemesh.js'

export const FACE_NORMALS = (() => {
  const N = 468, n = new Float32Array(N * 3)
  for (let t = 0; t < FACE_TRI.length; t += 3) {
    const i = FACE_TRI[t] * 3, j = FACE_TRI[t + 1] * 3, k = FACE_TRI[t + 2] * 3
    const u = [CANON[j] - CANON[i], CANON[j + 1] - CANON[i + 1], CANON[j + 2] - CANON[i + 2]], v = [CANON[k] - CANON[i], CANON[k + 1] - CANON[i + 1], CANON[k + 2] - CANON[i + 2]]
    const x = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]]
    for (const a of [i, j, k]) { n[a] += x[0]; n[a + 1] += x[1]; n[a + 2] += x[2] }
  }
  for (let a = 0; a < n.length; a += 3) { const l = Math.hypot(n[a], n[a + 1], n[a + 2]) || 1; n[a] /= l; n[a + 1] /= l; n[a + 2] /= l }
  return n
})()
