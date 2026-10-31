// Hair try-on. Two separate things:
//  1. HAIRSTYLES: stylised 2D hair shapes drawn from the tracked head (position, size, tilt and turn). They are illustrations,
//     NOT realistic hair replacement, and the person's own hair stays visible wherever the new style does not cover it.
//  2. HAIR COLOURS: recolours the person's REAL hair using a hair-segmentation mask (the model marks which pixels are hair).
const sh = (n, c) => ({ n, c })
const HAIR_SHADES = [sh('Black', '#14110F'), sh('Dark brown', '#3B2418'), sh('Chestnut', '#6B3E26'), sh('Auburn', '#8B3A1F'), sh('Honey blonde', '#C9A25B'), sh('Platinum', '#E6DCC3'), sh('Burgundy', '#5A0F2A'), sh('Copper', '#B5582B'), sh('Ash grey', '#9AA0A6'), sh('Rose pink', '#D9708F'), sh('Midnight blue', '#1C2B5A')]
const style = (id, label, extra = {}) => ({ id, label, v: 0.5, shades: HAIR_SHADES.slice(0, 8), excl: 'hairstyle', need: 'face', noSize: true, ...extra })
export const HAIR = [
  style('h-short', 'Short hair'), style('h-bob', 'Bob cut'), style('h-long', 'Long straight'), style('h-layers', 'Layered'),
  style('h-wavy', 'Long wavy'), style('h-curly', 'Curly'),
  style('h-bangs', 'Bangs', { excl: 'bangs' }),
  { id: 'haircolor', label: 'Hair colour', v: 0.8, shades: HAIR_SHADES, excl: 'haircolor', need: 'seg' },
]
export const HAIR_STYLE_IDS = HAIR.filter((p) => p.id.startsWith('h-') && p.id !== 'h-bangs').map((p) => p.id)

const rgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16))
const mix = (a, b, t) => { const x = rgb(a), y = rgb(b); return `rgb(${x.map((v, i) => Math.round(v + (y[i] - v) * t)).join(',')})` }
export const FACE_OVAL = [10, 338, 297, 332, 284, 251, 389, 356, 454, 323, 361, 288, 397, 365, 379, 378, 400, 377, 152, 148, 176, 149, 150, 136, 172, 58, 132, 93, 234, 127, 162, 21, 54, 103, 67, 109]

// outline of each style in head units (x: across, +-1 = face edge; y: 0 = middle of face, -1 = hairline, +1 = chin; 1 unit = half face height)
function shape(id, a) {
  const crown = { 'h-short': 0.34, 'h-bob': 0.4, 'h-long': 0.4, 'h-layers': 0.46, 'h-wavy': 0.46, 'h-curly': 0.7 }[id]
  const side = { 'h-short': 1.12, 'h-bob': 1.28, 'h-long': 1.22, 'h-layers': 1.24, 'h-wavy': 1.3, 'h-curly': 1.7 }[id]
  const hem = { 'h-short': 0.05, 'h-bob': 1.1, 'h-long': 3.0, 'h-layers': 2.5, 'h-wavy': 2.8, 'h-curly': 1.9 }[id]
  const wave = id === 'h-wavy' ? 0.07 : id === 'h-curly' ? 0.12 : 0
  const yc = -0.1, yt = -1 - crown // yc = where the sides start curving into the dome of the head
  const half = (s) => { // one side, from the bottom of the hair up and over the top of the head
    const p = []
    for (let i = 0; i <= 10; i++) { // hanging part: hem -> temple
      const t = i / 10, y = hem + (yc - hem) * t
      let x = a * side * (1 + (id === 'h-bob' ? -0.1 : 0.05) * (1 - t))
      x += wave * a * Math.sin(t * 14 + (s > 0 ? 0 : 2)) * (1 - t)
      if (id === 'h-layers') x -= a * 0.14 * ((i % 3) / 2) * (1 - t) // stepped ends
      p.push({ x: s * x, y })
    }
    for (let i = 1; i <= 10; i++) { const t = i / 10; p.push({ x: s * Math.max(0.02, a * side * Math.sqrt(Math.max(0, 1 - t * t))), y: yc + (yt - yc) * t }) } // dome
    return p
  }
  const pts = half(-1).concat(half(1).reverse())
  if (hem > 0.8) pts.push({ x: a * side * 0.55, y: hem + 0.1 }, { x: 0, y: hem + 0.15 }, { x: -a * side * 0.55, y: hem + 0.1 }) // softly rounded bottom edge
  return pts
}

function smooth(c, pts) {
  c.beginPath(); c.moveTo(pts[0].x, pts[0].y)
  for (let i = 1; i < pts.length - 1; i++) { const m = { x: (pts[i].x + pts[i + 1].x) / 2, y: (pts[i].y + pts[i + 1].y) / 2 }; c.quadraticCurveTo(pts[i].x, pts[i].y, m.x, m.y) }
  c.lineTo(pts[pts.length - 1].x, pts[pts.length - 1].y); c.closePath()
}

