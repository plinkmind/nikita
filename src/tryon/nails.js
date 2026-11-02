// Nail try-on.
// Tracking: MediaPipe Hand Landmarker gives, per hand, 21 points in the picture AND the same 21 points in real-world metres
// (worldLandmarks). From the 3D points we compute, for EACH finger:
//   - the direction of the last finger bone (where the nail lies),
//   - the nail's own surface normal (which way the nail faces), so a nail turned away from the camera fades out instead of
//     being painted on the finger pad, and the thumb (whose nail faces sideways) is handled separately,
//   - the nail width from the real finger width (knuckle spacing), so it does not shrink when the finger points at the camera.
// The nail plate is drawn as a perspective-aware shape (an affine map of the nail outline: along the finger bone in the
// picture, across along the projected 3D width axis), so it narrows when the finger rolls and shortens when it tilts.
// Rendering: polish is filled inside a feathered nail mask, then the REAL nail's light and shade from the camera picture
// is blended back in (soft-light), so the colour sits on the nail instead of floating as a flat sticker. Nothing is drawn
// outside the mask, so colour cannot spill onto the skin.
// Limitation: there is no nail-segmentation model in MediaPipe; the nail outline is estimated from finger geometry.
const sh = (n, c) => ({ n, c })
const OPTS = [
  { k: 'shape', label: 'Nail shape', values: [['square', 'Square'], ['round', 'Round'], ['almond', 'Almond'], ['coffin', 'Coffin'], ['stiletto', 'Stiletto']] },
  { k: 'finish', label: 'Finish', values: [['gloss', 'Glossy'], ['matte', 'Matte']] },
  { k: 'show', label: 'Show nails', values: [['auto', 'Nails facing the camera'], ['always', 'Always']] },
]
const D = { shape: 'round', finish: 'gloss', show: 'auto' }
const nail = (id, label, shades) => ({ id, label, v: 0.9, shades, opts: OPTS, defaults: D, excl: 'nails', need: 'hand' })
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

// [dip, tip, width factor] per finger: thumb, index, middle, ring, little
const FINGERS = [[3, 4, 1.22], [7, 8, 1.0], [11, 12, 1.04], [15, 16, 0.96], [19, 20, 0.8]]
const EXTRA = { square: 0.06, round: 0.04, almond: 0.24, coffin: 0.22, stiletto: 0.4 } // free edge beyond the fingertip (nail lengths)

const v3 = (p) => [p.x, p.y, p.z]
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const norm = (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l] }
const len3 = (a) => Math.hypot(a[0], a[1], a[2])
// rotates v by the smallest rotation that turns unit vector a into unit vector b (Rodrigues)
function rotateBetween(v, a, b) {
  const k = cross(a, b), sn = Math.hypot(k[0], k[1], k[2]), cs = dot(a, b); if (sn < 1e-6) return v
  const ax = k.map((x) => x / sn), kv = cross(ax, v), kd = dot(ax, v)
  return [0, 1, 2].map((i) => v[i] * cs + kv[i] * sn + ax[i] * kd * (1 - cs))
}
const smooth = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t) }

// Geometry for one hand. hd = { P: 21 picture points (camera pixels, NOT mirrored), Wd: 21 world points (metres), right: true hand }
// Returns, per finger, the nail placement in camera pixels: base point, along vector, across vector and visibility.
export function nailGeometry(hd) {
  const { P, Wd } = hd, W = Wd.map(v3)
  // weak-perspective scale: picture pixels per metre (from the spread of all 21 points)
  let pc = [0, 0], wc = [0, 0]; P.forEach((p, i) => { pc[0] += p.x / 21; pc[1] += p.y / 21; wc[0] += W[i][0] / 21; wc[1] += W[i][1] / 21 })
  let a = 0, b = 0; P.forEach((p, i) => { a += (p.x - pc[0]) ** 2 + (p.y - pc[1]) ** 2; b += (W[i][0] - wc[0]) ** 2 + (W[i][1] - wc[1]) ** 2 })
  const s = Math.sqrt(a / (b || 1e-9))
  // back-of-hand direction from (index knuckle - wrist) x (little knuckle - wrist), signed by the true handedness.
  // The sign was checked against real photos (tests/harness.js "nails"): with it, nails that are visible in the photo are
  // the ones marked visible (open fingertips, thumb), and nails tucked into a fist are hidden.
  const k0 = norm(cross(sub(W[5], W[0]), sub(W[17], W[0]))), dorsal = hd.right ? k0 : k0.map((v) => -v)
  const toPinky = norm(sub(W[17], W[5]))
  const knuckle = (len3(sub(W[9], W[5])) + len3(sub(W[13], W[9])) + len3(sub(W[17], W[13]))) / 3 // ~ finger width
  // Each nail's facing direction is CARRIED ALONG THE FINGER joint by joint ("parallel transport"): start from the back-of-hand
  // direction on the knuckle bone and rotate it by exactly the bend of every joint. This stays correct when a finger curls past
  // 90 degrees (in a fist the nails are tucked away and must NOT be painted on the knuckles).
  const chains = [[1, 2, 3, 4], [5, 6, 7, 8], [9, 10, 11, 12], [13, 14, 15, 16], [17, 18, 19, 20]]
  return FINGERS.map(([d, t, wf], f) => {
    const ch = chains[f], u = norm(sub(W[t], W[d])), Ld = len3(sub(W[t], W[d]))
    let dir = norm(sub(W[ch[0]], W[0]))
    const start = f === 0 ? [dorsal[0] * 0.5 - toPinky[0], dorsal[1] * 0.5 - toPinky[1], dorsal[2] * 0.5 - toPinky[2]] : dorsal // thumb nail faces the index side
    let n = norm(sub(start, dir.map((v) => v * dot(start, dir))))
    for (let k = 0; k < 3; k++) { const nd = norm(sub(W[ch[k + 1]], W[ch[k]])); n = rotateBetween(n, dir, nd); dir = nd }
    n = norm(sub(n, u.map((v) => v * dot(n, u))))
    const across = norm(cross(n, u)) // nail width direction (3D)
    const facing = -n[2] // > 0: the nail faces the camera
    const width = knuckle * 0.6 * wf
    const thick = knuckle * 0.08 // the nail sits on the top surface of the finger, above the bone line between the joints
    const lift = [n[0] * thick * s, n[1] * thick * s]
    const pd = P[d], pt = P[t]
    const at = (k) => ({ x: pd.x + (pt.x - pd.x) * k + lift[0], y: pd.y + (pt.y - pd.y) * k + lift[1] })
    const base = at(0.36), tip = at(1.0)
    return { f, base, along: { x: tip.x - base.x, y: tip.y - base.y }, across: { x: across[0] * width * s, y: across[1] * width * s }, facing, vis: smooth(0.12, 0.4, facing), Ld }
  })
}

