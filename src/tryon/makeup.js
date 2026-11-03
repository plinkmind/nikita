// Makeup renderer: every product is drawn from live face landmarks.
// The landmarks come from the head tracker (track/head.js): the head's rigid motion is followed closely and the expression
// (lips, lids, brows) is smoothed separately, so masks move with the face without shimmering. Lip colour uses the
// lighting-aware tint (render/tint.js) so the real lip texture and shine stay visible. Cheek products fade on the side of the
// face that turns away from the camera (from the 3D head rotation) instead of being painted on a cheek you cannot see.
import { tintRegion, meanLum } from './render/tint.js'
import { rotate } from './track/geometry.js'
import { uv, CM_U, CM_V } from './render/facemesh.js'
const BIG = 6000
const sh = (n, c, m) => ({ n, c, m })

export const MAKEUP = [
  { id: 'primer', label: 'Primer', v: 0.5, shades: [sh('Smoothing', '#ffffff')] },
  { id: 'foundation', label: 'Foundation', v: 0.45, shades: [sh('Fair', '#F3D2B8'), sh('Light', '#E6B999'), sh('Medium', '#CF9A76'), sh('Tan', '#B07A55'), sh('Deep', '#7C4B30')] },
  { id: 'concealer', label: 'Concealer', v: 0.6, shades: [sh('Light', '#F6D9C0'), sh('Medium', '#E7B999'), sh('Deep', '#BF8A67')] },
  { id: 'blush', label: 'Blush', v: 0.45, shades: [sh('Rose', '#E8758A'), sh('Peach', '#F2A084'), sh('Berry', '#B8466A'), sh('Coral', '#F26B5B'), sh('Mauve', '#B97A95')] },
  { id: 'eyeshadow', label: 'Eyeshadow', v: 0.45, shades: [sh('Nude', '#C9A58A', 'multiply'), sh('Pink', '#E39AAE', 'multiply'), sh('Brown', '#7A4B33', 'multiply'), sh('Golden', '#D4A62F', 'source-over'), sh('Purple', '#7C4DA0', 'multiply'), sh('Peach', '#F0A98B', 'multiply'), sh('Smokey', '#2B2530', 'multiply'), sh('Shimmer', '#EBD9C0', 'source-over')] },
  { id: 'eyeliner', label: 'Eyeliner', v: 0.9, shades: [sh('Black', '#0b0b0f'), sh('Brown', '#3a2418'), sh('Navy', '#14213d')] },
  { id: 'mascara', label: 'Mascara', v: 0.9, shades: [sh('Black', '#0b0b0f'), sh('Brown', '#3a2418')] },
  { id: 'brows', label: 'Eyebrows', v: 0.6, shades: [sh('Dark', '#2a1c16'), sh('Brown', '#4a3022'), sh('Auburn', '#6b3a22'), sh('Blonde', '#9a7a52')] },
  { id: 'lipstick', label: 'Lipstick', v: 0.75, shades: [sh('Red', '#B3122E'), sh('Nude', '#C58E7C'), sh('Pink', '#E0508A'), sh('Brown', '#7A4332'), sh('Maroon', '#6E1226'), sh('Coral', '#F0674E')] },
  { id: 'gloss', label: 'Lip Gloss', v: 0.7, shades: [sh('Clear', '#ffffff'), sh('Pink', '#ffc2d6'), sh('Peach', '#ffd0b8')] },
  { id: 'highlighter', label: 'Highlighter', v: 0.6, shades: [sh('Champagne', '#fff0cf'), sh('Pearl', '#ffffff'), sh('Gold', '#ffd98a')] },
]

