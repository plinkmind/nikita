// Small HTTP helpers built on the web-standard Request / Response (works the same in Netlify Functions and in Node).

export class ApiError extends Error {
  // status: HTTP status code; code: short machine-readable reason; message: safe to show to the user
  constructor(status, code, message, extra) { super(message); this.status = status; this.code = code; this.extra = extra }
}
export const bad = (code, message, extra) => new ApiError(400, code, message, extra)
export const unauthorized = (message = 'Please sign in first.') => new ApiError(401, 'unauthorized', message)
export const forbidden = (message = 'You are not allowed to do that.') => new ApiError(403, 'forbidden', message)
export const notFound = (message = 'Not found.') => new ApiError(404, 'not_found', message)

const BASE_HEADERS = {
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
  'x-frame-options': 'DENY',
  'cross-origin-resource-policy': 'same-origin',
}

export function json(status, body, headers = {}) {
  return new Response(status === 204 ? null : JSON.stringify(body), {
    status, headers: { ...BASE_HEADERS, 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers },
  })
}
export function binary(bytes, mime, headers = {}) {
  return new Response(bytes, {
    status: 200,
    headers: { ...BASE_HEADERS, 'content-type': mime, 'content-length': String(bytes.byteLength), 'cache-control': 'private, max-age=300', 'content-security-policy': "default-src 'none'; sandbox", ...headers },
  })
}

// ---- cookies ----
export function parseCookies(req) {
  const out = {}
  for (const part of (req.headers.get('cookie') || '').split(';')) {
    const i = part.indexOf('='); if (i < 0) continue
    const k = part.slice(0, i).trim(); if (!k || k in out) continue
    try { out[k] = decodeURIComponent(part.slice(i + 1).trim()) } catch { /* ignore malformed */ }
  }
  return out
}
export function cookie(name, value, { maxAge, secure, httpOnly = true, sameSite = 'Lax', path = '/' } = {}) {
  let c = `${name}=${encodeURIComponent(value)}; Path=${path}; SameSite=${sameSite}`
  if (maxAge !== undefined) c += `; Max-Age=${Math.floor(maxAge)}`
  if (httpOnly) c += '; HttpOnly'
  if (secure) c += '; Secure'
  return c
}

// ---- request bodies (always size-limited before parsing) ----
export async function readBytes(req, limit) {
  const declared = Number(req.headers.get('content-length') || 0)
  if (declared > limit) throw new ApiError(413, 'too_large', `The upload is too large (the limit is ${Math.round(limit / 1e5) / 10} MB).`)
  if (!req.body) return new Uint8Array(0)
  const reader = req.body.getReader(), chunks = []; let total = 0
  for (;;) {
    const { done, value } = await reader.read(); if (done) break
    total += value.byteLength
    if (total > limit) { try { await reader.cancel() } catch { /* ignore */ } throw new ApiError(413, 'too_large', `The upload is too large (the limit is ${Math.round(limit / 1e5) / 10} MB).`) }
    chunks.push(value)
  }
  const out = new Uint8Array(total); let o = 0
  for (const c of chunks) { out.set(c, o); o += c.byteLength }
  return out
}
export async function readJson(req, limit = 32 * 1024) {
  if (!/application\/json/i.test(req.headers.get('content-type') || '')) throw bad('bad_content_type', 'Expected a JSON request.')
  const bytes = await readBytes(req, limit)
  try { const v = JSON.parse(new TextDecoder().decode(bytes) || '{}'); if (!v || typeof v !== 'object' || Array.isArray(v)) throw 0; return v } catch { throw bad('bad_json', 'The request could not be read.') }
}
export async function readForm(req, limit) {
  const ct = req.headers.get('content-type') || ''
  if (!/^multipart\/form-data/i.test(ct)) throw bad('bad_content_type', 'Expected a file upload (multipart/form-data).')
  const bytes = await readBytes(req, limit)
  try { return await new Response(bytes, { headers: { 'content-type': ct } }).formData() } catch { throw bad('bad_form', 'The upload could not be read. Please try again.') }
}

export function clientIp(req, trustProxy) {
  if (trustProxy) {
    const v = req.headers.get('x-nf-client-connection-ip') || (req.headers.get('x-forwarded-for') || '').split(',')[0].trim()
    if (v) return v.slice(0, 64)
  }
  return (req.headers.get('x-real-client-ip') || 'local').slice(0, 64) // set by backend/server.js from the socket address
}
