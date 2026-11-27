// AI automatic makeup: face analysis + makeup styling engine.
//
// 1. measure(M, raw): one reading per camera frame, from the live face landmarks (track/head.js) and the camera picture
//    (before any makeup is drawn). Only frames where the face is frontal, fully in view and not blinking are used.
// 2. summarise(readings): the median of ~20 readings -> face shape, eye shape and spacing, lip fullness, a foundation shade
//    and undertone picked for the skin AS THE CAMERA SEES IT, and a brow shade. These are styling estimates, not a skin or
//    medical analysis: camera exposure and room light change how skin looks, so the UI says "picked for this light".
// 3. buildLook(occasion, variant, analysis, options): a complete makeup look (foundation to gloss) as studio state, using
//    the existing products in makeup.js. Shades, placement and strength are chosen from the analysis, the way a make-up
//    artist adapts one look to different faces (e.g. a shorter liner wing on hooded eyes, contour shaped for the face).
import { MAKEUP } from './makeup.js'

const prod = (id) => MAKEUP.find((p) => p.id === id)
const shadeIx = (id, name) => Math.max(0, prod(id).shades.findIndex((s) => s.n === name))
const d = (a, b) => Math.hypot(a.x - b.x, a.y - b.y)
const lerp = (a, b, t) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t })
const median = (v) => { const s = v.filter(Number.isFinite).sort((a, b) => a - b); return s.length ? s[s.length >> 1] : NaN }
const clamp = (v, a, b) => Math.min(b, Math.max(a, v))

// ---------- colour ----------
const lin = (c) => { c /= 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4 }
export function toLab([r, g, b]) {
  const R = lin(r), G = lin(g), B = lin(b)
  const X = (0.4124 * R + 0.3576 * G + 0.1805 * B) / 0.95047, Y = 0.2126 * R + 0.7152 * G + 0.0722 * B, Z = (0.0193 * R + 0.1192 * G + 0.9505 * B) / 1.08883
  const f = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116)
  return [116 * f(Y) - 16, 500 * (f(X) - f(Y)), 200 * (f(Y) - f(Z))]
}
const hexLab = (h) => toLab([1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)))

// median colour of small patches of the camera picture (robust to a stray highlight, a hair or a shadow)
function patchColor(ctx, pts, r, W, H, q = 0.5) { // q: which percentile (0.5 = median; brows use the darker pixels)
  const R = [], G = [], B = []
  for (const p of pts) {
    const x0 = Math.round(p.x - r), y0 = Math.round(p.y - r), s = Math.max(2, Math.round(r * 2))
    if (x0 < 0 || y0 < 0 || x0 + s > W || y0 + s > H) continue
    let px; try { px = ctx.getImageData(x0, y0, s, s).data } catch { return null }
    for (let i = 0; i < px.length; i += 8) { R.push(px[i]); G.push(px[i + 1]); B.push(px[i + 2]) } // every 2nd pixel is plenty
  }
  const pick = (v) => { v.sort((a, b) => a - b); return v[Math.min(v.length - 1, Math.floor(v.length * q))] }
  return R.length ? [pick(R), pick(G), pick(B)] : null
}

// ---------- 1. one reading ----------
// quality: why a frame is not used (shown to the person as guidance); null = good frame
// Real people at a laptop or phone look at the SCREEN, not the lens: 15-25 deg of turn and some tilt are normal. Readings are
// corrected for the turn (measure), so frames up to ~29 deg are used. (Update 18 used 17 deg: on a test video of a person
// sitting at 20 deg, 60% of frames were rejected and the look took 14 s to appear.)
export function frameQuality(M, W, H) {
  if (!M || M.alpha < 0.6) return 'face'
  if (M.fw3 / Math.min(W, H) < 0.12) return 'closer'
  if (M.inFrame < 0.9) return 'centre'
  if (Math.abs(M.yaw) > 0.5 || Math.abs(M.pitch) > 0.5 || Math.abs(M.roll) > 0.5) return 'straight'
  return null
}