// MediaPipe face-mesh landmark groups
const OVAL = [10, 338, 297, 332, 284, 251, 389, 356, 454, 323, 361, 288, 397, 365, 379, 378, 400, 377, 152, 148, 176, 149, 150, 136, 172, 58, 132, 93, 234, 127, 162, 21, 54, 103, 67, 109]
const LIPS_OUT = [61, 185, 40, 39, 37, 0, 267, 269, 270, 409, 291, 375, 321, 405, 314, 17, 84, 181, 91, 146]
const LIPS_IN = [78, 191, 80, 81, 82, 13, 312, 311, 310, 415, 308, 324, 318, 402, 317, 14, 87, 178, 88, 95]
const EYES = [
  { up: [33, 246, 161, 160, 159, 158, 157, 173, 133], low: [33, 7, 163, 144, 145, 153, 154, 155, 133], loop: [33, 246, 161, 160, 159, 158, 157, 173, 133, 155, 154, 153, 145, 144, 163, 7], out: 33, inn: 133, lowMid: 145 },
  { up: [263, 466, 388, 387, 386, 385, 384, 398, 362], low: [263, 249, 390, 373, 374, 380, 381, 382, 362], loop: [263, 466, 388, 387, 386, 385, 384, 398, 362, 382, 381, 380, 374, 373, 390, 249], out: 263, inn: 362, lowMid: 374 },
]
const BROWS = [
  { up: [46, 53, 52, 65, 55], low: [70, 63, 105, 66, 107] },
  { up: [276, 283, 282, 295, 285], low: [300, 293, 334, 296, 336] },
]

const d = (a, b) => Math.hypot(a.x - b.x, a.y - b.y)
const lerp = (a, b, t) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t })
const add = (p, v, k) => ({ x: p.x + v.x * k, y: p.y + v.y * k })
const norm = (v) => { const l = Math.hypot(v.x, v.y) || 1; return { x: v.x / l, y: v.y / l } }
const ell = (c, rx, ry, rot) => Array.from({ length: 28 }, (_, i) => {
  const a = (i / 28) * Math.PI * 2, x = Math.cos(a) * rx, y = Math.sin(a) * ry
  return { x: c.x + x * Math.cos(rot) - y * Math.sin(rot), y: c.y + x * Math.sin(rot) + y * Math.cos(rot) }
})
// point at fraction t along a polyline
const along = (pts, t) => { const x = t * (pts.length - 1), i = Math.min(pts.length - 2, Math.floor(x)); return lerp(pts[i], pts[i + 1], x - i) }
// how much of one side of the face (side -1 = canonical left, +1 = right) faces the camera: 1 = fully, 0 = turned away
const sideVis = (M, side) => { if (!M.fit) return 1; const n = rotate(M.fit.R, [side * 0.8, 0, 0.6]); return Math.max(0, Math.min(1, (-n[2] + 0.05) / 0.45)) }
const trace = (c, pts) => { c.moveTo(pts[0].x, pts[0].y); for (let i = 1; i < pts.length; i++) c.lineTo(pts[i].x, pts[i].y); c.closePath() }

// Soft-edged fill. The shape is drawn far off-canvas and only its blurred shadow lands on the image.
function soft(c, shapes, color, blur, alpha, mode = 'source-over', rule = 'nonzero') {
  c.save()
  c.globalAlpha = Math.max(0, Math.min(1, alpha)); c.globalCompositeOperation = mode
  c.shadowColor = color; c.shadowBlur = blur; c.shadowOffsetX = BIG; c.translate(-BIG, 0)
  c.beginPath(); shapes.forEach((s) => trace(c, s)); c.fillStyle = '#000'; c.fill(rule)
  c.restore()
}
function softLine(c, pts, color, width, blur, alpha) {
  c.save()
  c.globalAlpha = alpha; c.shadowColor = color; c.shadowBlur = blur; c.shadowOffsetX = BIG; c.translate(-BIG, 0)
  c.beginPath(); c.moveTo(pts[0].x, pts[0].y); pts.slice(1).forEach((p) => c.lineTo(p.x, p.y))
  c.lineWidth = width; c.lineCap = 'round'; c.lineJoin = 'round'; c.strokeStyle = '#000'; c.stroke()
  c.restore()
}

