// Configuration: every setting comes from environment variables (never from code), with safe defaults.
// See .env.example for the full list. Secrets (API keys) are only read here, on the server, and never sent to the browser.

const num = (v, def, min = -Infinity, max = Infinity) => { if (v === undefined || v === null || String(v).trim() === '') return def; const n = Number(v); return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : def }
const bool = (v, def) => (v === undefined || v === '' ? def : /^(1|true|yes|on)$/i.test(String(v)))
const list = (v) => String(v || '').split(',').map((s) => s.trim()).filter(Boolean)

// reads process.env, or Netlify.env when running inside a Netlify Function
export function readEnv() {
  const out = { ...(typeof process !== 'undefined' ? process.env : {}) }
  try { const n = globalThis.Netlify?.env?.toObject?.(); if (n) Object.assign(out, n) } catch { /* not on Netlify */ }
  return out
}

export function loadConfig(env = readEnv()) {
  const onNetlify = !!(env.NETLIFY || env.NETLIFY_BLOBS_CONTEXT || globalThis.Netlify)
  const production = env.NODE_ENV === 'production' || env.CONTEXT === 'production' || onNetlify
  const cfg = {
    version: '1.0.0',
    production,
    onNetlify,
    // where data lives: "blobs" (Netlify Blobs) or "fs" (a local folder). Default: blobs on Netlify, fs elsewhere.
    storage: {
      driver: (env.STORAGE_DRIVER || (onNetlify ? 'blobs' : 'fs')).toLowerCase(),
      dir: env.DATA_DIR || '.data',
      // only needed to use Netlify Blobs from OUTSIDE Netlify (tests, another host); inside Netlify it is automatic
      blobs: env.BLOBS_SITE_ID ? { siteID: env.BLOBS_SITE_ID, token: env.BLOBS_TOKEN, ...(env.BLOBS_EDGE_URL ? { edgeURL: env.BLOBS_EDGE_URL, uncachedEdgeURL: env.BLOBS_EDGE_URL } : {}), ...(env.BLOBS_API_URL ? { apiURL: env.BLOBS_API_URL } : {}) } : null,
      prefix: env.STORE_PREFIX || 'glamify',
    },
    security: {
      // other websites allowed to call this API with cookies (the site itself is always allowed)
      allowedOrigins: list(env.ALLOWED_ORIGINS),
      // cookies get the Secure flag in production (https). Local http://localhost works without it.
      secureCookies: bool(env.SECURE_COOKIES, production),
      sessionDays: num(env.SESSION_DAYS, 30, 1, 365),
      trustProxy: bool(env.TRUST_PROXY, onNetlify),
    },
    limits: {
      maxImageBytes: num(env.MAX_IMAGE_BYTES, 4_000_000, 100_000, 20_000_000), // per image (Netlify allows about 4.5 MB per request)
      maxRequestBytes: num(env.MAX_REQUEST_BYTES, 4_500_000, 200_000, 40_000_000),
      minImageSide: num(env.MIN_IMAGE_SIDE, 256, 64, 2000),
      maxImageSide: num(env.MAX_IMAGE_SIDE, 6000, 1000, 20000),
      // rate limits: [max requests, window in seconds]
      generatePerOwner: [num(env.RATE_GENERATE_MAX, 8, 1), num(env.RATE_GENERATE_WINDOW, 600, 10)],
      generatePerIp: [num(env.RATE_GENERATE_IP_MAX, 20, 1), 600],
      loginPerIp: [num(env.RATE_LOGIN_MAX, 10, 1), 900],
      registerPerIp: [num(env.RATE_REGISTER_MAX, 5, 1), 3600],
      apiPerIp: [num(env.RATE_API_MAX, 600, 10), 300],
    },
    retention: {
      // generated results: signed-in users keep them until they delete them, at most this many days (0 = forever)
      resultDays: num(env.RESULT_RETENTION_DAYS, 30, 0, 3650),
      // guests (not signed in): results and history are removed after this many hours
      guestHours: num(env.GUEST_RETENTION_HOURS, 24, 1, 24 * 30),
      // uploaded photos are only kept while the AI works; anything older than this is removed by the clean-up job
      inputMinutes: num(env.INPUT_RETENTION_MINUTES, 60, 5, 24 * 60),
      // a job that never finishes is marked failed after this many minutes
      jobTimeoutMinutes: num(env.JOB_TIMEOUT_MINUTES, 10, 2, 120),
    },
    providers: {
      // outfit provider: "fashn" (paid, server-side), "free" (IDM-VTON on Hugging Face, in the visitor's browser) or "auto"
      outfit: (env.TRYON_PROVIDER || 'auto').toLowerCase(),
      freeEnabled: bool(env.FREE_TRYON, true),
      freeSpace: env.FREE_TRYON_SPACE || 'yisol/IDM-VTON',
      fashn: { key: env.FASHN_API_KEY || '', base: env.FASHN_BASE || 'https://api.fashn.ai/v1', model: env.FASHN_MODEL || 'tryon-v1.6', mode: env.FASHN_MODE || 'quality' },
      replicate: { token: env.REPLICATE_API_TOKEN || '', base: env.REPLICATE_BASE || 'https://api.replicate.com/v1', hairModel: env.REPLICATE_HAIR_MODEL || 'black-forest-labs/flux-kontext-pro' },
      timeoutMs: num(env.PROVIDER_TIMEOUT_MS, 20_000, 2000, 55_000),
      // a status request asks the AI service at most this often per job (protects the provider's rate limit)
      checkIntervalMs: num(env.PROVIDER_CHECK_MS, 1500, 0, 60_000),
    },
  }
  if (!['blobs', 'fs', 'memory'].includes(cfg.storage.driver)) throw new Error(`STORAGE_DRIVER must be blobs, fs or memory (got "${cfg.storage.driver}")`)
  return cfg
}
