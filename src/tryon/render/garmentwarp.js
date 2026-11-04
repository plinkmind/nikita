// Garment WARP for the live outfit preview: your garment photo is cut into a mesh (a grid of small triangles) and every point of that
// mesh is moved onto your body, following the body points of the pose model (shoulders, elbows, wrists, hips).
//
// What it models (and what it does not):
//  - the TORSO part follows a simple body shape: a slightly elliptical cylinder whose width follows your shoulders, waist and hips,
//    tilted and bent with your shoulder line and torso axis, and turned with your body (left / right turn from the pose model's
//    depth). The garment keeps its own proportions, half way between its own shape and your body's (a loose dress stays loose).
//  - each SLEEVE (if the photo has sleeves) is bound to your arm: it turns with the upper arm, and a long sleeve bends at the elbow.
//  - this is a 2D picture bent onto a simple body shape. It is NOT a cloth simulation: there is no real drape, no gravity, no
//    wrinkles of its own, no back side; only the folds and light of what you are wearing are carried onto it (see the shader).
//
// garmentGeo(): measures the garment photo once (collar, shoulders, armpits, sleeve directions, width profile).
// warpMesh(): every frame, the screen position of each mesh point.

const smooth = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t) }
const lerp = (a, b, t) => a + (b - a) * t
const ang = (v) => Math.atan2(v.y, v.x)
const rot = (v, a) => ({ x: v.x * Math.cos(a) - v.y * Math.sin(a), y: v.x * Math.sin(a) + v.y * Math.cos(a) })

// alpha: Uint8 alpha (w x h) of the cut-out garment. Returns null when nothing usable is there.
export function garmentGeo(alpha, w, h) {
  const A = (i, j) => alpha[j * w + i] > 100
  const ext = (j) => { let lo = -1, hi = -1; for (let i = 0; i < w; i++) if (A(i, j)) { if (lo < 0) lo = i; hi = i } return [lo, hi] }
  let top = 0; while (top < h * 0.4 && (ext(top)[1] - ext(top)[0]) < w * 0.3) top++
  let bot = h - 1; while (bot > top && ext(bot)[0] < 0) bot--
  if (bot - top < h * 0.3) return null
  const H = bot - top
  // centre line: middle of the garment's widest run near the top
  const cx0 = (() => { const e = ext(Math.round(top + H * 0.6)); return e[0] < 0 ? w / 2 : (e[0] + e[1]) / 2 })()
  // the run of garment pixels that contains the centre, per row (the torso; sleeves outside it are separated by background,
  // or - where they join - this is the full width)
  const run = (j, cx) => { let i0 = Math.round(cx), i1 = i0; if (!A(i0, j)) { let k = 1; while (k < w * 0.2 && !A(i0 + k, j) && !A(i0 - k, j)) k++; i0 = A(i0 + k, j) ? i0 + k : i0 - k; i1 = i0; if (!A(i0, j)) return null } while (i0 > 0 && A(i0 - 1, j)) i0--; while (i1 < w - 1 && A(i1 + 1, j)) i1++; return [i0, i1] }
  const prof = new Float32Array(h), cen = new Float32Array(h)
  for (let j = top; j <= bot; j++) {
    // the centre column is background at a neckline (V or round neck): use the full width of the row there
    const r = A(Math.round(cx0), j) ? run(j, cx0) : (() => { const e = ext(j); return e[0] < 0 ? null : e })()
    if (r) { prof[j] = (r[1] - r[0]) / 2; cen[j] = (r[0] + r[1]) / 2 } else { prof[j] = j > top ? prof[j - 1] : 0; cen[j] = j > top ? cen[j - 1] : cx0 }
  }
  // torso width well below the armpits (55-75% down): the body panel
  const lowRows = []; for (let j = Math.round(top + H * 0.55); j <= Math.round(top + H * 0.75); j++) lowRows.push(prof[j])
  lowRows.sort((a, b) => a - b); const body = lowRows[lowRows.length >> 1] || w * 0.3
  // shoulder line: a little below the collar (the existing sizing rule, see outfit.js)
  const sh = Math.min(bot, top + Math.round(h * 0.05))
  // armpit: the row below which the torso run stays at about the body width (above it, attached sleeves make the rows wider)
  let pit = sh; for (let j = sh; j < top + H * 0.5; j++) if (prof[j] > body * 1.12) pit = j + 1 // (sleeves widen the rows below the shoulder line)
  const sleeves = pit - sh > H * 0.04 && Math.max(...Array.from(prof.subarray(sh, pit + 1))) > body * 1.25
  // the shoulder width: the body panel width, nudged toward the measured row at the shoulder line (sleeves excluded)
  const shRow = ext(sh), shHalf = sleeves ? body * 1.02 : Math.max(body * 0.8, Math.min(body * 1.2, (shRow[1] - shRow[0]) / 2))
  if (sleeves) for (let j = top; j < pit; j++) { prof[j] = lerp(shHalf, body, smooth(sh, pit, j)); cen[j] = cx0 }
  // sleeves: garment pixels outside the torso run above the armpit (left and right): direction from the shoulder point to their far end
  const sleeve = (side) => {
    if (!sleeves) return null
    // the sleeve's long axis: principal direction of the garment pixels outside the torso panel above the armpit (pointing away
    // from the shoulder); its length: how far those pixels reach along it
    const S = { x: cx0 + side * shHalf, y: sh }, pts = []
    for (let j = top; j <= Math.min(bot, pit + H * 0.15); j++) for (let i = 0; i < w; i += 2) if (A(i, j) && side * (i - cx0) >= prof[j] + 2) pts.push(i, j)
    const n = pts.length / 2; if (n < 20) return null
    let mx = 0, my = 0; for (let q = 0; q < pts.length; q += 2) { mx += pts[q]; my += pts[q + 1] } mx /= n; my /= n
    let sxx = 0, sxy = 0, syy = 0; for (let q = 0; q < pts.length; q += 2) { const dx = pts[q] - mx, dy = pts[q + 1] - my; sxx += dx * dx; sxy += dx * dy; syy += dy * dy }
    const th = 0.5 * Math.atan2(2 * sxy, sxx - syy); let dir = { x: Math.cos(th), y: Math.sin(th) }
    if ((mx - S.x) * dir.x + (my - S.y) * dir.y < 0) dir = { x: -dir.x, y: -dir.y }
    let len = 0; for (let q = 0; q < pts.length; q += 2) len = Math.max(len, (pts[q] - S.x) * dir.x + (pts[q + 1] - S.y) * dir.y)
    return { S, dir, len }
  }
  return { w, h, top, bot, sh, pit, cx: cx0, shHalf, body, prof, cen, sleeves, sl: sleeve(-1), sr: sleeve(1) }
}

