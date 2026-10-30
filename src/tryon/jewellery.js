// Jewellery renderer: drawn as metal + gems, anchored to face landmarks and head roll / turn.
const sh = (n, c) => ({ n, c })
const METALS = [sh('Gold', '#E2BE7C'), sh('Rose gold', '#E0A596'), sh('Silver', '#D5DAE3')]
export const JEWELLERY = [
  { id: 'earrings', label: 'Earrings', v: 0.5, shades: METALS },
  { id: 'studs', label: 'Studs', v: 0.5, shades: METALS },
  { id: 'hoops', label: 'Hoops', v: 0.5, shades: METALS },
  { id: 'jhumkas', label: 'Jhumkas', v: 0.5, shades: METALS },
  { id: 'necklace', label: 'Necklace', v: 0.5, shades: METALS },
  { id: 'chain', label: 'Chain', v: 0.5, shades: METALS },
  { id: 'pendant', label: 'Pendant', v: 0.5, shades: METALS },
  { id: 'nosering', label: 'Nose Ring', v: 0.5, shades: METALS },
  { id: 'nosepin', label: 'Nose Pin', v: 0.5, shades: METALS },
  { id: 'tiara', label: 'Tiara', v: 0.5, shades: METALS },
]

const rgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16))
const mix = (a, b, t) => { const x = rgb(a), y = rgb(b); return `rgb(${x.map((v, i) => Math.round(v + (y[i] - v) * t)).join(',')})` }
const metal = (c, col, r) => { const g = c.createLinearGradient(-r, -r, r, r); g.addColorStop(0, mix(col, '#000000', 0.35)); g.addColorStop(0.45, mix(col, '#ffffff', 0.6)); g.addColorStop(1, mix(col, '#000000', 0.2)); return g }
const circle = (c, x, y, r, fill) => { c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2); c.fillStyle = fill; c.fill() }

function gem(c, x, y, r, T, tint = '#ffffff') {
  const g = c.createRadialGradient(x - r * 0.3, y - r * 0.3, r * 0.1, x, y, r)
  g.addColorStop(0, '#ffffff'); g.addColorStop(0.6, tint); g.addColorStop(1, mix('#ffffff', '#6a7a9a', 0.5))
  circle(c, x, y, r, g)
  const s = (0.5 + 0.5 * Math.sin(T * 3 + x * 0.05)) * r * 2.2 // twinkle
  c.save(); c.strokeStyle = 'rgba(255,255,255,.85)'; c.lineWidth = Math.max(1, r * 0.12)
  c.beginPath(); c.moveTo(x - s, y); c.lineTo(x + s, y); c.moveTo(x, y - s); c.lineTo(x, y + s); c.stroke(); c.restore()
}
function bezel(c, col, x, y, r, T, tint) { circle(c, x, y, r * 1.35, metal(c, col, r)); gem(c, x, y, r, T, tint) }
const quad = (a, b, k, t) => ({ x: (1 - t) * (1 - t) * a.x + 2 * (1 - t) * t * k.x + t * t * b.x, y: (1 - t) * (1 - t) * a.y + 2 * (1 - t) * t * k.y + t * t * b.y })

// draw in local coordinates: origin at (x,y), rotated with the head
const at = (c, x, y, rot, fn) => { c.save(); c.translate(x, y); c.rotate(rot); fn(); c.restore() }

const EARS = (M) => [[234, 132], [454, 361]].map(([e, j]) => {
  const P = M.P, lobe = { x: P[e].x + (P[j].x - P[e].x) * 0.38, y: P[e].y + (P[j].y - P[e].y) * 0.38 }
  const sx = Math.sign(lobe.x - P[1].x) || 1
  lobe.x += sx * M.fw * 0.012
  return { lobe, sx, hidden: sx * M.yaw > 0.14 } // ear on the far side of a turned head is hidden
})

const ear = {
  studs: (c, u, col, T) => bezel(c, col, 0, u * 0.02, u * 0.022, T),
  earrings: (c, u, col, T) => {
    bezel(c, col, 0, u * 0.02, u * 0.016, T)
    c.strokeStyle = metal(c, col, u * 0.1); c.lineWidth = u * 0.007; c.beginPath(); c.moveTo(0, u * 0.03); c.lineTo(0, u * 0.1); c.stroke()
    c.beginPath(); c.moveTo(0, u * 0.09); c.bezierCurveTo(u * 0.05, u * 0.14, u * 0.035, u * 0.2, 0, u * 0.22); c.bezierCurveTo(-u * 0.035, u * 0.2, -u * 0.05, u * 0.14, 0, u * 0.09)
    c.fillStyle = metal(c, col, u * 0.1); c.fill(); gem(c, 0, u * 0.15, u * 0.026, T, '#cfe8ff')
  },
  hoops: (c, u, col, T, M) => {
    const k = 1 - Math.min(0.6, Math.abs(M.yaw) * 1.8)
    c.beginPath(); c.ellipse(0, u * 0.09, u * 0.065 * k, u * 0.09, 0, 0, Math.PI * 2)
    c.lineWidth = u * 0.016; c.strokeStyle = metal(c, col, u * 0.1); c.stroke()
    circle(c, 0, u * 0.005, u * 0.012, metal(c, col, u * 0.02))
  },
  jhumkas: (c, u, col, T) => {
    bezel(c, col, 0, u * 0.015, u * 0.016, T, '#ffd9e6')
    const w = u * 0.06, y0 = u * 0.045, y1 = u * 0.125
    c.beginPath(); c.moveTo(-w, y1); c.bezierCurveTo(-w, y0 - u * 0.03, w, y0 - u * 0.03, w, y1)
    for (let i = 0; i < 6; i++) c.arc(w - (i + 0.5) * (w / 3), y1, w / 6, 0, Math.PI)
    c.closePath(); c.fillStyle = metal(c, col, u * 0.1); c.fill(); c.strokeStyle = mix(col, '#000000', 0.4); c.lineWidth = 1; c.stroke()
    for (let i = -1; i <= 1; i++) circle(c, i * w * 0.45, y0 + u * 0.025 + Math.abs(i) * u * 0.008, u * 0.008, mix(col, '#ffffff', 0.8))
    for (let i = -2; i <= 2; i++) circle(c, i * w * 0.33, y1 + w / 6 + u * 0.012, u * 0.011, mix('#ffffff', '#ffe9ef', 0.4))
    circle(c, 0, y1 + u * 0.06, u * 0.016, '#fff4f6')
  },
}