// nail outline in unit coordinates: x from -0.5 to 0.5 (across), y from 0 (cuticle) to 1 + extra (free edge)
function outline(c, shape) {
  const L = 1 + (EXTRA[shape] ?? 0.1), r = 0.22
  c.beginPath(); c.moveTo(-0.5, r)
  c.bezierCurveTo(-0.5, 0.02, -0.25, -0.03, 0, -0.03); c.bezierCurveTo(0.25, -0.03, 0.5, 0.02, 0.5, r) // curved cuticle
  if (shape === 'square') { c.lineTo(0.5, L - 0.06); c.quadraticCurveTo(0.5, L, 0.44, L); c.lineTo(-0.44, L); c.quadraticCurveTo(-0.5, L, -0.5, L - 0.06) }
  else if (shape === 'round') { c.lineTo(0.5, L - 0.3); c.bezierCurveTo(0.5, L + 0.02, -0.5, L + 0.02, -0.5, L - 0.3) }
  else if (shape === 'almond') { c.lineTo(0.5, L * 0.62); c.quadraticCurveTo(0.44, L * 0.9, 0.08, L); c.quadraticCurveTo(0, L * 1.01, -0.08, L); c.quadraticCurveTo(-0.44, L * 0.9, -0.5, L * 0.62) }
  else if (shape === 'coffin') { c.lineTo(0.5, L * 0.66); c.lineTo(0.27, L); c.lineTo(-0.27, L); c.lineTo(-0.5, L * 0.66) }
  else { c.lineTo(0.5, L * 0.55); c.quadraticCurveTo(0.36, L * 0.86, 0, L); c.quadraticCurveTo(-0.36, L * 0.86, -0.5, L * 0.55) } // stiletto
  c.closePath()
  return L
}

const rgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16))
const mix = (a, b, t) => { const x = rgb(a), y = rgb(b); return `rgb(${x.map((v, i) => Math.round(v + (y[i] - v) * t)).join(',')})` }

// the polish design, painted in unit nail coordinates (already clipped to the outline)
function design(c, id, col, L, seed, T) {
  if (id === 'np-french') {
    c.fillStyle = 'rgb(240,206,196)'; c.fillRect(-1, -1, 2, L + 2) // sheer pink base
    c.fillStyle = col; c.beginPath(); c.moveTo(-0.6, L * 0.74); c.quadraticCurveTo(0, L * 0.56, 0.6, L * 0.74); c.lineTo(0.6, L + 1); c.lineTo(-0.6, L + 1); c.fill() // smile line
  } else if (id === 'np-ombre') {
    const g = c.createLinearGradient(0, 0, 0, L); g.addColorStop(0.1, col); g.addColorStop(1, mix(col, '#ffffff', 0.85)); c.fillStyle = g; c.fillRect(-1, -1, 2, L + 2)
  } else if (id === 'np-chrome') {
    const g = c.createLinearGradient(-0.5, 0, 0.5, L * 0.4); g.addColorStop(0, mix(col, '#000000', 0.45)); g.addColorStop(0.42, mix(col, '#ffffff', 0.75)); g.addColorStop(0.62, col); g.addColorStop(1, mix(col, '#000000', 0.35)); c.fillStyle = g; c.fillRect(-1, -1, 2, L + 2)
  } else { c.fillStyle = col; c.fillRect(-1, -1, 2, L + 2) }
  if (id === 'np-glitter') { // fine glitter, fixed per nail, a few flakes catch the light over time
    let s = seed * 9301 + 49297; const rnd = () => { s = (s * 9301 + 49297) % 233280; return s / 233280 }
    for (let i = 0; i < 70; i++) {
      const x = rnd() - 0.5, y = rnd() * L, r = 0.012 + rnd() * 0.025, tw = 0.25 + 0.75 * Math.max(0, Math.sin(T * 2.4 + i * 2.3 + seed))
      c.fillStyle = i % 3 ? mix(col, '#ffffff', 0.55) : `rgba(255,255,255,${tw})`; c.fillRect(x - r, y - r, r * 2, r * 2)
    }
  }
}