let tmp = null
const scratch = (W, H, k = 0) => {
  tmp = tmp || [document.createElement('canvas'), document.createElement('canvas'), document.createElement('canvas')]
  const c = tmp[k]; if (c.width !== W || c.height !== H) { c.width = W; c.height = H }
  const x = c.getContext('2d'); x.clearRect(0, 0, W, H); return [c, x]
}

const DRAW = {
  primer(c, M, s, v, raw) { // blurs skin texture inside the face (not eyes, lips, brows)
    const { P, W, H, fw } = M
    // light smoothing only (a strong blur makes the face look smeared): 1/3 resolution, low opacity, soft mask edge
    const [small, sx] = scratch(Math.round(W / 3), Math.round(H / 3), 0); sx.drawImage(raw, 0, 0, small.width, small.height)
    const [big, bx] = scratch(W, H, 1); bx.imageSmoothingQuality = 'high'; bx.drawImage(small, 0, 0, W, H)
    const [mask, mx] = scratch(W, H, 2)
    const holes = [...EYES.map((e) => e.loop.map((i) => P[i])), LIPS_OUT.map((i) => P[i]), ...BROWS.map((b) => [...b.up, ...b.low.slice().reverse()].map((i) => P[i]))]
    soft(mx, [OVAL.map((i) => P[i]), ...holes], '#000', fw * 0.08, 1, 'source-over', 'evenodd')
    bx.globalCompositeOperation = 'destination-in'; bx.drawImage(mask, 0, 0)
    c.save(); c.globalAlpha = v * 0.38; c.drawImage(big, 0, 0); c.restore()
  },
  foundation(c, M, s, v) {
    const { P, fw } = M
    const shapes = [OVAL.map((i) => P[i]), ...EYES.map((e) => e.loop.map((i) => P[i])), LIPS_OUT.map((i) => P[i])]
    // wide soft edge so there is no visible line between face and neck; mostly a tone shift (soft-light), little coverage
    soft(c, shapes, s.c, fw * 0.09, v * 0.55, 'soft-light', 'evenodd')
    soft(c, shapes, s.c, fw * 0.09, v * 0.1, 'source-over', 'evenodd')
  },
  concealer(c, M, s, v) {
    const { P, up, roll } = M
    EYES.forEach((e) => {
      const w = d(P[e.out], P[e.inn]), ctr = add(P[e.lowMid], up, -w * 0.3)
      soft(c, [ell(ctr, w * 0.6, w * 0.2, roll)], s.c, w * 0.22, v * 0.5, 'screen')
      soft(c, [ell(ctr, w * 0.6, w * 0.2, roll)], s.c, w * 0.22, v * 0.25, 'soft-light')
    })
  },
  blush(c, M, s, v) {
    const { P, fw, roll } = M
    // a soft oval swept from the apple of the cheek (50 / 280) up along the cheekbone (116 / 345), not a round disc
    ;[[50, 116, -1], [280, 345, 1]].forEach(([a, b, side]) => {
      const k = sideVis(M, side); if (k < 0.02) return
      const A = P[a], Bp = P[b], ctr = lerp(A, Bp, 0.4), len = d(A, Bp), ang = Math.atan2(Bp.y - A.y, Bp.x - A.x)
      const rx = len * 0.75 + fw * 0.02, ry = rx * 0.5
      soft(c, [ell(ctr, rx, ry, ang)], s.c, rx * 1.1, v * 0.5 * k, 'multiply')
      soft(c, [ell(ctr, rx, ry, ang)], s.c, rx * 1.1, v * 0.4 * k, 'soft-light')
    })
  },
  highlighter(c, M, s, v) {
    const { P, fw, fh, roll, up } = M
    ;[[117, -0.35, -1], [346, 0.35, 1]].forEach(([i, t, side]) => soft(c, [ell(P[i], fw * 0.075, fw * 0.028, roll + t)], s.c, fw * 0.025, v * 0.7 * sideVis(M, side), 'screen'))
    soft(c, [ell(lerp(P[168], P[6], 0.5), fw * 0.014, d(P[168], P[6]) * 0.7, roll)], s.c, fw * 0.015, v * 0.6, 'screen')
    soft(c, [ell(add(P[0], up, fw * 0.014), fw * 0.03, fw * 0.01, roll)], s.c, fw * 0.012, v * 0.7, 'screen')
  },
  eyeshadow(c, M, s, v) {
    const { P, up } = M, mode = s.m || 'source-over'
    EYES.forEach((e) => {
      const w = d(P[e.out], P[e.inn]), top = e.up.map((i) => P[i]), brow = BROWS[EYES.indexOf(e)].low.map((i) => P[i])
      // the upper edge follows the brow: at most ~60% of the way from the lid to the brow, so shadow never reaches the brow
      const lifted = top.map((p, k) => { const t = k / (top.length - 1), b = along(brow, t), f = 0.22 + 0.4 * Math.sin(t * Math.PI); return lerp(p, b, f) }).reverse()
      soft(c, [[...top, ...lifted]], s.c, w * 0.14, v * 0.75, mode)
      if (s.n === 'Smokey') soft(c, [[...e.low.map((i) => P[i]), ...e.low.map((i) => add(P[i], up, -w * 0.1)).reverse()]], s.c, w * 0.1, v * 0.7, 'multiply')
      if (s.n === 'Shimmer' || s.n === 'Golden') soft(c, [ell(add(lerp(P[e.out], P[e.inn], 0.5), up, w * 0.16), w * 0.28, w * 0.09, M.roll)], '#ffffff', w * 0.1, v * 0.45, 'screen')
    })
  },
  eyeliner(c, M, s, v) {
    const { P, up } = M
    EYES.forEach((e) => {
      const w = d(P[e.out], P[e.inn]), top = e.up.map((i) => P[i])
      const dir = norm({ x: P[e.out].x - P[e.inn].x, y: P[e.out].y - P[e.inn].y })
      // tapered liner hugging the lash line: thin at the inner corner, thicker toward the outer corner, short flick
      const n = top.length, th = (k) => Math.max(0.8, w * 0.05 * (0.25 + 0.75 * (1 - k / (n - 1))))
      const upper = top.map((p, k) => add(p, up, th(k)))
      const wing = add(P[e.out], norm({ x: dir.x * 0.85 + up.x * 0.5, y: dir.y * 0.85 + up.y * 0.5 }), w * 0.16)
      soft(c, [[wing, ...upper.slice(1), ...top.slice().reverse().slice(0, -1), P[e.out]]], s.c, Math.max(0.8, w * 0.012), v * 0.92)
    })
  },
  mascara(c, M, s, v) {
    // mascara mostly DARKENS and thickens the real lash line; only a few fine, short, curved lashes are added on top
    // (long drawn spikes look like a cartoon)
    const { P, up } = M
    EYES.forEach((e) => {
      const w = d(P[e.out], P[e.inn]), top = e.up.map((i) => P[i])
      softLine(c, top, s.c, Math.max(1, w * 0.035), Math.max(1, w * 0.02), v * 0.55)
      c.save(); c.globalAlpha = v * 0.45; c.strokeStyle = s.c; c.lineCap = 'round'; c.lineWidth = Math.max(0.6, w * 0.009)
      const outer = norm({ x: P[e.out].x - P[e.inn].x, y: P[e.out].y - P[e.inn].y })
      c.beginPath()
      for (let k = 1; k <= 26; k++) {
        const t = k / 27, p = along(top, t), len = w * (0.05 + 0.05 * Math.sin(t * Math.PI)) * (0.8 + 0.4 * ((k * 7919) % 5) / 5)
        const dir = norm({ x: up.x + outer.x * (t - 0.35) * 0.9, y: up.y + outer.y * (t - 0.35) * 0.9 })
        c.moveTo(p.x, p.y); c.quadraticCurveTo(p.x + dir.x * len * 0.6, p.y + dir.y * len * 0.6, p.x + (dir.x + outer.x * 0.25) * len, p.y + (dir.y + outer.y * 0.25) * len)
      }
      c.stroke(); c.restore()
    })
  },
  brows(c, M, s, v) {
    const { P, fw } = M
    BROWS.forEach((b) => soft(c, [[...b.up, ...b.low.slice().reverse()].map((i) => P[i])], s.c, fw * 0.012, v * 0.75))
  },
  lipstick(c, M, s, v, raw) {
    const { P, fw, W, H } = M, shapes = [LIPS_OUT.map((i) => P[i]), LIPS_IN.map((i) => P[i])]
    const [mask, mx] = scratch(W, H, 2)
    soft(mx, shapes, '#000', Math.max(1, fw * 0.006), 1, 'source-over', 'evenodd') // soft-edged lip mask, the mouth opening stays clear
    const now = performance.now()
    if (raw && now - lipLum.t > 300) { // measure the real lip brightness (cheap, a few times a second)
      lipLum.t = now; const xs = shapes[0].map((p) => p.x), ys = shapes[0].map((p) => p.y), x0 = Math.max(0, Math.min(...xs) - 4), y0 = Math.max(0, Math.min(...ys) - 4)
      const m = meanLum(raw, mask, x0, y0, Math.min(W - x0, Math.max(...xs) - x0 + 8), Math.min(H - y0, Math.max(...ys) - y0 + 8))
      if (m != null) lipLum.v = lipLum.v == null ? m : lipLum.v * 0.6 + m * 0.4
    }
    tintRegion(c, mask, s.c, v, lipLum.v, W, H, { slot: 3, minScale: 0.15, lighten: 0.7, richness: 0.35 })
  },
  gloss(c, M, s, v) {
    const { P, roll } = M, w = d(P[61], P[291])
    soft(c, [LIPS_OUT.map((i) => P[i]), LIPS_IN.map((i) => P[i])], s.c, w * 0.02, v * 0.3, 'overlay', 'evenodd')
    const L = M.light, o = L ? { x: L.dir.x * w * 0.07, y: L.dir.y * w * 0.05 } : { x: 0, y: 0 } // shine moves toward the room light
    soft(c, [ell(add(lerp(P[14], P[17], 0.55), o, 1), w * 0.2, w * 0.045, roll)], '#ffffff', w * 0.04, v * 0.7, 'screen')
    soft(c, [ell(add(lerp(P[0], P[13], 0.5), o, 1), w * 0.12, w * 0.025, roll)], '#ffffff', w * 0.03, v * 0.4, 'screen')
  },
}
const lipLum = { t: 0, v: null }
const ORDER = ['primer', 'foundation', 'concealer', 'blush', 'highlighter', 'eyeshadow', 'eyeliner', 'mascara', 'brows', 'lipstick', 'gloss']

