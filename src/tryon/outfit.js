// Outfit try-on = a BASIC GARMENT OVERLAY, not AI-generated realistic try-on and not cloth simulation.
// A garment shape (or the person's uploaded clothing photo) is fitted to the tracked body: it follows the shoulders (width and tilt),
// the torso (length) and the arms (sleeves). Colours are variants of the same shape.
const sh = (n, c) => ({ n, c })
const COLS = [sh('White', '#F2EFE9'), sh('Black', '#17171A'), sh('Navy', '#1F2F5C'), sh('Red', '#B3202E'), sh('Emerald', '#126B4F'), sh('Blush', '#E9B5BF'), sh('Mustard', '#C99A2E'), sh('Lavender', '#A99BD6')]
const garment = (id, label, o) => ({ id, label, v: 0.5, shades: COLS, need: 'pose', ranges: [{ k: 'dy', label: 'Move up / down', min: -0.4, max: 0.4, def: 0 }], ...o })
export const OUTFITS = [
  garment('o-tee', 'T-shirt', { excl: 'base', g: { sleeve: 0.4, len: 1.25, flare: 0, neck: 'round' } }),
  garment('o-shirt', 'Shirt', { excl: 'base', g: { sleeve: 1, len: 1.4, flare: 0.02, neck: 'collar', buttons: true } }),
  garment('o-top', 'Top', { excl: 'base', g: { sleeve: 0, len: 1.05, flare: 0, neck: 'scoop' } }),
  garment('o-dress', 'Dress', { excl: 'base', g: { sleeve: 0.35, len: 2.9, flare: 0.5, neck: 'v', waist: true } }),
  garment('o-kurti', 'Kurti', { excl: 'base', g: { sleeve: 0.7, len: 2.1, flare: 0.14, neck: 'round', slit: true } }),
  garment('o-party', 'Party dress', { excl: 'base', g: { sleeve: 0, len: 2.8, flare: 0.62, neck: 'sweet', waist: true } }),
  garment('o-jacket', 'Jacket', { excl: 'outer', g: { sleeve: 1, len: 1.35, flare: 0.04, neck: 'open', outer: true } }),
  garment('o-blazer', 'Blazer', { excl: 'outer', g: { sleeve: 1, len: 1.55, flare: 0.05, neck: 'lapel', outer: true } }),
  { id: 'o-custom', label: 'My clothing photo', v: 0.5, shades: [sh('As uploaded', '#ffffff')], need: 'pose', excl: 'custom', upload: true, ranges: [{ k: 'dy', label: 'Move up / down', min: -0.5, max: 0.5, def: 0 }] },
]
export const OUTFIT_IDS = new Set(OUTFITS.map((p) => p.id))

const rgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16))
const mix = (a, b, t) => { const x = rgb(a), y = rgb(b); return `rgb(${x.map((v, i) => Math.round(v + (y[i] - v) * t)).join(',')})` }

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