// The body, in screen pixels, from the 33 pose points (already mirrored like the picture). Missing hips / elbows are estimated.
export function bodyPose(P, B) {
  const ok = (p) => p && p.v > 0.5
  const leftIsL = P[11].x <= P[12].x, Li = leftIsL ? [11, 13, 15, 23] : [12, 14, 16, 24], Ri = leftIsL ? [12, 14, 16, 24] : [11, 13, 15, 23]
  const sl = P[Li[0]], sr = P[Ri[0]], sw = B.sw, down = { x: -B.ux.y, y: B.ux.x } // perpendicular to the shoulder line, pointing down
  const dn = down.y < 0 ? { x: -down.x, y: -down.y } : down
  let hl = P[Li[3]], hr = P[Ri[3]], hipsSeen = ok(hl) && ok(hr)
  if (hipsSeen) { const hm = { x: (hl.x + hr.x) / 2, y: (hl.y + hr.y) / 2 }, L = Math.hypot(hm.x - B.mid.x, hm.y - B.mid.y) / sw; if (L < 0.7 || L > 2.2) hipsSeen = false } // (implausible: not used)
  if (!hipsSeen) { const t = 1.35 * sw, hw = 0.62 * sw; hl = { x: B.mid.x + dn.x * t - B.ux.x * hw / 2, y: B.mid.y + dn.y * t - B.ux.y * hw / 2 }; hr = { x: B.mid.x + dn.x * t + B.ux.x * hw / 2, y: B.mid.y + dn.y * t + B.ux.y * hw / 2 } }
  const arm = (I, side) => {
    const S = P[I[0]], E = P[I[1]], W = P[I[2]]
    const def1 = rot(dn, -side * 0.25), Lu = 0.85 * sw // arm out of the picture: hanging down, a little away from the body
    const e = ok(E) ? E : { x: S.x + def1.x * Lu, y: S.y + def1.y * Lu }
    const w2 = ok(E) && ok(W) ? W : { x: e.x + (e.x - S.x) * 0.95, y: e.y + (e.y - S.y) * 0.95 }
    return { S, E: e, W: w2, seen: ok(E) }
  }
  // left / right turn of the body from the pose model's depth of the shoulders (farther side: larger z). Rough; limited to +-35 degrees.
  const yaw = Math.max(-0.6, Math.min(0.6, Math.atan2((sr.z || 0) - (sl.z || 0), Math.hypot(sr.x - sl.x, sr.y - sl.y)) * 0.7))
  return { sl, sr, hl, hr, sw, ux: B.ux, dn, aL: arm(Li, -1), aR: arm(Ri, 1), yaw, hipsSeen }
}

