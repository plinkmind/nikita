// A 3D head frame built from the landmarks themselves (their x, y AND depth z), no sign convention needed:
//   ex  = across the head (left cheek point 234 -> right cheek point 454)
//   fwd = the way the face points: perpendicular to ex and to the chin-forehead line, flipped so it points toward the nose
//   ey  = down the face
// From this we get real turn (left/right) and nod (up/down) angles and can place things that are NOT on the face mesh (ears) in 3D.
const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y, z: (a.z || 0) - (b.z || 0) })
const dot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z
const cross = (a, b) => ({ x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x })
const len = (a) => Math.hypot(a.x, a.y, a.z)
const norm = (a) => { const l = len(a) || 1; return { x: a.x / l, y: a.y / l, z: a.z / l } }
const mul = (a, k) => ({ x: a.x * k, y: a.y * k, z: a.z * k })
const add = (a, b) => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z })
export const clamp01 = (v) => Math.max(0, Math.min(1, v))

export function headFrame(P) {
  const l = P[234], r = P[454], c = { x: (l.x + r.x) / 2, y: (l.y + r.y) / 2, z: ((l.z || 0) + (r.z || 0)) / 2 }
  const across = sub(r, l), a = len(across) / 2, ex = norm(across)
  const down0 = norm(sub(P[152], P[10])), faceH = len(sub(P[152], P[10]))
  let fwd = norm(cross(ex, down0))
  if (dot(fwd, sub(P[1], c)) < 0) fwd = mul(fwd, -1) // point toward the nose
  let ey = norm(cross(fwd, ex)); if (dot(ey, down0) < 0) ey = mul(ey, -1)
  const exo = norm(cross(ey, fwd)); // re-orthogonalised across axis, keeps the original left->right direction
  return { c, ex: dot(exo, ex) < 0 ? mul(exo, -1) : exo, ey, fwd, a, faceH, camZ: fwd.z >= 0 ? 1 : -1, turn: fwd.x, nod: fwd.y }
}

// Where each ear lobe is, in picture pixels, plus how visible it is (0..1).
// The ear lobe sits slightly OUTSIDE the cheek contour points, a bit BELOW them, and a bit BEHIND them, all along the head's own axes.
export function earAnchors(F) {
  return [-1, 1].map((s) => {
    const p = add(add(add(F.c, mul(F.ex, s * F.a * 1.1)), mul(F.ey, F.faceH * 0.17)), mul(F.fwd, -F.a * 0.14))
    const facing = dot(mul(F.ex, s), { x: 0, y: 0, z: F.camZ }) // >0: the ear faces the camera, <0: it is on the far side of the head
    return { x: p.x, y: p.y, side: s, facing, vis: clamp01((facing + 0.3) / 0.18) } // fully shown until the head starts to cover the ear (about 7 degrees of turn), gone by about 17 degrees: better to hide an earring than to put it on the cheek
  })
}