const nose = (c, M, id, col, u, T) => {
  const P = M.P, a = P[129], sx = Math.sign(a.x - P[1].x) || 1
  if (sx * M.yaw > 0.16) return
  at(c, a.x + sx * u * 0.004, a.y + u * 0.006, M.roll, () => {
    if (id === 'nosepin') bezel(c, col, 0, 0, u * 0.011, T)
    else { c.beginPath(); c.arc(sx * u * 0.012, u * 0.022, u * 0.032, -Math.PI * 0.45, Math.PI * 1.25); c.lineWidth = u * 0.009; c.strokeStyle = metal(c, col, u * 0.05); c.stroke() }
  })
}

function neck(c, M, id, col, u, T) {
  const { P, fw, fh, roll } = M, ch = P[152]
  at(c, ch.x, ch.y, roll, () => {
    const A = { x: -fw * 0.46, y: fh * 0.16 }, B = { x: fw * 0.46, y: fh * 0.16 }
    const K = { x: 0, y: fh * (id === 'chain' || id === 'pendant' ? 1.18 : 0.78) }
    if (id === 'necklace') { // beaded necklace with a centre gem
      for (let t = 0; t <= 1.001; t += 0.035) { const p = quad(A, B, K, t); circle(c, p.x, p.y, u * 0.016, metal(c, col, u * 0.02)) }
      const m = quad(A, B, K, 0.5); bezel(c, col, m.x, m.y + u * 0.02, u * 0.028, T, '#ffd9e6')
    } else { // chain, with a pendant when asked
      c.beginPath(); c.moveTo(A.x, A.y); c.quadraticCurveTo(K.x, K.y, B.x, B.y)
      c.lineWidth = u * 0.008; c.strokeStyle = metal(c, col, u * 0.5); c.stroke()
      c.setLineDash([u * 0.012, u * 0.008]); c.lineWidth = u * 0.004; c.strokeStyle = mix(col, '#ffffff', 0.7); c.stroke(); c.setLineDash([])
      if (id === 'pendant') {
        const m = quad(A, B, K, 0.5)
        circle(c, m.x, m.y, u * 0.01, metal(c, col, u * 0.02))
        c.beginPath(); c.moveTo(m.x, m.y); c.bezierCurveTo(m.x + u * 0.07, m.y + u * 0.06, m.x + u * 0.05, m.y + u * 0.14, m.x, m.y + u * 0.17); c.bezierCurveTo(m.x - u * 0.05, m.y + u * 0.14, m.x - u * 0.07, m.y + u * 0.06, m.x, m.y)
        c.fillStyle = metal(c, col, u * 0.1); c.fill(); gem(c, m.x, m.y + u * 0.085, u * 0.04, T, '#ffb3c8')
      }
    }
  })
}

function tiara(c, M, col, u, T) {
  const { P, up, fh } = M
  const pts = [54, 103, 67, 109, 10, 338, 297, 332, 284].map((i) => ({ x: P[i].x + up.x * fh * 0.04, y: P[i].y + up.y * fh * 0.04 }))
  c.beginPath(); c.moveTo(pts[0].x, pts[0].y); pts.slice(1).forEach((p) => c.lineTo(p.x, p.y))
  c.lineWidth = u * 0.016; c.lineJoin = c.lineCap = 'round'; c.strokeStyle = metal(c, col, u * 0.5); c.stroke()
  pts.forEach((p, i) => {
    if (i % 2) return
    const h = fh * (0.06 + 0.07 * Math.sin((i / (pts.length - 1)) * Math.PI)), tip = { x: p.x + up.x * h, y: p.y + up.y * h }
    const n = { x: -up.y, y: up.x }, w = u * 0.022
    c.beginPath(); c.moveTo(p.x - n.x * w, p.y - n.y * w); c.lineTo(tip.x, tip.y); c.lineTo(p.x + n.x * w, p.y + n.y * w); c.closePath()
    c.fillStyle = metal(c, col, u * 0.1); c.fill(); gem(c, tip.x, tip.y, u * 0.015 + h * 0.06, T, '#ffe3f0')
  })
}

export function drawJewellery(c, M, state, T) {
  const col = (id) => JEWELLERY.find((j) => j.id === id).shades[state[id].shade].c
  const U = (id) => M.fw * (0.6 + state[id].v * 0.8)
  if (state.tiara) tiara(c, M, col('tiara'), U('tiara'), T)
  ;['necklace', 'chain', 'pendant'].forEach((id) => { if (state[id]) neck(c, M, id, col(id), U(id), T) })
  const ears = EARS(M)
  ;['studs', 'earrings', 'hoops', 'jhumkas'].forEach((id) => {
    if (!state[id]) return
    ears.forEach((e) => { if (!e.hidden) at(c, e.lobe.x, e.lobe.y, M.roll, () => ear[id](c, U(id), col(id), T, M)) })
  })
  ;['nosering', 'nosepin'].forEach((id) => { if (state[id]) nose(c, M, id, col(id), U(id), T) })
}