// Builds the mesh once per garment: grid points (uv) and the triangles that cover garment pixels.
export function garmentMesh(geo, alpha, cols = 30, rows = 40) {
  const { w, h } = geo, uv = [], idx = []
  const x0 = 0, x1 = w - 1, y0 = Math.max(0, geo.top - 2), y1 = geo.bot
  for (let r = 0; r <= rows; r++) for (let c = 0; c <= cols; c++) uv.push(x0 + (x1 - x0) * c / cols, y0 + (y1 - y0) * r / rows)
  const has = (gx, gy) => { for (let dy = 0; dy <= 4; dy++) for (let dx = 0; dx <= 4; dx++) { const i = Math.round(gx + dx / 4 * (x1 - x0) / cols), j = Math.round(gy + dy / 4 * (y1 - y0) / rows); if (i >= 0 && j >= 0 && i < w && j < h && alpha[j * w + i] > 8) return true } return false }
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    if (!has(x0 + (x1 - x0) * c / cols, y0 + (y1 - y0) * r / rows)) continue
    const a = r * (cols + 1) + c, b = a + 1, d = a + cols + 1, e = d + 1
    idx.push(a, b, d, b, e, d)
  }
  return { uv: new Float32Array(uv), idx: new Uint16Array(idx), n: uv.length / 2 }
}