export function measure(M, raw) {
  const P = M.P, W = M.W, H = M.H
  // a turned head makes widths look narrower: height/width ratios are corrected with the head's turn (yaw)
  const cy = Math.cos(Math.min(0.8, Math.abs(M.yaw || 0)))
  const eyeW = (d(P[33], P[133]) + d(P[263], P[362])) / 2
  const open = (d(P[159], P[145]) + d(P[386], P[374])) / 2 / eyeW
  const mouthW = d(P[61], P[291]), gap = d(P[13], P[14]) / mouthW
  const r = {
    // face proportions: height (forehead landmark to chin) to width at the cheekbones; jaw, forehead and cheek widths
    hw: (d(P[10], P[152]) / d(P[234], P[454])) * cy,
    jaw: d(P[172], P[397]) / d(P[234], P[454]),
    fore: d(P[54], P[284]) / d(P[234], P[454]),
    chin: d(P[148], P[377]) / d(P[172], P[397]),
    open: open * cy > 0.12 ? open * cy : NaN, // a blink is not an eye shape
    lid: ((d(P[159], P[105]) + d(P[386], P[334])) / 2 / eyeW) * cy, // lid-to-brow space: small = hooded / low brows
    spacing: d(P[133], P[362]) / eyeW,
    tilt: ((P[133].y - P[33].y) + (P[362].y - P[263].y)) / 2 / eyeW, // outer corner higher than inner: > 0 (upturned)
    lips: gap < 0.06 ? (d(P[0], P[17]) / mouthW) * cy : NaN, // only with the mouth closed (a smile or speech changes the shape)
    upperLip: gap < 0.06 ? d(P[0], P[13]) / Math.max(1, d(P[14], P[17])) : NaN,
  }
  // skin: both cheeks below the eye and above the blush line, plus the centre of the forehead
  const ctx = raw.getContext('2d', { willReadFrequently: true }), rad = Math.max(2, M.fw * 0.025)
  // with the head turned, only the cheek facing the camera is sampled (the other one is foreshortened and in shadow)
  const cl = lerp(P[50], P[118], 0.5), cr = lerp(P[280], P[347], 0.5), turned = Math.abs(M.yaw || 0) > 0.25
  const cheeks = !turned ? [cl, cr] : [d(P[50], P[234]) > d(P[280], P[454]) ? cl : cr], fore = [lerp(P[151], P[9], 0.5)]
  const skin = patchColor(ctx, [...cheeks, ...fore], rad, W, H)
  const brow = patchColor(ctx, [lerp(P[105], P[52], 0.5), lerp(P[334], P[282], 0.5), lerp(P[66], P[65], 0.5), lerp(P[296], P[295], 0.5)], Math.max(1.5, M.fw * 0.012), W, H, 0.25) // the hairs, not the skin between them
  if (skin) { const [L, a, b] = toLab(skin); Object.assign(r, { L, a, b }) }
  if (brow && skin) r.browDark = toLab(skin)[0] - toLab(brow)[0]
  return r
}

// ---------- 2. summary ----------
const FOUND = prod('foundation').shades.map((s) => hexLab(s.c)[0])
export function summarise(rs) {
  const m = (k) => median(rs.map((r) => r[k]))
  const hw = m('hw'), jaw = m('jaw'), fore = m('fore'), chin = m('chin'), open = m('open'), lid = m('lid'), spacing = m('spacing'), tilt = m('tilt'), lips = m('lips'), L = m('L'), a = m('a'), b = m('b'), browDark = m('browDark')
  // face shape: the usual make-up-artist categories from proportions (thresholds tuned on face-mesh measurements)
  const faceShape = hw > 1.32 ? 'Long' : jaw > 0.86 && hw < 1.2 ? 'Square' : hw < 1.14 ? 'Round' : fore > 0.9 && chin < 0.46 ? 'Heart' : 'Oval'
  const eyeShape = lid < 0.55 ? 'Hooded' : open > 0.36 ? 'Round' : 'Almond'
  const eyeSet = spacing > 1.18 ? 'Wide-set' : spacing < 0.95 ? 'Close-set' : 'Average spacing'
  const lipShape = lips > 0.42 ? 'Full' : lips < 0.3 ? 'Thin' : 'Medium'
  // foundation: nearest lightness among the 5 shades, under this camera's exposure (an estimate, said so in the UI)
  let foundation = 2
  if (Number.isFinite(L)) foundation = FOUND.reduce((best, v, i) => (Math.abs(v - L) < Math.abs(FOUND[best] - L) ? i : best), 0)
  const depth = foundation <= 1 ? 'light' : foundation === 2 ? 'medium' : 'deep'
  const hue = Number.isFinite(a) && Number.isFinite(b) ? (Math.atan2(b, a) * 180) / Math.PI : NaN
  const undertone = !Number.isFinite(hue) ? 'Neutral' : hue > 62 ? 'Warm' : hue < 48 ? 'Cool' : 'Neutral'
  const brows = !Number.isFinite(browDark) ? 1 : browDark > 30 ? 0 : browDark > 16 ? 1 : depth === 'light' ? 3 : 1
  return { faceShape, eyeShape, eyeSet, lipShape, foundation, depth, undertone, brows, tilt, raw: { hw, jaw, fore, chin, open, lid, spacing, lips, L, a, b, hue, browDark, n: rs.length } }
}