// draws the chosen hairstyle behind the face (the studio puts the real face back on top afterwards)
export function drawHairStyle(c, M, state, T) {
  const id = HAIR_STYLE_IDS.find((k) => state[k]); if (!id) return
  const col = HAIR.find((p) => p.id === id).shades[state[id].shade].c
  const { P, fh, fw, roll } = M, cx = (P[10].x + P[152].x) / 2, cy = (P[10].y + P[152].y) / 2, u = fh / 2 // u = half face height in pixels
  const pts = shape(id, fw / 2 / u).map((p) => ({ x: p.x * u + M.yaw * fw * 0.3, y: p.y * u }))
  c.save(); c.translate(cx, cy); c.rotate(roll)
  smooth(c, pts)
  const top = Math.min(...pts.map((p) => p.y)), bot = Math.max(...pts.map((p) => p.y))
  const g = c.createLinearGradient(0, top, 0, bot); g.addColorStop(0, mix(col, '#000000', 0.35)); g.addColorStop(0.3, col); g.addColorStop(1, mix(col, '#000000', 0.15))
  c.fillStyle = g; c.fill()
  c.save(); c.clip() // strands and shine, kept inside the hair shape
  const curly = id === 'h-curly', wavy = id === 'h-wavy'
  for (let i = 0; i < 26; i++) {
    const t = i / 25, x0 = (t - 0.5) * fw * 0.5, x1 = (t - 0.5) * fw * 1.5
    c.beginPath(); c.moveTo(x0, top + u * 0.1)
    c.bezierCurveTo(x0 + (curly ? 8 : 0) * Math.sin(i), top + (bot - top) * 0.3, x1 + (wavy ? u * 0.15 * Math.sin(i + T * 0.3) : 0), top + (bot - top) * 0.6, x1 * 1.05, bot)
    c.strokeStyle = i % 2 ? 'rgba(255,255,255,.07)' : 'rgba(0,0,0,.14)'; c.lineWidth = Math.max(1, u * 0.012); c.stroke()
  }
  const sh2 = c.createLinearGradient(-fw * 0.6, 0, fw * 0.6, 0); sh2.addColorStop(0.2, 'rgba(255,255,255,0)'); sh2.addColorStop(0.35, 'rgba(255,255,255,.16)'); sh2.addColorStop(0.5, 'rgba(255,255,255,0)')
  c.fillStyle = sh2; c.fillRect(-fw, top, fw * 2, (bot - top) * 0.55)
  c.restore(); c.restore()
}

// bangs are drawn in FRONT of the forehead
export function drawBangs(c, M, state) {
  if (!state['h-bangs']) return
  const own = HAIR.find((p) => p.id === 'h-bangs'), st = state['h-bangs']
  const sty = HAIR_STYLE_IDS.find((k) => state[k]), col = (sty ? HAIR.find((p) => p.id === sty).shades[state[sty].shade] : own.shades[st.shade]).c
  const { P, fh, fw, roll } = M, cx = (P[10].x + P[152].x) / 2, cy = (P[10].y + P[152].y) / 2, u = fh / 2, a = fw / 2
  const brow = ((P[105].y + P[334].y) / 2 - cy) / u // eyebrow height in head units (about -0.4)
  c.save(); c.translate(cx, cy); c.rotate(roll)
  const yb = (brow - 0.1) * u, yt = -u * 1.12, x = a * 1.02 + M.yaw * fw * 0.3
  c.beginPath(); c.moveTo(-x, yt + u * 0.2)
  c.quadraticCurveTo(-x * 1.05, yt - u * 0.15, 0, yt - u * 0.2); c.quadraticCurveTo(x * 1.05, yt - u * 0.15, x, yt + u * 0.2)
  c.quadraticCurveTo(x * 0.95, yb, x * 0.45, yb + u * 0.04); c.quadraticCurveTo(x * 0.1, yb - u * 0.1, 0, yb + u * 0.03) // curtain parting in the middle
  c.quadraticCurveTo(-x * 0.1, yb - u * 0.1, -x * 0.45, yb + u * 0.04); c.quadraticCurveTo(-x * 0.95, yb, -x, yt + u * 0.2); c.closePath()
  const g = c.createLinearGradient(0, yt, 0, yb); g.addColorStop(0, mix(col, '#000000', 0.3)); g.addColorStop(1, col); c.fillStyle = g; c.fill()
  c.clip(); for (let i = 0; i < 18; i++) { const px = (i / 17 - 0.5) * x * 2; c.beginPath(); c.moveTo(px * 0.3, yt); c.lineTo(px, yb); c.strokeStyle = i % 2 ? 'rgba(255,255,255,.08)' : 'rgba(0,0,0,.16)'; c.lineWidth = Math.max(1, u * 0.012); c.stroke() }
  c.restore()
}

// ---- hair colour (segmentation) ----
// `mask` = hair-alpha canvas built from the segmentation model; it is tinted and blended so the real hair keeps its light and shadow.
export function buildHairMask(data, mw, mh, canvas) {
  canvas.width = mw; canvas.height = mh
  const ctx = canvas.getContext('2d'), img = ctx.createImageData(mw, mh)
  for (let i = 0; i < data.length; i++) { img.data[i * 4 + 3] = data[i] === 1 ? 255 : 0 } // class 1 = hair
  ctx.putImageData(img, 0, 0)
}
export function drawHairColour(c, mask, tint, state, w, h) {
  const st = state.haircolor; if (!st || !mask.width) return
  const col = HAIR.find((p) => p.id === 'haircolor').shades[st.shade].c, [r, g, b] = rgb(col), lum = (0.3 * r + 0.59 * g + 0.11 * b) / 255
  tint.width = mask.width; tint.height = mask.height
  const t = tint.getContext('2d'); t.globalCompositeOperation = 'source-over'; t.fillStyle = col; t.fillRect(0, 0, tint.width, tint.height)
  t.globalCompositeOperation = 'destination-in'; t.drawImage(mask, 0, 0)
  c.save(); c.globalAlpha = st.v; c.globalCompositeOperation = 'color'; c.drawImage(tint, 0, 0, w, h)
  if (lum > 0.55) { c.globalAlpha = st.v * 0.7; c.globalCompositeOperation = 'soft-light'; c.drawImage(tint, 0, 0, w, h) } // lift dark hair toward light colours
  if (lum < 0.2) { c.globalAlpha = st.v * 0.6; c.globalCompositeOperation = 'multiply'; c.drawImage(tint, 0, 0, w, h) }
  c.restore()
}
