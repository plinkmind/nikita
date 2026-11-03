// Security middleware: CORS, CSRF protection and a general per-IP rate limit.
//
// CORS: the API answers browsers from this website only (same origin), plus any origins listed in ALLOWED_ORIGINS.
// CSRF: every request that changes something (POST / PATCH / DELETE) must carry the header "X-Requested-With: glamify".
//       Browsers only let other websites send custom headers after a CORS check, which fails for them, so a malicious page
//       cannot make a signed-in visitor's browser change anything here. Session cookies are also SameSite=Lax.
import { ApiError, json } from '../http.js'

export function corsHeaders(req, cfg) {
  const origin = req.headers.get('origin')
  if (!origin) return { ok: true, headers: {} }
  const self = new URL(req.url).origin
  if (origin === self) return { ok: true, headers: {} }
  if (cfg.security.allowedOrigins.includes(origin)) {
    return { ok: true, headers: { 'access-control-allow-origin': origin, 'access-control-allow-credentials': 'true', vary: 'origin' } }
  }
  return { ok: false, headers: {} }
}

export function preflight(req, cfg) {
  const c = corsHeaders(req, cfg)
  if (!c.ok) return json(403, { error: { code: 'origin_not_allowed', message: 'This website is not allowed to use this API.' } })
  return new Response(null, { status: 204, headers: { ...c.headers, 'access-control-allow-methods': 'GET, POST, PATCH, DELETE, OPTIONS', 'access-control-allow-headers': 'content-type, x-requested-with', 'access-control-max-age': '600' } })
}

export function checkCsrf(req, cfg) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return
  const c = corsHeaders(req, cfg)
  if (!c.ok) throw new ApiError(403, 'origin_not_allowed', 'This website is not allowed to use this API.')
  if ((req.headers.get('x-requested-with') || '').toLowerCase() !== 'glamify') throw new ApiError(403, 'csrf', 'This request was blocked for your security. Please reload the page and try again.')
}

export async function rateLimit(models, bucket, key, [max, win]) {
  const r = await models.RateLimit.hit(bucket, key, max, win)
  if (!r.ok) throw new ApiError(429, 'rate_limited', `Too many attempts. Please wait ${r.retryAfter > 90 ? `about ${Math.ceil(r.retryAfter / 60)} minutes` : `${r.retryAfter} seconds`} and try again.`, { retryAfter: r.retryAfter })
}