// Screen positions (xy), the body "turn" angle per point (for shading: cylinder normal) and how much the point belongs to the
// torso above the hips (clipping to your outline applies there) for every mesh point.
// st: the product's sliders { v (size), dy, len }
export function warpMesh(geo, mesh, body, st = {}) {
  const { sw, sl, sr, hl, hr, yaw } = body
  const outer = sw * 1.2 * (0.8 + (st.v ?? 0.5) * 0.4) // outside of the shoulders (the pose points sit on the shoulder joints)
  const k = outer / 2 / geo.shHalf, kv = k / Math.cos(yaw) * (st.len || 1) // garment px -> screen px (height does not shrink when you turn)
  // body centre line from the shoulders to the hips, and its across direction (shoulder line at the top, hip line at the hips)
  const SM = { x: (sl.x + sr.x) / 2, y: (sl.y + sr.y) / 2 }, HM = { x: (hl.x + hr.x) / 2, y: (hl.y + hr.y) / 2 }
  const torsoLen = Math.hypot(HM.x - SM.x, HM.y - SM.y), axis = { x: (HM.x - SM.x) / torsoLen, y: (HM.y - SM.y) / torsoLen }
  const acrossS = { x: (sr.x - sl.x) / Math.hypot(sr.x - sl.x, sr.y - sl.y), y: (sr.y - sl.y) / Math.hypot(sr.x - sl.x, sr.y - sl.y) }
  const hlen = Math.hypot(hr.x - hl.x, hr.y - hl.y) || 1, acrossH = { x: (hr.x - hl.x) / hlen, y: (hr.y - hl.y) / hlen }
  const hipHalf = Math.max(0.42 * sw, 0.5 * hlen * 1.55) * 1.04, shHalfB = outer / 2 // outside of the hips (hip points are joint centres), + ease
  const topY = geo.sh - (st.dy || 0) * sw / kv, collarLift = sw * 0.05 // the garment's shoulder row sits a little above the shoulder joints
  const bodyHalf = (t) => (t <= 0 ? shHalfB : t < 1 ? lerp(shHalfB, hipHalf, t) * (1 - 0.1 * Math.sin(Math.PI * Math.min(1, t * 1.15))) : hipHalf) // narrower at the waist
  const cosY = Math.cos(yaw), sinY = Math.sin(yaw)
  const out = new Float32Array(mesh.n * 2), turn = new Float32Array(mesh.n), clip = new Float32Array(mesh.n)
  // torso mapping of one garment point -> { x, y, th (turn angle, for shading), t (0 shoulders .. 1 hips) }
  const torso = (gx, gy) => {
    const row = Math.max(geo.top, Math.min(geo.bot, Math.round(gy)))
    const down = (gy - topY) * kv - collarLift, t = down / torsoLen // screen px below the shoulder line; 0 at the shoulders, 1 at the hips
    const tc = Math.max(0, Math.min(1.6, t)), C = { x: SM.x + axis.x * down, y: SM.y + axis.y * down }
    const ac = t <= 0 ? acrossS : t >= 1 ? acrossH : { x: lerp(acrossS.x, acrossH.x, t), y: lerp(acrossS.y, acrossH.y, t) }
    // half width here: half way between the garment's own (scaled) width and your body's width (below the hips the garment keeps
    // more of its own shape, so a skirt or a long loose top stays as it is)
    const fit = t < 1 ? 0.5 : lerp(0.5, 0.2, Math.min(1, (t - 1) / 0.4))
    const gHalf = Math.max(1, geo.prof[row]), half = lerp(gHalf * k, bodyHalf(tc) * cosY, fit)
    const u = (gx - geo.cen[row]) / gHalf // -1..1 across the torso panel at this row
    // turned cylinder: u = +-1 are the sides; the middle of the garment moves toward the far side when you turn
    const uc = Math.max(-1, Math.min(1, u)), th = uc * Math.PI / 2 * 0.94
    let f = Math.sin(th + yaw) / cosY; if (u > 1) f += (u - 1) * 0.8; else if (u < -1) f += (u + 1) * 0.8
    return { x: C.x + ac.x * half * f, y: C.y + ac.y * half * f, th: th + yaw, t }
  }
  // sleeve bone chain: the garment sleeve turns about the garment's shoulder point, to the direction of your upper arm; past the
  // elbow the rest turns with the forearm (blended over the elbow)
  const chain = (sg, a) => {
    const So = torso(sg.S.x, sg.S.y), up = { x: a.E.x - a.S.x, y: a.E.y - a.S.y }, Lu = Math.hypot(up.x, up.y) || sw, fo = { x: a.W.x - a.E.x, y: a.W.y - a.E.y }
    return { So, up, Lu, r1: ang(up) - ang(sg.dir), r2: ang(fo) - ang(sg.dir) }
  }
  const chains = [geo.sl && chain(geo.sl, body.aL), geo.sr && chain(geo.sr, body.aR)]
  const sleeveMap = (sg, c, gx, gy, wS) => {
    // near the seam the sleeve turns only part of the way (angle x weight): the fabric between shoulder and sleeve bends instead of tearing
    const v = { x: gx - sg.S.x, y: gy - sg.S.y }, d = (v.x * sg.dir.x + v.y * sg.dir.y) * k
    const r1 = Math.atan2(Math.sin(c.r1), Math.cos(c.r1)) * wS, p1 = rot(v, r1), P1 = { x: c.So.x + p1.x * k, y: c.So.y + p1.y * k }
    if (d <= c.Lu * 0.85) return P1
    const vE = { x: v.x - sg.dir.x * c.Lu / k, y: v.y - sg.dir.y * c.Lu / k }, p2 = rot(vE, r1 + Math.atan2(Math.sin(c.r2 - c.r1), Math.cos(c.r2 - c.r1)) * wS)
    const ue = rot({ x: sg.dir.x * c.Lu, y: sg.dir.y * c.Lu }, r1), P2 = { x: c.So.x + ue.x + p2.x * k, y: c.So.y + ue.y + p2.y * k }, b = smooth(c.Lu * 0.85, c.Lu * 1.15, d)
    return { x: lerp(P1.x, P2.x, b), y: lerp(P1.y, P2.y, b) }
  }
  for (let n = 0; n < mesh.n; n++) {
    const gx = mesh.uv[n * 2], gy = mesh.uv[n * 2 + 1], row = Math.max(geo.top, Math.min(geo.bot, Math.round(gy)))
    const T = torso(gx, gy); let x = T.x, y = T.y
    turn[n] = T.th; clip[n] = 1 - smooth(1.0, 1.25, T.t)
    // sleeves: points outside the torso panel above the armpit follow the arm, blended in over the seam
    ;[[geo.sl, chains[0], -1], [geo.sr, chains[1], 1]].forEach(([sg, c, side]) => {
      if (!sg) return
      const outside = side * (gx - geo.cen[row]) - geo.prof[row], wS = smooth(-geo.shHalf * 0.12, geo.shHalf * 0.3, outside) * (1 - smooth(geo.pit, geo.pit + (geo.bot - geo.top) * 0.08, gy))
      if (wS <= 0) return
      const p = sleeveMap(sg, c, gx, gy, wS); x = lerp(x, p.x, wS); y = lerp(y, p.y, wS); turn[n] = lerp(turn[n], side * 1.2, wS)
    })
    out[n * 2] = x; out[n * 2 + 1] = y
  }
  return { pos: out, turn, clip, k }
}