// ---------- 3. looks ----------
// Each look lists products as [id, shade, strength, extra fields]. A shade can be a function of the analysis (A).
const nude = (A) => (A.depth === 'deep' ? 'Brown' : 'Nude')
const softBlush = (A) => (A.undertone === 'Cool' ? 'Rose' : A.depth === 'deep' ? 'Berry' : 'Peach')
const warmBlush = (A) => (A.depth === 'deep' ? 'Berry' : A.undertone === 'Cool' ? 'Mauve' : 'Coral')
const glow = (A) => (A.depth === 'deep' ? 'Gold' : A.depth === 'light' ? 'Pearl' : 'Champagne')
const bridalRed = (A) => (A.depth === 'deep' || A.undertone === 'Cool' ? 'Maroon' : 'Red')
const base = (A, f = 0.42) => [['primer', 'Smoothing', 0.4], ['foundation', A.foundation, f], ['concealer', Math.min(2, Math.max(0, A.foundation - 1)), 0.32]]
const contourShade = (A) => (A.depth === 'light' ? 'Light' : A.depth === 'medium' ? 'Medium' : 'Deep')

export const OCCASIONS = [
  { id: 'auto', label: 'Auto Makeup', note: 'AI picks the look' },
  { id: 'natural', label: 'Natural', looks: [
    { name: 'Fresh natural', items: (A) => [...base(A, 0.38), ['blush', softBlush, 0.42], ['eyeshadow', 'Nude', 0.4], ['eyeliner', 'Brown', 0.55, { wing: 0.3 }], ['mascara', 'Black', 0.7], ['brows', A.brows, 0.5], ['lipstick', (A2) => (A2.depth === 'deep' ? 'Brown' : 'Pink'), 0.5], ['gloss', 'Clear', 0.4]] },
    { name: 'Soft peach', items: (A) => [...base(A, 0.38), ['blush', 'Peach', 0.45], ['eyeshadow', 'Peach', 0.42], ['eyeliner', 'Brown', 0.55, { wing: 0.3 }], ['mascara', 'Black', 0.7], ['brows', A.brows, 0.5], ['lipstick', 'Coral', 0.55], ['gloss', 'Peach', 0.4]] },
  ] },
  { id: 'office', label: 'Office', looks: [
    { name: 'Polished office', items: (A) => [...base(A, 0.45), ['contour', contourShade, 0.3], ['blush', softBlush, 0.4], ['eyeshadow', 'Brown', 0.45], ['eyeliner', 'Black', 0.75, { wing: 0.6 }], ['mascara', 'Black', 0.8], ['brows', A.brows, 0.55], ['lipstick', (A2) => (A2.depth === 'deep' ? 'Brown' : 'Pink'), 0.6], ['gloss', 'Clear', 0.3]] },
    { name: 'Rose meeting', items: (A) => [...base(A, 0.42), ['blush', 'Rose', 0.42], ['eyeshadow', 'Nude', 0.45], ['eyeliner', 'Black', 0.7, { wing: 0.5 }], ['mascara', 'Black', 0.8], ['brows', A.brows, 0.55], ['lipstick', 'Pink', 0.62]] },
  ] },
  { id: 'party', label: 'Party', looks: [
    { name: 'Night out', items: (A) => [...base(A), ['contour', contourShade, 0.4], ['blush', warmBlush, 0.4], ['highlighter', glow, 0.6], ['eyeshadow', 'Smokey', 0.55], ['eyeliner', 'Black', 0.9, { wing: 1.2 }], ['mascara', 'Black', 0.9], ['brows', A.brows, 0.65], ['lipstick', 'Pink', 0.7], ['gloss', 'Pink', 0.45]] },
    { name: 'Purple party', items: (A) => [...base(A), ['contour', contourShade, 0.35], ['blush', 'Mauve', 0.4], ['highlighter', glow, 0.55], ['eyeshadow', 'Purple', 0.55], ['eyeliner', 'Black', 0.85, { wing: 1.1 }], ['mascara', 'Black', 0.9], ['brows', A.brows, 0.6], ['lipstick', 'Maroon', 0.6]] },
  ] },
  { id: 'glam', label: 'Glam', looks: [
    { name: 'Red carpet glam', items: (A) => [...base(A, 0.5), ['contour', contourShade, 0.55], ['blush', warmBlush, 0.45], ['highlighter', glow, 0.75], ['eyeshadow', 'Smokey', 0.65], ['eyeliner', 'Black', 1, { wing: 1.5 }], ['mascara', 'Black', 1], ['brows', A.brows, 0.75], ['lipstick', 'Red', 0.92]] },
    { name: 'Bronze glam', items: (A) => [...base(A, 0.5), ['contour', contourShade, 0.55], ['blush', 'Coral', 0.4], ['highlighter', 'Gold', 0.75], ['eyeshadow', 'Golden', 0.6], ['eyeliner', 'Brown', 1, { wing: 1.4 }], ['mascara', 'Black', 1], ['brows', A.brows, 0.7], ['lipstick', 'Brown', 0.75], ['gloss', 'Clear', 0.4]] },
  ] },
  { id: 'wedding', label: 'Wedding Guest', looks: [
    { name: 'Golden wedding', items: (A) => [...base(A, 0.48), ['contour', contourShade, 0.4], ['blush', warmBlush, 0.45], ['highlighter', glow, 0.65], ['eyeshadow', 'Golden', 0.55], ['eyeliner', 'Black', 0.95, { wing: 1.2 }], ['mascara', 'Black', 0.95], ['brows', A.brows, 0.7], ['lipstick', bridalRed, 0.9]] },
    { name: 'Rose gold wedding', items: (A) => [...base(A, 0.46), ['contour', contourShade, 0.35], ['blush', 'Rose', 0.45], ['highlighter', 'Champagne', 0.65], ['eyeshadow', 'Pink', 0.5], ['eyeliner', 'Brown', 0.85, { wing: 1.1 }], ['mascara', 'Black', 0.9], ['brows', A.brows, 0.65], ['lipstick', 'Pink', 0.7], ['gloss', 'Pink', 0.35]] },
  ] },
  { id: 'bridal', label: 'Bridal', looks: [
    { name: 'Classic bride', items: (A) => [...base(A, 0.55), ['contour', contourShade, 0.5], ['blush', warmBlush, 0.5], ['highlighter', glow, 0.8], ['eyeshadow', 'Golden', 0.65], ['eyeliner', 'Black', 1, { wing: 1.45 }], ['mascara', 'Black', 1], ['brows', A.brows, 0.8], ['lipstick', bridalRed, 0.95]] },
    { name: 'Maroon bride', items: (A) => [...base(A, 0.55), ['contour', contourShade, 0.5], ['blush', 'Berry', 0.45], ['highlighter', 'Gold', 0.8], ['eyeshadow', 'Brown', 0.6], ['eyeliner', 'Black', 1, { wing: 1.5 }], ['mascara', 'Black', 1], ['brows', A.brows, 0.8], ['lipstick', 'Maroon', 0.95], ['gloss', 'Clear', 0.25]] },
  ] },
  { id: 'engagement', label: 'Engagement', looks: [
    { name: 'Soft engagement', items: (A) => [...base(A, 0.48), ['contour', contourShade, 0.35], ['blush', 'Rose', 0.45], ['highlighter', 'Champagne', 0.7], ['eyeshadow', 'Shimmer', 0.55], ['eyeliner', 'Brown', 0.85, { wing: 1.1 }], ['mascara', 'Black', 0.9], ['brows', A.brows, 0.65], ['lipstick', 'Pink', 0.7], ['gloss', 'Pink', 0.5]] },
    { name: 'Peach engagement', items: (A) => [...base(A, 0.46), ['contour', contourShade, 0.3], ['blush', 'Peach', 0.45], ['highlighter', glow, 0.7], ['eyeshadow', 'Peach', 0.5], ['eyeliner', 'Black', 0.85, { wing: 1.1 }], ['mascara', 'Black', 0.9], ['brows', A.brows, 0.6], ['lipstick', 'Coral', 0.65], ['gloss', 'Peach', 0.45]] },
  ] },
  { id: 'diwali', label: 'Diwali', looks: [
    { name: 'Diwali glow', items: (A) => [...base(A, 0.45), ['contour', contourShade, 0.35], ['blush', warmBlush, 0.45], ['highlighter', 'Gold', 0.85], ['eyeshadow', 'Golden', 0.65], ['eyeliner', 'Black', 0.95, { wing: 1.25 }], ['mascara', 'Black', 0.95], ['brows', A.brows, 0.65], ['lipstick', (A2) => (A2.depth === 'deep' ? 'Maroon' : 'Red'), 0.92]] },
    { name: 'Festive coral', items: (A) => [...base(A, 0.45), ['blush', 'Coral', 0.45], ['highlighter', 'Gold', 0.8], ['eyeshadow', 'Shimmer', 0.6], ['eyeliner', 'Black', 0.9, { wing: 1.2 }], ['mascara', 'Black', 0.9], ['brows', A.brows, 0.6], ['lipstick', 'Coral', 0.75], ['gloss', 'Peach', 0.4]] },
  ] },
  { id: 'holi', label: 'Holi', looks: [
    { name: 'Holi colour', items: (A) => [...base(A, 0.3), ['blush', 'Coral', 0.45], ['highlighter', 'Pearl', 0.5], ['eyeshadow', 'Pink', 0.55], ['eyeliner', 'Navy', 0.7, { wing: 0.9 }], ['mascara', 'Black', 0.8], ['brows', A.brows, 0.5], ['lipstick', 'Pink', 0.65], ['gloss', 'Pink', 0.5]] },
    { name: 'Holi purple', items: (A) => [...base(A, 0.3), ['blush', 'Rose', 0.4], ['eyeshadow', 'Purple', 0.5], ['eyeliner', 'Black', 0.7, { wing: 0.8 }], ['mascara', 'Black', 0.8], ['brows', A.brows, 0.5], ['lipstick', 'Coral', 0.65], ['gloss', 'Clear', 0.45]] },
  ] },
]
export const findOccasion = (id) => OCCASIONS.find((o) => o.id === id)

