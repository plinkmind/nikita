// The backend application: one function, Request in -> Response out (web-standard objects).
// It runs unchanged inside a Netlify Function (netlify/functions/api.mjs), in a plain Node server (backend/server.js) and inside
// the Vite dev server (vite.config.js), so local development behaves like production.
import { loadConfig } from './config.js'
import { createStorage } from './db/storage.js'
import { models as makeModels } from './db/models.js'
import { authService } from './services/auth.js'
import { tryonService } from './services/tryon.js'
import { match } from './routes.js'
import { ApiError, json, clientIp } from './http.js'
import { corsHeaders, preflight, checkCsrf, rateLimit } from './middleware/security.js'
import { identify } from './middleware/auth.js'

export async function createApp(options = {}) {
  const cfg = options.config || loadConfig(options.env)
  const storage = options.storage || (await createStorage(cfg))
  const models = makeModels(storage)
  const services = { auth: authService(models, cfg), tryon: tryonService(models, storage, cfg) }
  const log = options.logger || console

  async function handle(req) {
    const url = new URL(req.url)
    if (!url.pathname.startsWith('/api/')) return json(404, { error: { code: 'not_found', message: 'Not found.' } })
    if (req.method === 'OPTIONS') return preflight(req, cfg)
    const cors = corsHeaders(req, cfg)
    const cookies = []
    const ctx = { req, cfg, storage, models, services, params: {}, ip: clientIp(req, cfg.security.trustProxy), setCookie: (c) => cookies.push(c) }
    let res
    try {
      if (!cors.ok && req.method !== 'GET') throw new ApiError(403, 'origin_not_allowed', 'This website is not allowed to use this API.')
      const r = match(req.method, url.pathname)
      if (!r.handler) throw new ApiError(r.methodNotAllowed ? 405 : 404, r.methodNotAllowed ? 'method_not_allowed' : 'not_found', r.methodNotAllowed ? 'This method is not allowed here.' : 'Not found.')
      ctx.params = r.params
      checkCsrf(req, cfg)
      if (req.method !== 'GET' && req.method !== 'HEAD') await rateLimit(models, 'api', ctx.ip, cfg.limits.apiPerIp)
      await identify(req, ctx)
      res = await r.handler(ctx)
    } catch (e) {
      if (e instanceof ApiError) res = json(e.status, { error: { code: e.code, message: e.message, ...(e.extra || {}) } }, e.extra?.retryAfter ? { 'retry-after': String(e.extra.retryAfter) } : {})
      else {
        // unexpected error: log the details on the server, show the user only a safe, general message
        log.error?.(`[api] ${req.method} ${url.pathname} failed: ${e?.stack || e}`)
        res = json(500, { error: { code: 'server_error', message: 'Something went wrong on our side. Please try again.' } })
      }
    }
    for (const [k, v] of Object.entries(cors.headers)) res.headers.set(k, v)
    for (const c of cookies) res.headers.append('set-cookie', c)
    return res
  }

  // housekeeping, called by the scheduled function / timer
  async function cleanup() {
    const stats = await services.tryon.cleanup()
    let sessions = 0
    for (const k of await storage.db.list('sessions/')) { const s = await storage.db.getJSON(k); if (!s || Date.parse(s.expiresAt) < Date.now()) { await storage.db.delete(k); if (s) await storage.db.delete(`user-sessions/${s.userId}/${k.split('/').pop()}`); sessions++ } }
    return { ...stats, sessions }
  }

  return { handle, cleanup, cfg, storage, models, services }
}

// one shared app per running instance (Netlify reuses warm instances, so storage clients are created once)
let shared = null
export const getApp = (options) => (shared ||= createApp(options))
