// 3D geometry used by the head tracker: similarity fit (rotation + scale + translation) between the canonical
// face model and the tracked landmarks, using Horn's closed-form quaternion method.

// Jacobi eigen-decomposition of a symmetric 4x4 matrix. Returns the eigenvector with the largest eigenvalue.
function topEigen4(A) {
  const a = A.map((r) => r.slice()), v = [[1, 0, 0, 0], [0, 1, 0, 0], [0, 0, 1, 0], [0, 0, 0, 1]]
  for (let sweep = 0; sweep < 30; sweep++) {
    let off = 0
    for (let p = 0; p < 3; p++) for (let q = p + 1; q < 4; q++) off += a[p][q] * a[p][q]
    if (off < 1e-18) break
    for (let p = 0; p < 3; p++) for (let q = p + 1; q < 4; q++) {
      if (Math.abs(a[p][q]) < 1e-30) continue
      const th = (a[q][q] - a[p][p]) / (2 * a[p][q]), t = Math.sign(th || 1) / (Math.abs(th) + Math.sqrt(th * th + 1))
      const c = 1 / Math.sqrt(t * t + 1), s = t * c
      for (let k = 0; k < 4; k++) { const akp = a[k][p], akq = a[k][q]; a[k][p] = c * akp - s * akq; a[k][q] = s * akp + c * akq }
      for (let k = 0; k < 4; k++) { const apk = a[p][k], aqk = a[q][k]; a[p][k] = c * apk - s * aqk; a[q][k] = s * apk + c * aqk }
      for (let k = 0; k < 4; k++) { const vkp = v[k][p], vkq = v[k][q]; v[k][p] = c * vkp - s * vkq; v[k][q] = s * vkp + c * vkq }
    }
  }
  let best = 0; for (let i = 1; i < 4; i++) if (a[i][i] > a[best][best]) best = i
  return [v[0][best], v[1][best], v[2][best], v[3][best]]
}

const quatToMat = ([w, x, y, z]) => [
  [1 - 2 * (y * y + z * z), 2 * (x * y - w * z), 2 * (x * z + w * y)],
  [2 * (x * y + w * z), 1 - 2 * (x * x + z * z), 2 * (y * z - w * x)],
  [2 * (x * z - w * y), 2 * (y * z + w * x), 1 - 2 * (x * x + y * y)],
]

// src, dst: arrays of [x,y,z]. Finds s, R, t minimising |s R src + t - dst|^2. Also returns the RMS residual.
export function fitSimilarity(src, dst) {
  const n = src.length, cs = [0, 0, 0], cd = [0, 0, 0]
  for (let i = 0; i < n; i++) for (let k = 0; k < 3; k++) { cs[k] += src[i][k] / n; cd[k] += dst[i][k] / n }
  const S = [[0, 0, 0], [0, 0, 0], [0, 0, 0]]; let ss = 0, sd = 0
  for (let i = 0; i < n; i++) {
    const a = [src[i][0] - cs[0], src[i][1] - cs[1], src[i][2] - cs[2]], b = [dst[i][0] - cd[0], dst[i][1] - cd[1], dst[i][2] - cd[2]]
    for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) S[r][c] += a[r] * b[c]
    ss += a[0] * a[0] + a[1] * a[1] + a[2] * a[2]; sd += b[0] * b[0] + b[1] * b[1] + b[2] * b[2]
  }
  const [[Sxx, Sxy, Sxz], [Syx, Syy, Syz], [Szx, Szy, Szz]] = S
  const N = [
    [Sxx + Syy + Szz, Syz - Szy, Szx - Sxz, Sxy - Syx],
    [Syz - Szy, Sxx - Syy - Szz, Sxy + Syx, Szx + Sxz],
    [Szx - Sxz, Sxy + Syx, -Sxx + Syy - Szz, Syz + Szy],
    [Sxy - Syx, Szx + Sxz, Syz + Szy, -Sxx - Syy + Szz],
  ]
  const R = quatToMat(topEigen4(N)), s = Math.sqrt(sd / (ss || 1))
  const t = [0, 1, 2].map((r) => cd[r] - s * (R[r][0] * cs[0] + R[r][1] * cs[1] + R[r][2] * cs[2]))
  let err = 0
  for (let i = 0; i < n; i++) {
    const p = apply({ s, R, t }, src[i]); err += (p[0] - dst[i][0]) ** 2 + (p[1] - dst[i][1]) ** 2 + (p[2] - dst[i][2]) ** 2
  }
  return { s, R, t, rms: Math.sqrt(err / n) }
}

export const apply = ({ s, R, t }, p) => [
  s * (R[0][0] * p[0] + R[0][1] * p[1] + R[0][2] * p[2]) + t[0],
  s * (R[1][0] * p[0] + R[1][1] * p[1] + R[1][2] * p[2]) + t[1],
  s * (R[2][0] * p[0] + R[2][1] * p[1] + R[2][2] * p[2]) + t[2],
]
export const rotate = (R, v) => [R[0][0] * v[0] + R[0][1] * v[1] + R[0][2] * v[2], R[1][0] * v[0] + R[1][1] * v[1] + R[1][2] * v[2], R[2][0] * v[0] + R[2][1] * v[1] + R[2][2] * v[2]]
export const sub3 = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
export const cross3 = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
export const dot3 = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
export const norm3 = (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l] }