let layer = null, mask = null
const canvasLike = (ref, cv) => { cv = cv || document.createElement('canvas'); if (cv.width !== ref.width || cv.height !== ref.height) { cv.width = ref.width; cv.height = ref.height } return cv }

// hands: [{ P, Wd, right, alpha }] (camera pixels, not mirrored). raw: the mirrored camera picture. mirror: selfie view.
export function drawNails(c, hands, state, T, raw, mirror) {
  const id = [...NAIL_IDS].find((k) => state[k]); if (!id || !hands.length) return
  const st = state[id], col = NAILS.find((p) => p.id === id).shades[st.shade].c, W = c.canvas.width
  layer = canvasLike(c.canvas, layer); mask = canvasLike(c.canvas, mask)
  const Lx = layer.getContext('2d'), Mx = mask.getContext('2d')
  Lx.clearRect(0, 0, layer.width, layer.height); Mx.clearRect(0, 0, mask.width, mask.height)
  let any = false
  hands.forEach((hd, hi) => {
    nailGeometry(hd).forEach((g) => {
      const len = Math.hypot(g.along.x, g.along.y), wid = Math.hypot(g.across.x, g.across.y); if (len < 3 || wid < 2) return
      const edgeOn = smooth(0.32, 0.55, wid / len) // a nail seen almost edge-on is a thin sliver: fade it rather than draw a red line
      const vis = (st.show === 'always' ? 1 : g.vis * edgeOn) * (hd.alpha ?? 1); if (vis < 0.02) return
      any = true
      // camera pixels -> what is shown (mirrored for the selfie view)
      const ox = mirror ? W - g.base.x : g.base.x, ax = mirror ? -g.across.x : g.across.x, yx = mirror ? -g.along.x : g.along.x
      const m = [ax, g.across.y, yx, g.along.y, ox, g.base.y]
      for (const [ctx, paint] of [[Mx, false], [Lx, true]]) {
        ctx.save(); ctx.transform(...m); ctx.globalAlpha = paint ? vis : 1
        const L = outline(ctx, st.shape)
        if (!paint) { ctx.fillStyle = '#fff'; ctx.fill() }
        else {
          ctx.save(); ctx.clip(); design(ctx, id, col, L, hi * 7 + g.f + 1, T)
          if (st.finish === 'gloss') { // specular streak along the curved nail + darker side walls (the nail is a curved plate)
            const hl = ctx.createLinearGradient(-0.5, 0, 0.5, 0)
            hl.addColorStop(0, 'rgba(0,0,0,.22)'); hl.addColorStop(0.18, 'rgba(0,0,0,0)'); hl.addColorStop(0.3, 'rgba(255,255,255,.0)'); hl.addColorStop(0.36, 'rgba(255,255,255,.5)'); hl.addColorStop(0.44, 'rgba(255,255,255,0)'); hl.addColorStop(0.82, 'rgba(0,0,0,0)'); hl.addColorStop(1, 'rgba(0,0,0,.25)')
            ctx.fillStyle = hl; ctx.fillRect(-0.5, 0.1, 1, L - 0.2)
          } else { const sd = ctx.createLinearGradient(-0.5, 0, 0.5, 0); sd.addColorStop(0, 'rgba(0,0,0,.18)'); sd.addColorStop(0.25, 'rgba(0,0,0,0)'); sd.addColorStop(0.75, 'rgba(0,0,0,0)'); sd.addColorStop(1, 'rgba(0,0,0,.2)'); ctx.fillStyle = sd; ctx.fillRect(-0.5, 0, 1, L) }
          ctx.restore()
        }
        ctx.restore()
      }
    })
  })
  if (!any) return
  // real light and shade of the finger, blended into the polish (keeps it looking like it sits on the nail)
  if (raw) { Lx.save(); Lx.globalCompositeOperation = 'soft-light'; Lx.globalAlpha = 0.55; Lx.drawImage(raw, 0, 0); Lx.restore() }
  // keep only what is inside the (slightly feathered) nail mask: no spill onto the skin
  Lx.save(); Lx.globalCompositeOperation = 'destination-in'; Lx.filter = 'blur(0.6px)'; Lx.drawImage(mask, 0, 0); Lx.filter = 'none'; Lx.restore()
  c.save(); c.globalAlpha = 0.55 + 0.45 * st.v; c.drawImage(layer, 0, 0); c.restore()
}