function drawOne(c, B, p, st, T) {
  const g = p.g, col = p.shades[st.shade].c, k = 0.88 + st.v * 0.24, dy = (st.dy || 0)
  // local coordinates in shoulder-widths: x along the shoulder line, y down the torso; origin = middle of the shoulders
  const X = (x, y) => ({ x: B.mid.x + (B.ux.x * x + B.n.x * (y + dy)) * B.sw, y: B.mid.y + (B.ux.y * x + B.n.y * (y + dy)) * B.sw })
  const half = 0.47 * k, waistY = Math.min(g.len * 0.62, B.torso * 0.78), hemY = g.len * Math.max(0.85, B.torso / 1.3) // a longer torso gives a longer garment
  const hw = half * (g.outer ? 1.08 : 1), waistW = g.waist ? half * 0.78 : half * 0.92, hemW = half * (0.98 + g.flare)
  c.save()
  const grad = c.createLinearGradient(B.mid.x, B.mid.y, X(0, hemY).x, X(0, hemY).y); grad.addColorStop(0, mix(col, '#ffffff', 0.12)); grad.addColorStop(1, mix(col, '#000000', 0.18))
  c.fillStyle = grad; c.strokeStyle = mix(col, '#000000', 0.45); c.lineWidth = Math.max(1, B.sw * 0.008); c.lineJoin = 'round'
  const path = (pts) => { c.beginPath(); pts.forEach((q, i) => (i ? c.lineTo(q.x, q.y) : c.moveTo(q.x, q.y))); c.closePath(); c.fill(); c.stroke() }
  const sideSign = [-1, 1]
  // sleeves (behind the body)
  if (g.sleeve > 0) sideSign.forEach((s) => {
    const arm = s < 0 ? B.armL : B.armR, fore = s < 0 ? B.foreL : B.foreR
    const dir = arm || { x: s * 0.22, y: 0.58 }
    const sp = X(s * 0.5, 0.02), w0 = 0.17, w1 = 0.13
    const path2 = [{ p: sp, w: w0 }]
    const e1 = { x: sp.x + dir.x * B.sw * Math.min(1, g.sleeve / 0.7 > 1 ? 1 : g.sleeve / 0.7), y: sp.y + dir.y * B.sw * Math.min(1, g.sleeve / 0.7 > 1 ? 1 : g.sleeve / 0.7) }
    path2.push({ p: e1, w: w1 })
    if (g.sleeve > 0.7 && fore) { const f = Math.min(1, (g.sleeve - 0.7) / 0.3); path2.push({ p: { x: e1.x + fore.x * B.sw * f, y: e1.y + fore.y * B.sw * f }, w: 0.11 }) }
    else if (g.sleeve > 0.7) { path2.push({ p: { x: e1.x + dir.x * B.sw * 0.9, y: e1.y + dir.y * B.sw * 0.9 }, w: 0.11 }) }
    const left = [], right = []
    path2.forEach((q, i) => { const a = path2[Math.max(0, i - 1)].p, b = path2[Math.min(path2.length - 1, i + 1)].p, dx = b.x - a.x, dyy = b.y - a.y, d = Math.hypot(dx, dyy) || 1, nx = -dyy / d, ny = dx / d; left.push({ x: q.p.x + nx * q.w * B.sw * k, y: q.p.y + ny * q.w * B.sw * k }); right.push({ x: q.p.x - nx * q.w * B.sw * k, y: q.p.y - ny * q.w * B.sw * k }) })
    path(left.concat(right.reverse()))
  })
  // body
  const nk = { round: [0.16, 0.1], scoop: [0.2, 0.17], v: [0.15, 0.24], sweet: [0.22, 0.12], collar: [0.14, 0.06], open: [0.15, 0.04], lapel: [0.14, 0.04] }[g.neck]
  const body = [X(-nk[0], -0.02), X(-hw, 0.02), X(-hw * 0.96, 0.32), X(-waistW, waistY), X(-hemW, hemY), X(hemW, hemY), X(waistW, waistY), X(hw * 0.96, 0.32), X(hw, 0.02), X(nk[0], -0.02), X(0, nk[1]), ]
  path(body)
  // details
  c.strokeStyle = mix(col, '#000000', 0.3); c.lineWidth = Math.max(1, B.sw * 0.006)
  if (g.neck === 'collar' || g.neck === 'lapel') { [-1, 1].forEach((s) => { c.beginPath(); const a = X(s * nk[0], -0.03), b = X(s * 0.06, 0.2), d = X(s * (g.neck === 'lapel' ? 0.2 : 0.11), 0.16); c.moveTo(a.x, a.y); c.lineTo(b.x, b.y); c.lineTo(d.x, d.y); c.closePath(); c.fillStyle = mix(col, '#ffffff', 0.22); c.fill(); c.stroke() }) }
  if (g.buttons || g.outer) { const a = X(0, nk[1]), b = X(0, hemY); c.beginPath(); c.moveTo(a.x, a.y); c.lineTo(b.x, b.y); c.stroke()
    if (g.buttons) for (let i = 1; i < 6; i++) { const q = X(0.015, nk[1] + ((hemY - nk[1]) * i) / 6); c.beginPath(); c.arc(q.x, q.y, B.sw * 0.012, 0, 7); c.fillStyle = mix(col, '#ffffff', 0.5); c.fill() } }
  if (g.waist) { const a = X(-waistW, waistY), b = X(waistW, waistY); c.beginPath(); c.moveTo(a.x, a.y); c.lineTo(b.x, b.y); c.lineWidth = Math.max(2, B.sw * 0.02); c.strokeStyle = mix(col, '#000000', 0.35); c.stroke() }
  c.strokeStyle = 'rgba(255,255,255,.07)'; c.lineWidth = Math.max(1, B.sw * 0.014) // soft folds
  for (let i = -2; i <= 2; i++) { const a = X(i * 0.14, 0.4), b = X(i * 0.2 * (1 + g.flare), hemY); c.beginPath(); c.moveTo(a.x, a.y); c.quadraticCurveTo((a.x + b.x) / 2 + i * 3, (a.y + b.y) / 2, b.x, b.y); c.stroke() }
  if (g.slit) { const a = X(0, hemY - 0.5), b = X(0, hemY); c.beginPath(); c.moveTo(a.x, a.y); c.lineTo(b.x, b.y); c.strokeStyle = mix(col, '#000000', 0.4); c.stroke() }
  c.restore()
}

// the person's own clothing photo, placed on the shoulders and torso (the photo should show the garment flat or on a plain background)
function drawCustom(c, B, st, img) {
  if (!img) return
  const w = B.sw * (1.5 + st.v * 0.5), h = (w * img.height) / img.width
  c.save(); c.translate(B.mid.x, B.mid.y); c.rotate(Math.atan2(B.ux.y, B.ux.x)); c.drawImage(img, -w / 2, -B.sw * 0.14 + (st.dy || 0) * B.sw, w, h); c.restore()
}

export function drawOutfit(c, B, state, customImg, T) {
  if (!B) return
  ;['base', 'outer'].forEach((layer) => { // dresses / tops first, jackets over them
    const p = OUTFITS.find((o) => state[o.id] && o.excl === layer); if (p) drawOne(c, B, p, state[p.id], T)
  })
  if (state['o-custom']) drawCustom(c, B, state['o-custom'], customImg)
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