// ---- skin products on the 3D face mask (render/facemesh.js) ----
// Each one is painted ONCE in face texture space, in centimetres of a real face (cm(i) = where landmark i lies), with the same
// anatomical references as the 2D versions above. The mesh then wraps the paint onto the live face every frame. Paint is fully
// opaque in the texture; the product's intensity and blend modes are applied when the mesh is composited (passes).
const FW = 15.3 // face width in cm, the unit the 2D versions use (fw)
function uvPainter(x, S) {
  const kx = S / CM_U, ky = S / CM_V
  const cm = (i) => { const p = uv(i, S); return { x: p.x / kx, y: p.y / ky } }
  // soft fill in cm coordinates: the shape is drawn far off the texture and only its blurred shadow lands on it
  const fill = (shapes, color, blurCm, alpha = 1, rule = 'nonzero', mode = 'source-over') => {
    x.save(); x.globalCompositeOperation = mode; x.globalAlpha = alpha; x.shadowColor = color; x.shadowBlur = blurCm * kx; x.shadowOffsetX = BIG
    x.setTransform(kx, 0, 0, ky, -BIG, 0)
    x.beginPath(); shapes.forEach((sp) => trace(x, sp)); x.fillStyle = '#000'; x.fill(rule); x.restore()
  }
  // fades paint out toward the outline of the face mesh, so there is no hard edge where the mask ends
  const fadeEdge = (widthCm) => {
    x.save(); x.globalCompositeOperation = 'destination-out'; x.setTransform(kx, 0, 0, ky, 0, 0)
    x.shadowColor = '#000'; x.shadowBlur = widthCm * kx * 1.2; x.lineJoin = 'round'; x.lineWidth = widthCm * 0.8; x.strokeStyle = '#000'
    x.beginPath(); trace(x, OVAL.map(cm)); x.stroke(); x.restore()
  }
  return { cm, fill, fadeEdge }
}
const MESH = {
  foundation: {
    paint(x, S, s) {
      const { cm, fill, fadeEdge } = uvPainter(x, S)
      fill([OVAL.map(cm), ...EYES.map((e) => e.loop.map(cm)), LIPS_OUT.map(cm)], s.c, FW * 0.03, 1, 'evenodd')
      fadeEdge(FW * 0.12)
    },
    passes: (v) => [['soft-light', v * 0.55], ['source-over', v * 0.1]],
  },
  concealer: {
    paint(x, S, s) {
      const { cm, fill } = uvPainter(x, S)
      EYES.forEach((e) => {
        const a = cm(e.out), b = cm(e.inn), w = d(a, b), m = cm(e.lowMid), rot = Math.atan2(b.y - a.y, b.x - a.x)
        fill([ell({ x: m.x, y: m.y + w * 0.3 }, w * 0.6, w * 0.2, rot)], s.c, w * 0.22)
      })
    },
    passes: (v) => [['screen', v * 0.5], ['soft-light', v * 0.25]],
  },
  blush: {
    paint(x, S, s) {
      const { cm, fill } = uvPainter(x, S)
      // a soft oval swept from the apple of the cheek (50 / 280) up along the cheekbone (116 / 345)
      ;[[50, 116], [280, 345]].forEach(([a, b]) => {
        const A = cm(a), B = cm(b), ctr = lerp(A, B, 0.4), len = d(A, B), ang = Math.atan2(B.y - A.y, B.x - A.x)
        const rx = len * 0.75 + FW * 0.02
        fill([ell(ctr, rx, rx * 0.5, ang)], s.c, rx * 1.1)
      })
    },
    passes: (v) => [['multiply', v * 0.5], ['soft-light', v * 0.4]],
  },
  highlighter: {
    paint(x, S, s) {
      const { cm, fill } = uvPainter(x, S)
      ;[[117, 0.35], [346, -0.35]].forEach(([i, t]) => fill([ell(cm(i), FW * 0.075, FW * 0.028, t)], s.c, FW * 0.025)) // cheekbones, rising toward the temples
      const a = cm(168), b = cm(6)
      fill([ell(lerp(a, b, 0.5), FW * 0.014, d(a, b) * 0.7, 0)], s.c, FW * 0.015, 0.86) // bridge of the nose
      const c0 = cm(0); fill([ell({ x: c0.x, y: c0.y - FW * 0.014 }, FW * 0.03, FW * 0.01, 0)], s.c, FW * 0.012) // cupid's bow
    },
    passes: (v) => [['screen', v * 0.7]],
  },
}
export const MESH_IDS = new Set(Object.keys(MESH))

// mesh: the WebGL face mask (or null: everything is drawn with the 2D renderer)
export function drawMakeup(c, M, state, raw, mesh) {
  const meshOn = !!mesh && Object.keys(state).some((id) => MESH[id]) && mesh.update(M)
  ORDER.forEach((id) => {
    const st = state[id]; if (!st) return
    const shade = MAKEUP.find((p) => p.id === id).shades[st.shade]
    if (meshOn && MESH[id] && mesh.draw(c, mesh.texture(`${id}:${st.shade}`, (x, S) => MESH[id].paint(x, S, shade)), MESH[id].passes(st.v))) return
    DRAW[id](c, M, shade, st.v, raw)
  })
}