// Festival dates (approximate, by the Hindu calendar). UPDATE these for later years.
const FESTIVALS = [['diwali', '2026-11-08'], ['holi', '2027-03-22'], ['diwali', '2027-10-29'], ['holi', '2028-03-11'], ['diwali', '2028-10-17']]
// "Auto Makeup": a festival look in the week around a festival, otherwise by time of day
export function autoOccasion(date = new Date()) {
  for (const [id, day] of FESTIVALS) { const dt = (date - new Date(day + 'T12:00:00')) / 864e5; if (dt > -5 && dt < 3) return { id, why: `${findOccasion(id).label} is near` } }
  const h = date.getHours()
  if (h >= 18 || h < 3) return { id: 'party', why: 'it is evening' }
  if (h >= 9 && h < 17 && date.getDay() % 6) return { id: 'office', why: 'it is a working day' }
  return { id: 'natural', why: 'it is daytime' }
}

// how the analysis changes a look (the same look adapted to the face)
function adapt(id, st, A) {
  // strengths in the looks are on a make-up artist's scale; highlighter and brow products read stronger on camera than in
  // a mirror (tuned on test faces: at full strength the cheekbones showed a pale band and brows looked painted on)
  if (id === 'highlighter') st.v *= 0.55
  if (id === 'brows') st.v *= 0.6
  if (id === 'eyeliner') {
    const w = st.wing ?? 1
    st.wing = A.eyeShape === 'Hooded' ? w * 0.65 : A.eyeShape === 'Round' ? w * 1.2 : w // hooded: a long wing folds into the lid
    if (A.tilt < -0.04) st.wing *= 1.15 // downturned outer corners: a lifted flick opens the eye
  }
  if (id === 'eyeshadow' && A.eyeShape === 'Hooded') st.v *= 0.85 // less colour where the lid folds
  if (id === 'gloss') st.v *= A.lipShape === 'Thin' ? 1.3 : A.lipShape === 'Full' ? 0.8 : 1 // gloss makes lips look fuller
  if (id === 'lipstick' && A.lipShape === 'Thin') st.v *= 0.92
  if (id === 'contour') Object.assign(st, {
    Round: { cheek: 1.3, jaw: 0.8, forehead: 0.6, chin: 0 }, Long: { cheek: 0.8, jaw: 0.6, forehead: 1.2, chin: 1 },
    Square: { cheek: 1, jaw: 1.4, forehead: 0.7, chin: 0 }, Heart: { cheek: 0.9, jaw: 0.3, forehead: 1.2, chin: 0 }, Oval: { cheek: 1, jaw: 0.7, forehead: 0.6, chin: 0 },
  }[A.faceShape] || {})
}

