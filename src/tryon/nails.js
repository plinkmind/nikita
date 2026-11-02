// Nail try-on. The hand model gives 21 points per hand; for each finger the nail sits on the last finger bone
// (fingertip point + the joint just below it), so it follows the finger's direction, length and thickness as the hand moves.
const sh = (n, c) => ({ n, c })
const OPTS = [
  { k: 'shape', label: 'Nail shape', values: [['square', 'Square'], ['round', 'Round'], ['almond', 'Almond'], ['coffin', 'Coffin'], ['stiletto', 'Stiletto']] },
  { k: 'finish', label: 'Finish', values: [['gloss', 'Glossy'], ['matte', 'Matte']] },
  { k: 'show', label: 'Show nails', values: [['auto', 'Back of hand only'], ['always', 'Always']] },
]
const D = { shape: 'almond', finish: 'gloss', show: 'auto' }
const nail = (id, label, shades) => ({ id, label, v: 0.85, shades, opts: OPTS, defaults: D, excl: 'nails', need: 'hand' })
export const NAILS = [
  nail('np-nude', 'Nude shades', [sh('Sand', '#E4C3A6'), sh('Beige', '#D9B08C'), sh('Mocha', '#A87B62'), sh('Cocoa', '#6E4A3C')]),
  nail('np-pink', 'Pink shades', [sh('Blush', '#F1B6C0'), sh('Rose', '#E27C9A'), sh('Hot pink', '#E0338A'), sh('Mauve', '#B5738F')]),
  nail('np-red', 'Red shades', [sh('Classic red', '#C8102E'), sh('Cherry', '#9E0F2A'), sh('Coral', '#F0604D'), sh('Wine', '#5E0B22')]),
  nail('np-dark', 'Black & dark', [sh('Black', '#101010'), sh('Navy', '#14213D'), sh('Plum', '#3E1A4D'), sh('Forest', '#12372A')]),
  nail('np-french', 'French manicure', [sh('White tip', '#FFFFFF'), sh('Ivory tip', '#F4EBD6'), sh('Pink tip', '#F7B9C8'), sh('Gold tip', '#E2BE7C')]),
  nail('np-glitter', 'Glitter', [sh('Gold glitter', '#E2BE7C'), sh('Silver glitter', '#D5DAE3'), sh('Rose glitter', '#E8A0B4'), sh('Blue glitter', '#7FB2FF')]),
  nail('np-ombre', 'Ombre', [sh('Pink to white', '#F08FB0'), sh('Red to pink', '#C8102E'), sh('Lilac to white', '#B79CE8'), sh('Nude to cream', '#D9B08C')]),
  nail('np-chrome', 'Chrome / metallic', [sh('Gold', '#E2BE7C'), sh('Silver', '#D5DAE3'), sh('Rose gold', '#E0A596'), sh('Mirror blue', '#9DB8D8')]),
]
export const NAIL_IDS = new Set(NAILS.map((p) => p.id))

// [fingertip, joint below it, width factor] for thumb, index, middle, ring, little finger
const FINGERS = [[4, 3, 1.2], [8, 7, 1.0], [12, 11, 1.02], [16, 15, 0.96], [20, 19, 0.82]]
const EXTRA = { square: 0, round: 0, almond: 0.2, coffin: 0.16, stiletto: 0.34 } // length added beyond the fingertip

const rgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16))
const mix = (a, b, t) => { const x = rgb(a), y = rgb(b); return `rgb(${x.map((v, i) => Math.round(v + (y[i] - v) * t)).join(',')})` }

// nail outline in local units: x across (-w/2..w/2), y from the base (0) to the tip (L)
function outline(c, shape, w, L) {
  const hw = w / 2, r = Math.min(hw * 0.5, L * 0.2)
  c.beginPath(); c.moveTo(-hw, r)
  c.quadraticCurveTo(-hw, 0, -hw + r, 0); c.lineTo(hw - r, 0); c.quadraticCurveTo(hw, 0, hw, r) // rounded base (cuticle)
  if (shape === 'square') { c.lineTo(hw, L - r * 0.3); c.quadraticCurveTo(hw, L, hw - r * 0.3, L); c.lineTo(-hw + r * 0.3, L); c.quadraticCurveTo(-hw, L, -hw, L - r * 0.3) }
  else if (shape === 'round') { c.lineTo(hw, L - hw); c.arc(0, L - hw, hw, 0, Math.PI) }
  else if (shape === 'almond') { c.lineTo(hw, L * 0.55); c.quadraticCurveTo(hw * 0.9, L * 0.82, hw * 0.16, L); c.quadraticCurveTo(0, L * 1.02, -hw * 0.16, L); c.quadraticCurveTo(-hw * 0.9, L * 0.82, -hw, L * 0.55) }
  else if (shape === 'coffin') { c.lineTo(hw, L * 0.6); c.lineTo(hw * 0.55, L); c.lineTo(-hw * 0.55, L); c.lineTo(-hw, L * 0.6) }
  else { c.lineTo(hw, L * 0.5); c.quadraticCurveTo(hw * 0.7, L * 0.8, 0, L); c.quadraticCurveTo(-hw * 0.7, L * 0.8, -hw, L * 0.5) } // stiletto
  c.closePath()
}

