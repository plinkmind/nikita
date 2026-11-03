// Live outfit = YOUR OWN GARMENT PHOTO placed on your body. The real fabric, print and colours of the photo are kept, but it is NOT bent around
// your body and it is NOT an AI try-on. (The flat drawn garments were removed: they looked cartoonish.) For a realistic result use "AI Photo".
const sh = (n, c) => ({ n, c })
export const OUTFITS = [
  { id: 'o-custom', label: 'My clothing photo', v: 0.5, shades: [sh('As uploaded', '#ffffff')], need: 'pose', excl: 'custom', upload: true,
    ranges: [{ k: 'dy', label: 'Move up / down', min: -0.5, max: 0.5, def: 0 }, { k: 'len', label: 'Length', min: 0.6, max: 1.5, def: 1 }] },
]
export const OUTFIT_IDS = new Set(OUTFITS.map((p) => p.id))

// body geometry from the 33 pose points (canvas pixels). Shoulders are required; hips and elbows are estimated if they are out of frame.
export function bodyFrom(P) {
  if (!P || !(P[11]?.v > 0.5 && P[12]?.v > 0.5)) return null
  let l = P[11], r = P[12]; if (l.x > r.x) [l, r] = [r, l]
  const sw = Math.hypot(r.x - l.x, r.y - l.y); if (sw < 20) return null
  const ux = { x: (r.x - l.x) / sw, y: (r.y - l.y) / sw }, n = { x: -ux.y, y: ux.x }, mid = { x: (l.x + r.x) / 2, y: (l.y + r.y) / 2 }
  const ok = (p) => p && p.v > 0.5
  const hl = ok(P[23]) && ok(P[24]), torso = hl ? Math.hypot((P[23].x + P[24].x) / 2 - mid.x, (P[23].y + P[24].y) / 2 - mid.y) / sw : 1.3
  const arm = (s, e) => (ok(e) ? { x: (e.x - s.x) / sw, y: (e.y - s.y) / sw } : null) // upper arm vector in shoulder-width units
  const L = P[11].x <= P[12].x ? [P[11], P[13], P[15]] : [P[12], P[14], P[16]], R = P[11].x <= P[12].x ? [P[12], P[14], P[16]] : [P[11], P[13], P[15]]
  return { l, r, sw, ux, n, mid, torso: Math.max(0.9, Math.min(1.8, torso)), armL: arm(l, L[1]), armR: arm(r, R[1]), foreL: ok(L[1]) && ok(L[2]) ? { x: (L[2].x - L[1].x) / sw, y: (L[2].y - L[1].y) / sw } : null, foreR: ok(R[1]) && ok(R[2]) ? { x: (R[2].x - R[1].x) / sw, y: (R[2].y - R[1].y) / sw } : null }
}

// The garment photo is mapped onto the body with two stretches: the top follows the shoulder line (width and tilt), the bottom follows the hips
// (or the estimated torso length), so it is narrower at the waist when the body is. The photo is assumed to be a front view.
function drawCustom(c, B, st, img) {
  if (!img) return
  // size from the garment's OWN shoulder width (measured in the photo when it was loaded), so a T-shirt photo with sleeves
  // spread and a sleeveless dress both end up with their shoulders on your shoulders. Body-model shoulder points sit on the
  // shoulder joints, so the outside of the shoulders is about 1.2x wider.
  const shoulderFrac = Math.max(0.3, Math.min(1, img.shoulderFrac || 0.6))
  const w = (B.sw * 1.2 * (0.8 + st.v * 0.4)) / shoulderFrac, top = -B.sw * (img.collarFrac != null ? 0.08 : 0.14) - (img.collarFrac || 0) * (w * img.height / img.width) + (st.dy || 0) * B.sw
  const h = (w * img.height) / img.width * (st.len || 1)
  const slices = 12 // draw in horizontal slices so the width can change from shoulders (wide) to waist (narrower)
  c.save(); c.translate(B.mid.x, B.mid.y); c.rotate(Math.atan2(B.ux.y, B.ux.x))
  c.imageSmoothingQuality = 'high'
  for (let i = 0; i < slices; i++) {
    const t0 = i / slices, t1 = (i + 1) / slices, f = 1 - 0.1 * Math.sin(Math.min(1, (t0 + t1) / 2 * 1.4) * Math.PI / 2) // up to 10% narrower toward the waist
    const sy = t0 * img.height, sh2 = (t1 - t0) * img.height, dw = w * f
    c.drawImage(img, 0, sy, img.width, sh2 + 0.5, -dw / 2, top + t0 * h, dw, h * (t1 - t0) + 0.6)
  }
  c.restore()
}

