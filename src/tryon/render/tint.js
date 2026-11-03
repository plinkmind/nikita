// Lighting-aware recolouring of a masked region (lips, hair).
// A flat colour painted on top looks like a sticker. Instead:
//  1. measure how bright the real region is (meanLum),
//  2. shift its brightness toward the brightness of the chosen shade (multiply to darken, screen to lighten) - the real
//     texture, shine and shadows stay because every pixel is scaled, not replaced,
//  3. apply the shade's hue and saturation with the 'color' blend mode (keeps the pixel's own lightness).
// Everything is cut to the (soft) mask, so nothing spills outside it.

const scratch = []
const canvasOf = (k, w, h) => { const c = (scratch[k] ||= document.createElement('canvas')); if (c.width !== w || c.height !== h) { c.width = w; c.height = h } return c }
const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
export const lumOf = (hex) => { const [r, g, b] = rgb(hex); return 0.299 * r + 0.587 * g + 0.114 * b }

// average brightness (0..1) of `src` where `mask` is opaque. Downsamples both to a small size, so it is cheap.
export function meanLum(src, mask, sx = 0, sy = 0, sw = src.width, sh = src.height) {
  const S = 48, a = canvasOf(10, S, S), b = canvasOf(11, S, S)
  const ax = a.getContext('2d', { willReadFrequently: true }), bx = b.getContext('2d', { willReadFrequently: true })
  ax.clearRect(0, 0, S, S); bx.clearRect(0, 0, S, S)
  ax.drawImage(src, sx, sy, sw, sh, 0, 0, S, S); bx.drawImage(mask, (sx * mask.width) / src.width, (sy * mask.height) / src.height, (sw * mask.width) / src.width, (sh * mask.height) / src.height, 0, 0, S, S)
  const p = ax.getImageData(0, 0, S, S).data, m = bx.getImageData(0, 0, S, S).data
  let n = 0, s = 0
  for (let i = 0; i < p.length; i += 4) { const w = m[i + 3] / 255; if (w < 0.5) continue; s += w * (0.299 * p[i] + 0.587 * p[i + 1] + 0.114 * p[i + 2]) / 255; n += w }
  return n > 4 ? s / n : null
}

// c: target context. mask: canvas whose ALPHA is the region (any size; it is stretched to w x h). col: '#rrggbb'.
// strength 0..1. lum: measured mean brightness of the real region (null = unknown, brightness shift skipped).
export function tintRegion(c, mask, col, strength, lum, w, h, opts = {}) {
  const L = canvasOf(opts.slot ?? 0, mask.width, mask.height), x = L.getContext('2d')
  const target = lumOf(col), k = Math.max(0, Math.min(1, strength))
  const layer = (fill, mode, alpha) => {
    x.globalCompositeOperation = 'copy'; x.fillStyle = fill; x.fillRect(0, 0, L.width, L.height)
    x.globalCompositeOperation = 'destination-in'; x.drawImage(mask, 0, 0)
    c.save(); c.globalCompositeOperation = mode; c.globalAlpha = alpha; c.imageSmoothingEnabled = true; c.imageSmoothingQuality = 'high'; c.drawImage(L, opts.dx || 0, opts.dy || 0, w, h); c.restore()
  }
  if (lum != null && lum > 0.02) {
    const g = (v) => { const q = Math.round(Math.max(0, Math.min(1, v)) * 255); return `rgb(${q},${q},${q})` }
    if (target < lum) layer(g(Math.max(opts.minScale ?? 0.18, target / lum)), 'multiply', k) // darker shade: scale pixels down
    else if (target > lum) layer(g(1 - (1 - target) / Math.max(0.02, 1 - lum)), 'screen', k * (opts.lighten ?? 0.85)) // lighter shade
  }
  layer(col, 'color', k) // hue and saturation of the shade, the pixel keeps its own (now adjusted) lightness
  if (opts.richness) layer(col, 'soft-light', k * opts.richness) // a little extra depth of colour
}
