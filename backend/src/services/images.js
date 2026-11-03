// Image validation and private image storage.
// Validation looks at the actual file bytes ("magic numbers"), never at the file name or the browser's claimed type,
// and reads the real width/height from the file header. Only JPEG, PNG and WebP are accepted.
import { bad, ApiError } from '../http.js'

export function sniff(b) {
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg'
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 && b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a) return 'image/png'
  if (b.length >= 16 && String.fromCharCode(...b.subarray(0, 4)) === 'RIFF' && String.fromCharCode(...b.subarray(8, 12)) === 'WEBP') return 'image/webp'
  return null
}

export function dimensions(b, mime) {
  try {
    if (mime === 'image/png') { const v = new DataView(b.buffer, b.byteOffset, b.byteLength); return { width: v.getUint32(16), height: v.getUint32(20) } }
    if (mime === 'image/webp') {
      const tag = String.fromCharCode(...b.subarray(12, 16))
      if (tag === 'VP8 ') return { width: (b[26] | (b[27] << 8)) & 0x3fff, height: (b[28] | (b[29] << 8)) & 0x3fff }
      if (tag === 'VP8L') { const [b0, b1, b2, b3] = b.subarray(21, 25); return { width: 1 + (((b1 & 0x3f) << 8) | b0), height: 1 + (((b3 & 0xf) << 10) | (b2 << 2) | ((b1 & 0xc0) >> 6)) } }
      if (tag === 'VP8X') return { width: 1 + (b[24] | (b[25] << 8) | (b[26] << 16)), height: 1 + (b[27] | (b[28] << 8) | (b[29] << 16)) }
      return null
    }
    if (mime === 'image/jpeg') { // walk the JPEG markers until a "start of frame" marker, which holds the size
      let i = 2
      while (i + 9 < b.length) {
        if (b[i] !== 0xff) { i++; continue }
        const m = b[i + 1]
        if (m === 0xff) { i++; continue }
        if (m === 0xd8 || m === 0x01 || (m >= 0xd0 && m <= 0xd7)) { i += 2; continue }
        const len = (b[i + 2] << 8) | b[i + 3]
        if ((m >= 0xc0 && m <= 0xc3) || (m >= 0xc5 && m <= 0xc7) || (m >= 0xc9 && m <= 0xcb) || (m >= 0xcd && m <= 0xcf)) return { height: (b[i + 5] << 8) | b[i + 6], width: (b[i + 7] << 8) | b[i + 8] }
        if (m === 0xd9 || len < 2) return null
        i += 2 + len
      }
    }
  } catch { /* fall through */ }
  return null
}

// value: a File/Blob from a multipart form. Returns { bytes, mime, width, height }.
export async function validateImage(value, what, limits) {
  if (!value || typeof value === 'string' || typeof value.arrayBuffer !== 'function') throw bad('missing_image', `${what} is missing.`)
  if (value.size > limits.maxImageBytes) throw new ApiError(413, 'image_too_large', `${what} is larger than ${Math.round(limits.maxImageBytes / 1e5) / 10} MB. Please use a smaller photo.`)
  const bytes = new Uint8Array(await value.arrayBuffer())
  if (bytes.length < 100) throw bad('bad_image', `${what} is empty or damaged.`)
  const mime = sniff(bytes)
  if (!mime) throw bad('bad_image_type', `${what} must be a JPG, PNG or WebP image.`)
  const d = dimensions(bytes, mime)
  if (!d || !d.width || !d.height) throw bad('bad_image', `${what} could not be read. Please try another photo.`)
  if (Math.min(d.width, d.height) < limits.minImageSide) throw bad('image_too_small', `${what} is too small (${d.width} x ${d.height}). Use one at least ${limits.minImageSide} pixels on each side.`)
  if (Math.max(d.width, d.height) > limits.maxImageSide) throw bad('image_too_big', `${what} is too big (${d.width} x ${d.height}). Use one at most ${limits.maxImageSide} pixels on its longest side.`)
  return { bytes, mime, ...d }
}

// bytes returned by an AI provider are checked the same way before they are stored or shown
export function validateResultBytes(bytes) {
  const mime = sniff(bytes); const d = mime && dimensions(bytes, mime)
  if (!mime || !d) throw new ApiError(502, 'provider_bad_image', 'The AI service returned something that is not an image.')
  return { bytes, mime, ...d }
}

export const toDataUri = (img) => `data:${img.mime};base64,${Buffer.from(img.bytes).toString('base64')}`
export function fromDataUri(uri) {
  const m = /^data:([^;,]+);base64,(.+)$/s.exec(uri || ''); if (!m) return null
  return new Uint8Array(Buffer.from(m[2], 'base64'))
}

// private file keys: <owner>/<jobId>/<kind>
export const fileKey = (owner, jobId, kind) => `${owner}/${jobId}/${kind}`