// polish picks up the real nail's light and shade: first multiplied into the picture, then laid on top at partial opacity
function fillMix(c, style) {
  const a0 = c.globalAlpha; c.save(); c.fillStyle = style
  c.globalCompositeOperation = 'multiply'; c.globalAlpha = a0 * 0.6; c.fill()
  c.globalCompositeOperation = 'source-over'; c.globalAlpha = a0 * 0.55; c.fill(); c.restore()
}

function paint(c, id, col, st, w, L, seed, T) {
  const hw = w / 2
  if (id === 'np-french') {
    fillMix(c, 'rgb(236,205,190)')
    c.save(); c.clip(); c.fillStyle = col; c.beginPath(); c.ellipse(0, L * 1.02, hw * 1.25, L * 0.3, 0, 0, Math.PI * 2); c.fill(); c.restore()
  } else if (id === 'np-ombre') {
    const g = c.createLinearGradient(0, 0, 0, L); g.addColorStop(0, col); g.addColorStop(1, mix(col, '#ffffff', 0.85)); fillMix(c, g)
  } else if (id === 'np-chrome') {
    const g = c.createLinearGradient(-hw, 0, hw, L); g.addColorStop(0, mix(col, '#000000', 0.35)); g.addColorStop(0.35, mix(col, '#ffffff', 0.7)); g.addColorStop(0.6, col); g.addColorStop(1, mix(col, '#000000', 0.3)); fillMix(c, g)
  } else fillMix(c, col)
  if (id === 'np-glitter') { // fixed sparkle positions per nail (seeded), twinkling over time
    c.save(); c.clip(); let s = seed * 9301 + 49297
    const rnd = () => { s = (s * 9301 + 49297) % 233280; return s / 233280 }
    for (let i = 0; i < 16; i++) {
      const x = (rnd() - 0.5) * w, y = rnd() * L, tw = 0.35 + 0.65 * Math.abs(Math.sin(T * 3 + i * 1.7 + seed)), r = w * (0.025 + rnd() * 0.04)
      c.fillStyle = `rgba(255,255,255,${tw})`; c.fillRect(x - r, y - r, r * 2, r * 2); c.fillStyle = mix(col, '#ffffff', 0.5); c.fillRect(x - r * 0.5, y - r * 0.5, r, r)
    }
    c.restore()
  }
  if (st.finish === 'gloss' && id !== 'np-chrome') { // soft highlight strip + lighter tip shine
    c.save(); c.clip()
    const hl = c.createLinearGradient(-hw, 0, hw, 0); hl.addColorStop(0, 'rgba(255,255,255,0)'); hl.addColorStop(0.28, 'rgba(255,255,255,.55)'); hl.addColorStop(0.45, 'rgba(255,255,255,0)')
    c.fillStyle = hl; c.fillRect(-hw, L * 0.08, w, L * 0.8)
    const sh2 = c.createLinearGradient(0, 0, 0, L); sh2.addColorStop(0, 'rgba(0,0,0,.18)'); sh2.addColorStop(0.35, 'rgba(0,0,0,0)'); c.fillStyle = sh2; c.fillRect(-hw, 0, w, L)
    c.restore()
  }
}

// hands: [{ P: 21 points in canvas pixels, back: true if the back of the hand faces the camera, seed }]
export function drawNails(c, hands, state, T) {
  const id = [...NAIL_IDS].find((k) => state[k]); if (!id) return
  const st = state[id], col = NAILS.find((p) => p.id === id).shades[st.shade].c, alpha = 0.4 + 0.6 * st.v
  hands.forEach((hd, hi) => {
    if (!hd.back && st.show !== 'always') return // polish is only drawn on the back of the hand, where nails really are
    FINGERS.forEach(([t, d, wf], fi) => {
      const A = hd.P[t], B = hd.P[d], len = Math.hypot(A.x - B.x, A.y - B.y), len3 = Math.hypot(A.x - B.x, A.y - B.y, (A.z || 0) - (B.z || 0))
      // perspective: when a finger points toward the camera its picture gets SHORTER (len) but not NARROWER, so the nail length uses the
      // length seen in the picture and the nail width uses the true 3D length. Edge-on fingers (nail not visible) are skipped.
      if (len < 4 || len / (len3 || 1) < 0.3) return
      const ux = (A.x - B.x) / len, uy = (A.y - B.y) / len
      const L = len * 0.68, w = len3 * 0.46 * wf, ext = L * (EXTRA[st.shape] ?? 0.2)
      const bx = A.x + ux * len * 0.06 - ux * L, by = A.y + uy * len * 0.06 - uy * L // base of the nail
      c.save(); c.globalAlpha *= alpha; c.translate(bx, by); c.rotate(Math.atan2(-ux, uy))
      outline(c, st.shape, w, L + ext)
      paint(c, id, col, st, w, L + ext, hi * 5 + fi + 1, T)
      c.restore()
    })
  })
}
