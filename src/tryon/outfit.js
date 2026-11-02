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
  const w = B.sw * (1.5 + st.v * 0.5), top = -B.sw * 0.14 + (st.dy || 0) * B.sw
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

export function drawOutfit(c, B, state, customImg) {
  if (!B || !state['o-custom']) return
  drawCustom(c, B, state['o-custom'], customImg)
}

// ---- clothing photo preparation: size limit, plain-background removal, trim ----
export function prepGarment(img) {
  const k = Math.min(1, 900 / Math.max(img.width, img.height)), w = Math.max(1, Math.round(img.width * k)), h = Math.max(1, Math.round(img.height * k))
  const cv = document.createElement('canvas'); cv.width = w; cv.height = h
  const x = cv.getContext('2d', { willReadFrequently: true }); x.drawImage(img, 0, 0, w, h)
  const d = x.getImageData(0, 0, w, h), px = d.data, idx = (i, j) => (j * w + i) * 4
  const corner = [[0, 0], [w - 1, 0], [0, h - 1], [w - 1, h - 1]].map(([i, j]) => px.slice(idx(i, j), idx(i, j) + 4))
  const bg = [0, 1, 2].map((ch) => corner.reduce((s, q) => s + q[ch], 0) / 4)
  const same = corner.every((q) => Math.hypot(q[0] - bg[0], q[1] - bg[1], q[2] - bg[2]) < 40)
  let removed = 0
  if (same && corner.every((q) => q[3] > 200)) { // plain background on all 4 corners: flood it away from the edges
    const seen = new Uint8Array(w * h), st = []
    const near = (p) => Math.hypot(px[p] - bg[0], px[p + 1] - bg[1], px[p + 2] - bg[2]) < 46
    const push = (i, j) => { if (i < 0 || j < 0 || i >= w || j >= h) return; const o = j * w + i; if (seen[o] || !near(o * 4)) return; seen[o] = 1; st.push(o) }
    for (let i = 0; i < w; i++) { push(i, 0); push(i, h - 1) } for (let j = 0; j < h; j++) { push(0, j); push(w - 1, j) }
    while (st.length) { const o = st.pop(), i = o % w, j = (o / w) | 0; px[o * 4 + 3] = 0; removed++; push(i + 1, j); push(i - 1, j); push(i, j + 1); push(i, j - 1) }
    if (removed > w * h * 0.93) { return { canvas: cv, cleaned: false } } // would remove almost everything: keep the original
    x.putImageData(d, 0, 0)
  }
  let x0 = w, y0 = h, x1 = 0, y1 = 0 // trim empty edges
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) if (px[idx(i, j) + 3] > 20) { if (i < x0) x0 = i; if (i > x1) x1 = i; if (j < y0) y0 = j; if (j > y1) y1 = j }
  if (x1 <= x0 || y1 <= y0) return { canvas: cv, cleaned: false }
  const out = document.createElement('canvas'); out.width = x1 - x0 + 1; out.height = y1 - y0 + 1
  out.getContext('2d').drawImage(cv, x0, y0, out.width, out.height, 0, 0, out.width, out.height)
  return { canvas: out, cleaned: removed > 0 }
}
