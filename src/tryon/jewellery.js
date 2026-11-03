import { earVisibility, earAway, noseVisibility } from './track/head.js'
import { FACE_OVAL } from './hair.js'
import { lightCss } from './render/light.js'
// Jewellery renderer: drawn as metal + gems, anchored to face landmarks and head roll / turn.
const sh = (n, c) => ({ n, c })
// canonical noseR = the person's LEFT nostril (canonical x is image-right in an un-mirrored camera)
const NOSE_SIDE = { k: 'side', label: 'Side', values: [['left', 'Left nostril'], ['right', 'Right nostril']] }
const METALS = [sh('Gold', '#E2BE7C'), sh('Rose gold', '#E0A596'), sh('Silver', '#D5DAE3')]
export const JEWELLERY = [
  { id: 'earrings', label: 'Earrings', v: 0.5, shades: METALS },
  { id: 'studs', label: 'Studs', v: 0.5, shades: METALS },
  { id: 'hoops', label: 'Hoops', v: 0.5, shades: METALS },
  { id: 'jhumkas', label: 'Jhumkas', v: 0.5, shades: METALS },
  { id: 'necklace', label: 'Necklace', v: 0.5, shades: METALS },
  { id: 'chain', label: 'Chain', v: 0.5, shades: METALS },
  { id: 'pendant', label: 'Pendant', v: 0.5, shades: METALS },
  { id: 'nosering', label: 'Nose Ring', v: 0.5, shades: METALS, opts: [NOSE_SIDE], defaults: { side: 'left' } },
  { id: 'nosepin', label: 'Nose Pin', v: 0.5, shades: METALS, opts: [NOSE_SIDE], defaults: { side: 'left' } },
  { id: 'tiara', label: 'Tiara', v: 0.5, shades: METALS },
  // PHOTO jewellery: a real product photo (transparent PNG) placed on the tracked ear lobe / neck at its real size.
  // To add your own: put a transparent PNG in public/products/, then add an entry here and list its id in catalog.js.
  //   kind 'ear':  hook = where the earring hangs from (fractions of the image), hcm = real height in cm
  //   kind 'neck': wcm = real width of the photo in cm, top = how far above the neck base the top of the photo sits (cm)
  // The demo images below came from reference pictures supplied by the site owner. Replace them with photos you have the
  // rights to before the site goes live.
  photo('p-kundan-jhumka', 'Kundan jhumka', '/products/demo/kundan-jhumka.png', { kind: 'ear', hook: [0.5, 0.02], hcm: 5.2 }),
  photo('p-kundan-necklace', 'Kundan necklace', '/products/demo/kundan-necklace.png', { kind: 'neck', wcm: 14.5, top: 3.4 }),
  photo('p-filigree-necklace', 'Gold filigree necklace', '/products/demo/filigree-necklace.png', { kind: 'neck', wcm: 12.5, top: 3.2 }),
  photo('p-gem-necklace', 'Gemstone leaf necklace', '/products/demo/gem-leaf-necklace.png', { kind: 'neck', wcm: 14, top: 5 }),
  // 3D jewellery (render/jewellery3d.js): demo pieces built in code. A real product: same entry with model: '/products/x.glb'
  three('j3-studs', '3D studs', 'ear', 'stud'), three('j3-hoops', '3D hoops', 'ear', 'hoop'), three('j3-jhumkas', '3D jhumkas', 'ear', 'jhumka'),
  three('j3-drops', '3D gem drops', 'ear', 'drop'), three('j3-necklace', '3D pendant necklace', 'neck', 'necklace'),
]
function three(id, label, slot, build, model) { return { id, label, v: 0.5, shades: METALS, three: build, slot, model, excl: slot === 'ear' ? 'ear3d' : 'neck3d', need: slot === 'neck' ? 'face+pose' : 'face' } }
function photo(id, label, src, o) { return { id, label, v: 0.5, image: src, src, shades: [sh('As photographed', '#E2BE7C')], need: o.kind === 'neck' ? 'face+pose' : 'face', excl: o.kind === 'ear' ? 'earring' : undefined, ...o } }
const IMG = {}
const imgOf = (p) => { let i = IMG[p.id]; if (!i) { i = IMG[p.id] = new Image(); i.decoding = 'async'; i.src = (import.meta.env.BASE_URL || '/') + p.src.replace(/^\//, '') } return i.complete && i.naturalWidth ? i : null }
const PHOTO_EARS = () => JEWELLERY.filter((p) => p.src && p.kind === 'ear'), PHOTO_NECKS = () => JEWELLERY.filter((p) => p.src && p.kind === 'neck')
// soft contact shadow under a piece, so it sits on the skin instead of floating
const withShadow = (c, cm, fn) => { c.save(); c.shadowColor = 'rgba(30,18,10,.38)'; c.shadowBlur = Math.max(2, cm * 0.35); c.shadowOffsetY = Math.max(1, cm * 0.12); fn(); c.restore() }

const rgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16))
const mix = (a, b, t) => { const x = rgb(a), y = rgb(b); return `rgb(${x.map((v, i) => Math.round(v + (y[i] - v) * t)).join(',')})` }
// Metal shading follows the estimated room light (render/light.js): the bright side of every piece faces where the light comes
// from. The light direction is in picture space; the drawing context may be rotated (pieces turn with the head), so the
// direction is turned back into the piece's own coordinates first.
let LIGHT = null
export const setJewelleryLight = (L) => { LIGHT = L }
const metal = (c, col, r) => {
  let lx = -0.5, ly = -0.85
  if (LIGHT) { const l = Math.hypot(LIGHT.dir.x, LIGHT.dir.y); if (l > 0.05) { lx = LIGHT.dir.x / l; ly = LIGHT.dir.y / l } }
  const m = c.getTransform(), det = m.a * m.d - m.b * m.c || 1, ux = (m.d * lx - m.c * ly) / det, uy = (-m.b * lx + m.a * ly) / det, ul = Math.hypot(ux, uy) || 1
  const g = c.createLinearGradient((-ux / ul) * r, (-uy / ul) * r, (ux / ul) * r, (uy / ul) * r) // from the shadow side to the lit side
  g.addColorStop(0, mix(col, '#000000', 0.35)); g.addColorStop(0.62, mix(col, '#ffffff', 0.6)); g.addColorStop(1, mix(col, '#ffffff', 0.15)); return g
}
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

// Ears are not part of the face mesh. Each ear lobe is a fixed point on the 3D canonical head (track/head.js ANCHORS), moved
// ONLY by the fitted head transform (position, size, 3D rotation). It is never taken from a nearby landmark, so an earring
// cannot jump to the cheek, mouth or nose. Each ear is handled independently: an ear that turns away behind the head fades
// out (its own visibility), and an ear outside the picture is simply not drawn. Earrings hang under gravity and swing.
const swing = { lobeL: { a: 0, v: 0, x: null, t: 0, vis: 0 }, lobeR: { a: 0, v: 0, x: null, t: 0, vis: 0 } }
export function resetJewellery() { Object.values(swing).forEach((s) => Object.assign(s, { a: 0, v: 0, x: null, vis: 0 })); Object.assign(NF, { w: 0, body: null, rot: 0, t: null, last: null }) }
const EARS = (M, T) => ['lobeL', 'lobeR'].map((name) => {
  const e = M.project(name), s = swing[name], dt = Math.min(0.05, Math.max(0.001, T - s.t))
  const vx = s.x === null ? 0 : (e.x - s.x) / Math.max(0.001, T - s.t)
  const target = Math.max(-0.45, Math.min(0.45, vx / (M.fw3 * 6))) * 0.6 // lean away from the direction of motion
  s.v += (-120 * (s.a - target) - 9 * s.v) * dt; s.a += s.v * dt // damped spring: returns to hanging straight down
  s.x = e.x; s.t = T
  const vis = earVisibility(e.facing) * (e.x > -50 && e.x < M.W + 50 && e.y > -50 && e.y < M.H + 50 ? 1 : 0)
  s.vis += (vis - s.vis) * (1 - Math.exp(-dt * 18)) // smooth fade, never a blink
  return { name, lobe: { x: e.x, y: e.y }, swing: s.a, vis: s.vis, facing: e.facing, away: earAway(e.facing) }
})
// An ear turned away from the camera is BEHIND the face: draw its earring on its own layer and cut the face outline out of it,
// so the part behind the cheek / jaw is hidden and the part hanging below the jaw stays visible (real occlusion, no fade).
let earLayer = null
function earPass(c, M, e, draw) {
  if (e.away < 0.01) { c.save(); c.globalAlpha *= e.vis; draw(c); c.restore(); return }
  earLayer = earLayer || document.createElement('canvas'); if (earLayer.width !== c.canvas.width || earLayer.height !== c.canvas.height) { earLayer.width = c.canvas.width; earLayer.height = c.canvas.height }
  const L = earLayer.getContext('2d'); L.setTransform(1, 0, 0, 1, 0, 0); L.clearRect(0, 0, earLayer.width, earLayer.height)
  draw(L)
  L.save(); L.globalCompositeOperation = 'destination-out'; L.globalAlpha = e.away; L.beginPath()
  FACE_OVAL.forEach((i, k) => (k ? L.lineTo(M.P[i].x, M.P[i].y) : L.moveTo(M.P[i].x, M.P[i].y))); L.closePath(); L.fill(); L.restore()
  c.save(); c.globalAlpha *= e.vis; c.drawImage(earLayer, 0, 0); c.restore()
}

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

// nose pin / ring: on the outer side of the nostril wing (left nostril of the person by default), from the 3D head fit
const nose = (c, M, id, col, u, T, side) => {
  const a = M.project(side), vis = noseVisibility(a.facing); if (vis <= 0.02) return
  const sx = Math.sign(a.x - M.P[1].x) || 1
  c.save(); c.globalAlpha *= vis
  at(c, a.x, a.y, M.roll, () => {
    if (id === 'nosepin') bezel(c, col, 0, 0, u * 0.011, T)
    else { c.beginPath(); c.arc(sx * u * 0.004, u * 0.026, u * 0.03, -Math.PI * 0.5, Math.PI * 1.2); c.lineWidth = u * 0.008; c.strokeStyle = metal(c, col, u * 0.05); c.stroke() }
  })
  c.restore()
}

// Where a necklace sits: the collarbone notch at the base of the neck, which belongs to the BODY, not the head.
//  - Shoulders found by the body model (M.shoulders): 0.2 shoulder-widths above the middle of the shoulder joints, tilted with
//    the shoulder line. Measured on a 3D head scan whose head turns and nods while the body stays still: 0.4 to 1 cm error,
//    where the previous head-based position slid 3 to 5 cm up the throat or sideways.
//  - No shoulders (close-up, body model still loading): estimated from the head, following only half of the head's rotation.
//  - Switching between the two blends over ~0.12 s, so the necklace never jumps when body tracking comes or goes, and a body
//    reading more than 6 cm from the head estimate (a wrong detection) is not used.
const NF = { w: 0, body: null, rot: 0, t: null }
export function neckFrame(M, T) {
  if (NF.t === T && NF.last) return NF.last // once per frame, shared by the 2D and the 3D necklaces
  const dt = NF.t === null ? 1 : Math.min(0.2, Math.max(0, T - NF.t)); NF.t = T
  const head = M.projectPartial ? M.projectPartial('neck', 0.5) : M.project('neck'), S = M.shoulders
  let target = 0
  if (S) {
    const sw = Math.hypot(S.r.x - S.l.x, S.r.y - S.l.y), ux = { x: (S.r.x - S.l.x) / sw, y: (S.r.y - S.l.y) / sw }
    const b = { x: (S.l.x + S.r.x) / 2 + ux.y * 0.2 * sw, y: (S.l.y + S.r.y) / 2 - ux.x * 0.2 * sw }
    if (Math.hypot(b.x - head.x, b.y - head.y) < 6 * M.cm) { target = 1; NF.body = b; NF.rot = Math.atan2(ux.y, ux.x) }
  }
  NF.w += (target - NF.w) * (1 - Math.exp(-dt * 8))
  const w = NF.body ? NF.w : 0, hr = M.roll * 0.35
  return (NF.last = { o: { x: head.x + ((NF.body?.x ?? 0) - head.x) * w, y: head.y + ((NF.body?.y ?? 0) - head.y) * w }, rot: hr + (NF.rot - hr) * w })
}
let NECK = null // this frame's neck frame (computed once, used by every necklace)
function neck(c, M, id, col, u, T) {
  const { fw3: fw } = M, k = u / fw // k = 1 at the default size
  const long = id === 'chain' || id === 'pendant'
  const { o, rot } = NECK
  const A = { x: -fw * 0.36 * k, y: -fw * 0.18 }, B = { x: fw * 0.36 * k, y: -fw * 0.18 }, K = { x: 0, y: fw * (long ? 1.1 : 0.5) * k }
  at(c, o.x, o.y, rot, () => {
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

// necklaces are drawn on their own layer and the face (chin, jaw) is cut out of it, so the chin hides the necklace
// when the head bends down, as in real life
let layer = null
function faceCut(c, M) {
  c.save(); c.globalCompositeOperation = 'destination-out'; c.beginPath()
  FACE_OVAL.forEach((i, k) => (k ? c.lineTo(M.P[i].x, M.P[i].y) : c.moveTo(M.P[i].x, M.P[i].y))); c.closePath(); c.fill(); c.restore()
}
// Everything 2D is drawn on its own layer, then given the colour and brightness of the room light (a warm lamp makes the metal
// warmer, a dim room makes it dimmer), then put on the picture.
let JL = null, JT = null
export function drawJewellery(c0, M, state, T) {
  if (!JEWELLERY.some((j) => state[j.id] && !j.three)) return
  const W = c0.canvas.width, H = c0.canvas.height
  JL = JL || document.createElement('canvas'); if (JL.width !== W || JL.height !== H) { JL.width = W; JL.height = H }
  const c = JL.getContext('2d'); c.clearRect(0, 0, W, H)
  drawJewellery2D(c, M, state, T)
  if (LIGHT?.ok) {
    JT = JT || document.createElement('canvas'); if (JT.width !== W || JT.height !== H) { JT.width = W; JT.height = H }
    const t = JT.getContext('2d'); t.globalCompositeOperation = 'copy'; t.fillStyle = lightCss(LIGHT); t.fillRect(0, 0, W, H); t.globalCompositeOperation = 'destination-in'; t.drawImage(JL, 0, 0); t.globalCompositeOperation = 'source-over'
    c.save(); c.globalCompositeOperation = 'multiply'; c.drawImage(JT, 0, 0); c.restore()
  }
  c0.drawImage(JL, 0, 0)
}
function drawJewellery2D(c, M, state, T) {
  const col = (id) => JEWELLERY.find((j) => j.id === id).shades[state[id].shade].c
  const U = (id) => M.fw3 * (0.6 + state[id].v * 0.8) // true head width (pixels per cm x 15.3 cm): keeps real size when the head turns
  if (state.tiara) tiara(c, M, col('tiara'), U('tiara'), T)
  const necks = ['necklace', 'chain', 'pendant'].filter((id) => state[id])
  if (necks.length || PHOTO_NECKS().some((p) => state[p.id])) {
    NECK = neckFrame(M, T)
    layer = layer || document.createElement('canvas'); if (layer.width !== c.canvas.width || layer.height !== c.canvas.height) { layer.width = c.canvas.width; layer.height = c.canvas.height }
    const L = layer.getContext('2d'); L.clearRect(0, 0, layer.width, layer.height)
    necks.forEach((id) => neck(L, M, id, col(id), U(id), T))
    PHOTO_NECKS().forEach((p) => { if (state[p.id]) photoNeck(L, M, p, state[p.id]) })
    faceCut(L, M)
    c.drawImage(layer, 0, 0)
  }
  const ears = EARS(M, T)
  const drawn = ['studs', 'earrings', 'hoops', 'jhumkas'].filter((id) => state[id]), photos = PHOTO_EARS().filter((p) => state[p.id] && imgOf(p))
  if (drawn.length || photos.length) ears.forEach((e) => {
    if (e.vis <= 0.02) return
    earPass(c, M, e, (x) => {
      drawn.forEach((id) => at(x, e.lobe.x, e.lobe.y, e.swing, () => ear[id](x, U(id), col(id), T, M)))
      photos.forEach((p) => {
        const im = imgOf(p), k = 0.75 + state[p.id].v * 0.5, h = p.hcm * M.cm * k, w = (h * im.naturalWidth) / im.naturalHeight
        at(x, e.lobe.x, e.lobe.y, e.swing, () => withShadow(x, M.cm, () => x.drawImage(im, -w * p.hook[0], -h * p.hook[1], w, h)))
      })
    })
  })
  ;['nosering', 'nosepin'].forEach((id) => { if (state[id]) nose(c, M, id, col(id), U(id), T, state[id].side === 'right' ? 'noseL' : 'noseR') })
}
function photoNeck(c, M, p, st) {
  const im = imgOf(p); if (!im) return
  const { o, rot } = NECK
  const k = 0.8 + st.v * 0.4, w = p.wcm * M.cm * k, h = (w * im.naturalHeight) / im.naturalWidth
  at(c, o.x, o.y, rot, () => withShadow(c, M.cm, () => c.drawImage(im, -w / 2, -p.top * M.cm, w, h)))
}
export const earDebug = (M) => EARS(M, performance.now() / 1000)