// The garment is drawn on its own layer, then (1) the real light and fold shading of your body is blended into it (soft-light),
// so it does not look like a flat sticker, and (2) forearms and hands that are IN FRONT of the body (closer to the camera than
// the shoulders, from the body model's depth) are put back on top, so the garment does not cover an arm crossing the chest.
let layer = null, gmask = null
export function drawOutfit(c, B, state, customImg, T, raw, pose, M) {
  if (!B || !state['o-custom'] || !customImg) return
  layer = layer || document.createElement('canvas'); if (layer.width !== c.canvas.width || layer.height !== c.canvas.height) { layer.width = c.canvas.width; layer.height = c.canvas.height }
  const L = layer.getContext('2d'); L.clearRect(0, 0, layer.width, layer.height)
  drawCustom(L, B, state['o-custom'], customImg)
  if (raw) {
    // your real light and fold shading, blended into the garment's own colours (soft-light), then cut back to the garment shape
    gmask = gmask || document.createElement('canvas'); if (gmask.width !== layer.width || gmask.height !== layer.height) { gmask.width = layer.width; gmask.height = layer.height }
    const G = gmask.getContext('2d'); G.clearRect(0, 0, gmask.width, gmask.height); G.drawImage(layer, 0, 0)
    L.save(); L.globalCompositeOperation = 'soft-light'; L.globalAlpha = 0.45; L.drawImage(raw, 0, 0); L.globalAlpha = 1; L.globalCompositeOperation = 'destination-in'; L.drawImage(gmask, 0, 0); L.restore()
  }
  // a garment can never cover the face or anything above the jaw line (protects against a wrong body reading)
  if (M) {
    const P = M.P, jaw = [234, 93, 132, 58, 172, 136, 150, 149, 176, 148, 152, 377, 400, 378, 379, 365, 397, 288, 361, 323, 454].map((i) => P[i])
    const far = Math.max(layer.width, layer.height) * 3, ux = -M.up.x * far, uy = -M.up.y * far // "up" direction, far away
    L.save(); L.globalCompositeOperation = 'destination-out'; L.beginPath(); L.moveTo(jaw[0].x - ux, jaw[0].y - uy)
    jaw.forEach((q) => L.lineTo(q.x, q.y)); L.lineTo(jaw[jaw.length - 1].x - ux, jaw[jaw.length - 1].y - uy); L.closePath(); L.fill(); L.restore()
  }
  c.drawImage(layer, 0, 0)
  if (raw && pose) {
    const sz = (pose[11].z + pose[12].z) / 2
    ;[[13, 15, 19], [14, 16, 20]].forEach(([e, w, hi]) => { // elbow -> wrist -> hand
      const E = pose[e], Wr = pose[w], Hd = pose[hi]
      if (!(E.v > 0.5 && Wr.v > 0.5) || Wr.z > sz - B.sw * 0.15) return // only forearms clearly in front of the shoulders
      const path = new Path2D(); path.moveTo(E.x, E.y); path.lineTo(Wr.x, Wr.y); if (Hd.v > 0.3) path.lineTo(Hd.x, Hd.y)
      c.drawImage(armMask(c.canvas, path, B.sw * 0.2, raw), 0, 0)
    })
  }
}
let am = null
function armMask(ref, path, width, raw) { // the real camera picture, cut to a thick rounded stroke along the forearm
  am = am || document.createElement('canvas'); if (am.width !== ref.width || am.height !== ref.height) { am.width = ref.width; am.height = ref.height }
  const x = am.getContext('2d'); x.clearRect(0, 0, am.width, am.height)
  x.lineCap = 'round'; x.lineJoin = 'round'; x.lineWidth = width; x.strokeStyle = '#000'; x.stroke(path)
  x.globalCompositeOperation = 'source-in'; x.drawImage(raw, 0, 0); x.globalCompositeOperation = 'source-over'
  return am
}

