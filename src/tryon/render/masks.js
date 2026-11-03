// Segmentation masks for the live studio, built from ONE segmenter result per analysed frame:
//  - hair:     where your real hair is (hair colour; hair hanging in front of a garment)
//  - occluder: what covers the face (hair strands, a hand, glasses, a scarf), so makeup is not painted on top of it
//
// The segmenter answers at 256x256 with hard 0/1 labels. Stretched to the camera picture that edge is blocky and flickers.
// So each new mask is refined with a GUIDED FILTER (He, Sun & Tang, 2010) against the real camera picture at a working
// resolution (a quarter of the frame size on phones, half on computers): the edge snaps to the real hair / skin boundary in the
// picture instead of following the 256 px grid. Then it is blended with the previous mask over time, LESS when the head moves
// fast (so the colour does not trail behind a quick turn) and more when still (so the edge does not shimmer).
//
// Labels: the hair segmenter has 0 = background, 1 = hair. The selfie multiclass segmenter has 0 background, 1 hair,
// 2 body skin, 3 face skin, 4 clothes, 5 others (accessories). The occluder uses hair, body skin (a hand in front of the face),
// clothes and accessories; never background (face edges are often labelled background).

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v)

// box mean with radius r over a w x h float image (two 1D running sums), into out
function boxMean(src, w, h, r, out, tmp) {
  for (let y = 0; y < h; y++) {
    const o = y * w; let s = 0
    for (let x = -r; x <= r; x++) s += src[o + Math.min(w - 1, Math.max(0, x))]
    for (let x = 0; x < w; x++) { tmp[o + x] = s / (2 * r + 1); s += src[o + Math.min(w - 1, x + r + 1)] - src[o + Math.max(0, x - r)] }
  }
  for (let x = 0; x < w; x++) {
    let s = 0
    for (let y = -r; y <= r; y++) s += tmp[Math.min(h - 1, Math.max(0, y)) * w + x]
    for (let y = 0; y < h; y++) { out[y * w + x] = s / (2 * r + 1); s += tmp[Math.min(h - 1, y + r + 1) * w + x] - tmp[Math.max(0, y - r) * w + x] }
  }
}

// guided filter: q = a*I + b, edges of q follow edges of the guide I. p = input mask (0..1), I = grey guide (0..1)
function guided(I, p, w, h, r, eps, B) {
  const n = w * h, { mI, mp, mIp, mII, a, b, t } = B
  for (let i = 0; i < n; i++) { B.Ip[i] = I[i] * p[i]; B.II[i] = I[i] * I[i] }
  boxMean(I, w, h, r, mI, t); boxMean(p, w, h, r, mp, t); boxMean(B.Ip, w, h, r, mIp, t); boxMean(B.II, w, h, r, mII, t)
  for (let i = 0; i < n; i++) { const v = mII[i] - mI[i] * mI[i], cv = mIp[i] - mI[i] * mp[i]; a[i] = cv / (v + eps); b[i] = mp[i] - a[i] * mI[i] }
  boxMean(a, w, h, r, B.ma, t); boxMean(b, w, h, r, B.mb, t)
  for (let i = 0; i < n; i++) B.q[i] = clamp01(B.ma[i] * I[i] + B.mb[i])
  return B.q
}