// Every look is COMPLETE: the products a look does not list are added at a light, natural level, so face (foundation,
// concealer, contour, blush, highlighter), eyes (shadow, liner, mascara, brows) and lips (lipstick, gloss) are always all on.
const COMPLETE = (A) => [['foundation', A.foundation, 0.35], ['concealer', Math.min(2, Math.max(0, A.foundation - 1)), 0.28], ['contour', contourShade, 0.22], ['blush', softBlush, 0.32],
  ['highlighter', glow, 0.4], ['eyeshadow', 'Nude', 0.35], ['eyeliner', 'Brown', 0.55, { wing: 0.35 }], ['mascara', 'Black', 0.65], ['brows', A.brows, 0.45], ['lipstick', nude, 0.55], ['gloss', 'Clear', 0.3]]

// -> { name, occasion, why, state: { id: { shade, v, ...} }, ids }
// opts: k (overall intensity), lip / eye (shade index chosen by the person), off (Set of product ids switched off)
export function buildLook(occId, variant, A, opts = {}) {
  let occ = findOccasion(occId) || findOccasion('natural'), why = ''
  if (occ.id === 'auto') { const pick = autoOccasion(opts.now); occ = findOccasion(pick.id); why = pick.why }
  const look = occ.looks[((variant % occ.looks.length) + occ.looks.length) % occ.looks.length]
  const k = opts.k ?? 1, state = {}
  const items = look.items(A), have = new Set(items.map((x) => x[0]))
  for (const it of COMPLETE(A)) if (!have.has(it[0])) items.push(it)
  for (const [id, shade, v, extra] of items) {
    const sv = typeof shade === 'function' ? shade(A) : shade
    const st = { shade: typeof sv === 'number' ? clamp(sv, 0, prod(id).shades.length - 1) : shadeIx(id, sv), v, ...(extra || {}) }
    adapt(id, st, A)
    if (id === 'lipstick' && opts.lip != null) st.shade = opts.lip
    if (id === 'eyeshadow' && opts.eye != null) st.shade = opts.eye
    st.base = clamp(st.v, 0, 1); st.v = clamp(st.base * k, 0, 1)
    state[id] = st
  }
  // shades the person picked for a product that this look does not include are added (they asked for that colour)
  if (opts.lip != null && !state.lipstick) state.lipstick = { shade: opts.lip, base: 0.7, v: clamp(0.7 * k, 0, 1) }
  if (opts.eye != null && !state.eyeshadow) state.eyeshadow = { shade: opts.eye, base: 0.5, v: clamp(0.5 * k, 0, 1) }
  const ids = Object.keys(state)
  for (const id of opts.off || []) delete state[id]
  return { name: look.name, occasion: occ, auto: occId === 'auto', why, state, ids, variants: occ.looks.length }
}

// a neutral analysis, used if the camera picture could not be read (the look is still applied, just not personalised)
export const DEFAULT_ANALYSIS = { faceShape: 'Oval', eyeShape: 'Almond', eyeSet: 'Average spacing', lipShape: 'Medium', foundation: 2, depth: 'medium', undertone: 'Neutral', brows: 1, tilt: 0, raw: {} }