// ---- clothing photo preparation: size limit, plain-background removal, trim ----
export function prepGarment(img) {
  const k = Math.min(1, 900 / Math.max(img.width, img.height)), w0 = Math.max(1, Math.round(img.width * k)), h0 = Math.max(1, Math.round(img.height * k))
  const c0 = document.createElement('canvas'); c0.width = w0; c0.height = h0
  const x0c = c0.getContext('2d', { willReadFrequently: true }); x0c.drawImage(img, 0, 0, w0, h0)
  // 1. strip screenshot bars / frames: uniform lines along an edge that differ from what is next to them (max 8% per side)
  const all = x0c.getImageData(0, 0, w0, h0).data, at = (i, j) => (j * w0 + i) * 4
  const lineStat = (horiz, n) => { let s = 0, s2 = 0, m = horiz ? w0 : h0; for (let t = 0; t < m; t++) { const o = horiz ? at(t, n) : at(n, t), v = (all[o] + all[o + 1] + all[o + 2]) / 3; s += v; s2 += v * v } const mean = s / m; return { mean, sd: Math.sqrt(Math.max(0, s2 / m - mean * mean)) } }
  const strip = (horiz, from, dir, lim) => { let n = from; while (Math.abs(n - from) < lim) { const a = lineStat(horiz, n), b = lineStat(horiz, n + dir * 3); if (a.sd < 12 && Math.abs(a.mean - b.mean) > 25) n += dir; else break } return n }
  const t = strip(true, 0, 1, h0 * 0.08), b = strip(true, h0 - 1, -1, h0 * 0.08), l = strip(false, 0, 1, w0 * 0.08), r = strip(false, w0 - 1, -1, w0 * 0.08)
  const w = Math.max(1, r - l + 1), h = Math.max(1, b - t + 1)
  const cv = document.createElement('canvas'); cv.width = w; cv.height = h
  const x = cv.getContext('2d', { willReadFrequently: true }); x.drawImage(c0, l, t, w, h, 0, 0, w, h)
  const d = x.getImageData(0, 0, w, h), px = d.data, idx = (i, j) => (j * w + i) * 4
  // 2. plain background = the colour most of the border has (median); two-tone (a saved "transparent" checkerboard) supported
  const border = []; for (let i = 0; i < w; i += 2) { border.push(idx(i, 0), idx(i, h - 1)) } for (let j = 0; j < h; j += 2) { border.push(idx(0, j), idx(w - 1, j)) }
  const med = (ch) => { const v = border.map((o) => px[o + ch]).sort((p, q) => p - q); return v[v.length >> 1] }
  const bg = [med(0), med(1), med(2)], d1 = (o, c) => Math.hypot(px[o] - c[0], px[o + 1] - c[1], px[o + 2] - c[2])
  const far2 = border.filter((o) => d1(o, bg) >= 45), bg2 = far2.length > border.length * 0.2 ? [0, 1, 2].map((ch) => { const v = far2.map((o) => px[o + ch]).sort((p, q) => p - q); return v[v.length >> 1] }) : null
  const colourless = (c) => Math.max(...c) - Math.min(...c) < 25
  const dist = (o) => (bg2 && colourless(bg) && colourless(bg2) ? Math.min(d1(o, bg), d1(o, bg2)) : d1(o, bg))
  const near = border.map(dist).filter((v) => v < 45), plain = near.length / border.length > 0.6 && border.every((o) => px[o + 3] > 200)
  // tolerance follows how uniform the background really is: a clean white studio background gets a tight tolerance (so a white
  // garment is not eaten into), a two-tone checkerboard or a slightly uneven backdrop gets a looser one
  const spread = near.length ? Math.sqrt(near.reduce((q, v) => q + v * v, 0) / near.length) : 0, tol = Math.max(14, Math.min(46, spread * 2.5 + 10))
  let removed = 0
  if (plain) { // flood the background away from the edges (a garment in the middle is never touched)
    const seen = new Uint8Array(w * h), st = []
    // the fill also stops at any local edge (a step bigger than edgeTol between neighbours), so a white garment on a white
    // background keeps its faint outline and is not eaten into
    const edgeTol = Math.max(7, spread * 1.6), step = (a, b2) => Math.abs(px[a] - px[b2]) + Math.abs(px[a + 1] - px[b2 + 1]) + Math.abs(px[a + 2] - px[b2 + 2])
    const push = (i, j, from) => { if (i < 0 || j < 0 || i >= w || j >= h) return; const o = j * w + i; if (seen[o] || dist(o * 4) >= tol) return; if (from >= 0 && step(o * 4, from * 4) > edgeTol) return; seen[o] = 1; st.push(o) }
    for (let i = 0; i < w; i++) { push(i, 0, -1); push(i, h - 1, -1) } for (let j = 0; j < h; j++) { push(0, j, -1); push(w - 1, j, -1) }
    while (st.length) { const o = st.pop(), i = o % w, j = (o / w) | 0; px[o * 4 + 3] = 0; removed++; push(i + 1, j, o); push(i - 1, j, o); push(i, j + 1, o); push(i, j - 1, o) }
    // keep only the biggest piece (drops logos, icons and specks left on the background)
    if (removed) {
      const lab = new Int32Array(w * h), sizes = [0]; let best = 0
      for (let o0 = 0; o0 < w * h; o0++) {
        if (lab[o0] || !px[o0 * 4 + 3]) continue
        const id = sizes.length, q = [o0]; lab[o0] = id; let n = 0
        while (q.length) { const o = q.pop(), i = o % w; n++; for (const nb of [i + 1 < w ? o + 1 : -1, i > 0 ? o - 1 : -1, o + w < w * h ? o + w : -1, o - w >= 0 ? o - w : -1]) if (nb >= 0 && !lab[nb] && px[nb * 4 + 3]) { lab[nb] = id; q.push(nb) } }
        sizes.push(n); if (n > sizes[best]) best = id
      }
      for (let o = 0; o < w * h; o++) if (px[o * 4 + 3] && lab[o] !== best) px[o * 4 + 3] = 0
    }
    if (removed > w * h * 0.93) { removed = 0; for (let o = 3; o < px.length; o += 4) px[o] = 255; x.drawImage(c0, l, t, w, h, 0, 0, w, h) } // would remove almost everything: keep the original
    else {
      for (let j = 1; j < h - 1; j++) for (let i = 1; i < w - 1; i++) { const o = idx(i, j); if (px[o + 3] && (!px[o - 1] || !px[o + 7] || !px[o - w * 4 + 3] || !px[o + w * 4 + 3])) px[o + 3] = 140 } // soften the cut edge
      x.putImageData(d, 0, 0)
    }
  }
  // 3. trim empty edges
  let a0 = w, b0 = h, a1 = 0, b1 = 0
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) if (px[idx(i, j) + 3] > 20) { if (i < a0) a0 = i; if (i > a1) a1 = i; if (j < b0) b0 = j; if (j > b1) b1 = j }
  if (a1 <= a0 || b1 <= b0) return { canvas: cv, cleaned: false }
  const out = document.createElement('canvas'); out.width = a1 - a0 + 1; out.height = b1 - b0 + 1
  out.getContext('2d').drawImage(cv, a0, b0, out.width, out.height, 0, 0, out.width, out.height)
  // 4. measure the garment's top (first row at least 30% as wide as the garment: skips a hanger or a hook above it) and its
  //    shoulder width a little below that, for sizing on the body
  if (removed) {
    const od = out.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, out.width, out.height).data
    const rowWidth = (j) => { let lo = -1, hi = -1; for (let i = 0; i < out.width; i++) if (od[(j * out.width + i) * 4 + 3] > 100) { if (lo < 0) lo = i; hi = i } return lo < 0 ? 0 : hi - lo }
    let top0 = 0; while (top0 < out.height * 0.4 && rowWidth(top0) < out.width * 0.3) top0++
    const sh = Math.min(out.height - 1, top0 + Math.round(out.height * 0.05))
    out.shoulderFrac = [sh - 2, sh, sh + 2].map(rowWidth).sort((p, q) => p - q)[1] / out.width
    out.collarFrac = top0 / out.height
  }
  return { canvas: out, cleaned: removed > 0 }
}