export function createMasks(phone) {
  const work = document.createElement('canvas'), wx = work.getContext('2d', { willReadFrequently: true })
  const hairCv = document.createElement('canvas'), occCv = document.createElement('canvas')
  let w = 0, h = 0, B = null, prevHair = null, prevOcc = null, img = null, seen = 0
  const alloc = (W, H) => {
    const k = phone ? 1 / 4 : 1 / 2; w = Math.max(64, Math.round(W * k)); h = Math.max(48, Math.round(H * k))
    work.width = hairCv.width = occCv.width = w; work.height = hairCv.height = occCv.height = h
    const F = () => new Float32Array(w * h)
    B = { mI: F(), mp: F(), mIp: F(), mII: F(), a: F(), b: F(), t: F(), Ip: F(), II: F(), ma: F(), mb: F(), q: F(), I: F(), p: F(), pin: F() }
    prevHair = null; prevOcc = null; img = wx.createImageData(w, h)
  }
  // labels: Uint8Array (mw x mh) from the segmenter, analysed on the UN-mirrored camera frame. raw: the mirrored camera picture.
  // motion: how far the head moved since the previous mask, { dx, dy } in picture pixels and rel = that distance / face width
  function update(labels, mw, mh, raw, mirror, motion = null) {
    if (!B || Math.max(64, Math.round(raw.width * (phone ? 1 / 4 : 1 / 2))) !== w) alloc(raw.width, raw.height)
    const n = w * h
    // 1. labels -> soft masks at working size: each working pixel = the share of hair (and of occluder classes) in its block
    const bx = mw / w, by = mh / h, hp = B.p, op = B.op || (B.op = new Float32Array(n)); let occAny = false
    for (let y = 0; y < h; y++) {
      const y0 = Math.floor(y * by), y1 = Math.max(y0 + 1, Math.floor((y + 1) * by))
      for (let x = 0; x < w; x++) {
        const xs = mirror ? w - 1 - x : x, x0 = Math.floor(xs * bx), x1 = Math.max(x0 + 1, Math.floor((xs + 1) * bx))
        let hc = 0, oc = 0, c = 0
        for (let yy = y0; yy < y1; yy += 2) for (let xx = x0; xx < x1; xx += 2) { const v = labels[yy * mw + xx]; c++; if (v === 1) hc++; else if (v === 2 || v === 4 || v === 5) oc++ }
        hp[y * w + x] = hc / c; op[y * w + x] = oc / c; if (oc) occAny = true
      }
    }
    // 2. guide = the camera picture in grey, same size
    wx.drawImage(raw, 0, 0, w, h); const g = wx.getImageData(0, 0, w, h).data
    for (let i = 0; i < n; i++) { const k = i * 4; B.I[i] = (0.299 * g[k] + 0.587 * g[k + 1] + 0.114 * g[k + 2]) / 255 }
    const r = phone ? 2 : 3, eps = 2e-3
    // temporal blend: the previous mask is first moved with the head (so it does not leave a ghost where the head was), and the
    // new mask counts for 0.5 when still, up to 1 when the head moved 5% of a face width or more since the previous mask
    const rel = motion ? motion.rel : 0, aNew = !seen ? 1 : 0.5 + 0.5 * clamp01(rel / 0.05)
    const sx = motion ? Math.round(motion.dx * (w / raw.width)) : 0, sy = motion ? Math.round(motion.dy * (h / raw.height)) : 0
    const shift = (prev) => { if (!prev || (!sx && !sy)) return prev; const t = B.t; t.set(prev); for (let y = 0; y < h; y++) { const yy = y - sy; for (let x = 0; x < w; x++) { const xx = x - sx; prev[y * w + x] = yy >= 0 && yy < h && xx >= 0 && xx < w ? t[yy * w + xx] : 0 } } return prev }
    prevHair = shift(prevHair); prevOcc = shift(prevOcc)
    const out = (src, prev, cv) => {
      for (let i = 0; i < n; i++) B.pin[i] = src[i]
      const q = guided(B.I, B.pin, w, h, r, eps, B)
      const res = prev || new Float32Array(n)
      for (let i = 0; i < n; i++) res[i] = prev ? res[i] + (q[i] - res[i]) * aNew : q[i]
      const D = img.data; for (let i = 0; i < n; i++) { const k = i * 4; D[k] = D[k + 1] = D[k + 2] = 255; D[k + 3] = res[i] * 255 }
      cv.getContext('2d').putImageData(img, 0, 0)
      return res
    }
    prevHair = out(hp, prevHair, hairCv)
    if (occAny || prevOcc) prevOcc = out(op, prevOcc, occCv); else occCv.getContext('2d').clearRect(0, 0, w, h)
    seen++
  }
  function reset() { prevHair = prevOcc = null; seen = 0 }
  return { update, reset, get hair() { return seen ? hairCv : null }, get occluder() { return seen ? occCv : null }, get size() { return [w, h] } }
}

// Put back what covers the face over a layer that holds the picture + makeup: inside the face outline, where the masks say
// hair / hand / accessory, the pixels of `src` (the picture before makeup) are drawn over L. keep: areas never restored
// (eyes and brows: segmenters often label brows and lashes as hair, which would erase eyeliner, mascara and brow colour).
export function cutOccluders(L, masks, facePoly, W, H, keep = [], src = null, off = null) {
  const hair = masks.hair, occ = masks.occluder; if (!hair) return false
  const c = cutOccluders.c || (cutOccluders.c = document.createElement('canvas')); if (c.width !== W || c.height !== H) { c.width = W; c.height = H }
  const x = c.getContext('2d'); x.clearRect(0, 0, W, H)
  x.imageSmoothingEnabled = true; x.imageSmoothingQuality = 'high'
  const ox = off?.x || 0, oy = off?.y || 0; x.drawImage(hair, ox, oy, W, H); if (occ) x.drawImage(occ, ox, oy, W, H)
  x.globalCompositeOperation = 'destination-in'; x.beginPath(); facePoly.forEach((p, i) => (i ? x.lineTo(p.x, p.y) : x.moveTo(p.x, p.y))); x.closePath(); x.fill()
  x.globalCompositeOperation = 'destination-out'; x.lineJoin = 'round'; keep.forEach(({ poly, pad }) => { x.beginPath(); poly.forEach((p, i) => (i ? x.lineTo(p.x, p.y) : x.moveTo(p.x, p.y))); x.closePath(); x.fill(); x.lineWidth = pad * 2; x.stroke() })
  x.globalCompositeOperation = 'source-over'
  if (src) { x.globalCompositeOperation = 'source-in'; x.drawImage(src, 0, 0); x.globalCompositeOperation = 'source-over'; L.drawImage(c, 0, 0) }
  else { L.save(); L.globalCompositeOperation = 'destination-out'; L.drawImage(c, 0, 0); L.restore() } // layer of items only
  return true
}
