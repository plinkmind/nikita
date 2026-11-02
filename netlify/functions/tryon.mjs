// AI photo try-on as a NETLIFY FUNCTION: runs inside your Netlify site, so there is no separate server to deploy.
// You only add API keys in Netlify > Site configuration > Environment variables:
//   FASHN_API_KEY          -> AI outfits   (FASHN tryon-v1.6, https://fashn.ai, paid per image)
//   REPLICATE_API_TOKEN    -> AI hairstyles (FLUX.1 Kontext [pro] image editing on https://replicate.com, paid per image)
// Optional: REPLICATE_HAIR_MODEL (default black-forest-labs/flux-kontext-pro), FASHN_MODE (quality|balanced|performance),
//           ALLOWED_ORIGINS (comma separated; default = this site only), RATE_MAX (per IP per 10 min, default 8).
//
// Both providers are asynchronous (start a job, then ask for its status), so this function never waits for the AI:
//   POST   /api/tryon        -> starts the job at the provider, returns { jobId }
//   GET    /api/tryon/:id    -> asks the provider for the status, returns the image when ready
//   DELETE /api/tryon/:id    -> cancels
//   GET    /api/health       -> which modes are set up (the page shows "not available" honestly if a key is missing)
// Photos are passed straight to the provider and never stored by this function. Keys never reach the browser.
import { STYLES, COLOURS, hairPrompt } from '../../server/prompts.js'

const env = (k) => (globalThis.Netlify?.env?.get?.(k) ?? process.env[k] ?? '').trim()
const FASHN = () => env('FASHN_BASE') || 'https://api.fashn.ai/v1'
const REPLICATE = () => env('REPLICATE_BASE') || 'https://api.replicate.com/v1'
const MAX_IMG = 8 * 1024 * 1024
const hits = new Map() // per-instance rate limit (serverless instances are short-lived: also set a spending limit at the provider)

const json = (code, obj) => new Response(JSON.stringify(obj), { status: code, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } })
const fail = (code, msg, extra = {}) => json(code, { error: msg, ...extra })

function originOk(req) {
  const o = req.headers.get('origin'); if (!o) return true // same-origin GET requests may omit it
  const allowed = env('ALLOWED_ORIGINS').split(',').map((s) => s.trim()).filter(Boolean)
  if (allowed.length) return allowed.includes(o)
  try { return new URL(o).host === new URL(req.url).host } catch { return false }
}
function limited(req) {
  const ip = req.headers.get('x-nf-client-connection-ip') || req.headers.get('x-forwarded-for') || 'x', now = Date.now(), win = 10 * 60_000
  const a = (hits.get(ip) || []).filter((t) => now - t < win); a.push(now); hits.set(ip, a)
  return a.length > (+env('RATE_MAX') || 8)
}
function image(v, what) { // data URL -> validated data URL (JPEG/PNG only, size limit)
  if (typeof v !== 'string') throw Object.assign(new Error(`${what} is missing`), { status: 400 })
  const b64 = v.replace(/^data:image\/[a-z+]+;base64,/i, ''), buf = Buffer.from(b64, 'base64')
  if (!buf.length || buf.length > MAX_IMG) throw Object.assign(new Error(`${what} must be smaller than 8 MB`), { status: 400 })
  const mime = buf[0] === 0xff && buf[1] === 0xd8 ? 'image/jpeg' : buf.subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47])) ? 'image/png' : null
  if (!mime) throw Object.assign(new Error(`${what} must be a JPEG or PNG image`), { status: 400 })
  return `data:${mime};base64,${b64}`
}
async function call(url, init, timeoutMs = 20_000) {
  const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), timeoutMs)
  try {
    const r = await fetch(url, { ...init, signal: ctl.signal }), j = await r.json().catch(() => null)
    if (!r.ok) throw Object.assign(new Error(j?.error?.message || j?.detail || j?.error || `provider error ${r.status}`), { code: r.status === 401 || r.status === 403 ? 'permission' : r.status === 402 ? 'billing' : r.status === 429 ? 'quota' : 'upstream' })
    return j
  } catch (e) { if (e.name === 'AbortError') throw Object.assign(new Error('timeout'), { code: 'timeout' }); throw e } finally { clearTimeout(t) }
}
const friendly = {
  permission: 'The AI service rejected the API key. The site owner needs to check the key in Netlify.', billing: 'The AI service account has no credit left. The site owner needs to top it up.',
  quota: 'The AI service is busy or at its limit. Please try again in a minute.', timeout: 'The AI service did not answer in time. Please try again.',
  pose: 'The AI could not find a body pose in your photo. Use a clear, front-facing photo showing your upper body.', input: 'The AI could not use one of the photos. Try a clear JPG or PNG.',
  blocked: 'The AI service declined this photo.', upstream: 'The AI service could not finish this try-on. Please try again.',
}
const toB64 = async (url) => { const r = await fetch(url); if (!r.ok) throw Object.assign(new Error('download failed'), { code: 'upstream' }); return { mimeType: r.headers.get('content-type') || 'image/jpeg', base64: Buffer.from(await r.arrayBuffer()).toString('base64') } }

// ---- providers ----
const fashnH = () => ({ authorization: `Bearer ${env('FASHN_API_KEY')}`, 'content-type': 'application/json' })
async function startOutfit(person, garment) {
  const j = await call(`${FASHN()}/run`, { method: 'POST', headers: fashnH(), body: JSON.stringify({ model_name: env('FASHN_MODEL') || 'tryon-v1.6', inputs: {
    model_image: person, garment_image: garment, category: 'auto', garment_photo_type: 'auto', mode: env('FASHN_MODE') || 'quality',
    segmentation_free: true, moderation_level: 'permissive', num_samples: 1, output_format: 'jpeg', return_base64: true } }) })
  if (!j?.id) throw Object.assign(new Error(j?.error?.message || 'no job id'), { code: 'upstream' })
  return 'f_' + j.id
}
async function statusOutfit(id) {
  const st = await call(`${FASHN()}/status/${encodeURIComponent(id)}`, { headers: fashnH() })
  if (st.status === 'completed') {
    const out = st.output?.[0]; if (!out) return { status: 'error', code: 'upstream' }
    const m = /^data:([^;]+);base64,(.*)$/.exec(out)
    return { status: 'done', result: m ? { mimeType: m[1], base64: m[2] } : await toB64(out) }
  }
  if (st.status === 'failed' || st.status === 'canceled') {
    const n = st.error?.name || ''
    return { status: 'error', code: n === 'PoseError' ? 'pose' : n === 'NSFWError' ? 'blocked' : ['ImageLoadError', 'InputValidationError', 'PhotoTypeError'].includes(n) ? 'input' : 'upstream' }
  }
  return { status: 'running', stage: st.status } // starting | in_queue | processing
}
const repH = () => ({ authorization: `Bearer ${env('REPLICATE_API_TOKEN')}`, 'content-type': 'application/json' })
async function startHair(person, style, colour) {
  const model = env('REPLICATE_HAIR_MODEL') || 'black-forest-labs/flux-kontext-pro'
  const j = await call(`${REPLICATE()}/models/${model}/predictions`, { method: 'POST', headers: repH(), body: JSON.stringify({ input: {
    prompt: hairPrompt(style, colour), input_image: person, aspect_ratio: 'match_input_image', output_format: 'jpg', safety_tolerance: 2 } }) })
  if (!j?.id) throw Object.assign(new Error(j?.detail || 'no job id'), { code: 'upstream' })
  return 'r_' + j.id
}
async function statusHair(id) {
  const st = await call(`${REPLICATE()}/predictions/${encodeURIComponent(id)}`, { headers: repH() })
  if (st.status === 'succeeded') { const out = Array.isArray(st.output) ? st.output[0] : st.output; return out ? { status: 'done', result: await toB64(out) } : { status: 'error', code: 'upstream' } }
  if (st.status === 'failed' || st.status === 'canceled') return { status: 'error', code: /nsfw|safety|flagged/i.test(st.error || '') ? 'blocked' : 'upstream' }
  return { status: 'running', stage: st.status } // starting | processing
}

export default async (req) => {
  try {
    if (!originOk(req)) return fail(403, 'This website is not allowed to use this service')
    const url = new URL(req.url), outfitReady = !!env('FASHN_API_KEY'), hairReady = !!env('REPLICATE_API_TOKEN')
    if (url.pathname === '/api/health') {
      return json(200, { ok: true, configured: outfitReady || hairReady, outfit: { ready: outfitReady, provider: 'fashn', model: env('FASHN_MODEL') || 'tryon-v1.6' }, hair: { ready: hairReady, provider: 'replicate', model: env('REPLICATE_HAIR_MODEL') || 'black-forest-labs/flux-kontext-pro', styles: Object.keys(STYLES), colours: Object.keys(COLOURS) } })
    }
    if (url.pathname === '/api/tryon' && req.method === 'POST') {
      let body; try { body = await req.json() } catch { return fail(400, 'Invalid request') }
      if (body.consent !== true) return fail(400, 'Consent is required before a photo can be processed', { code: 'consent' })
      const type = body.type
      if (type !== 'outfit' && type !== 'hair') return fail(400, 'Unknown try-on type')
      if ((type === 'outfit' && !outfitReady) || (type === 'hair' && !hairReady)) return fail(501, `AI ${type === 'outfit' ? 'outfit' : 'hairstyle'} try-on is not set up yet`, { code: 'not_configured' })
      const person = image(body.person, 'Your photo')
      if (type === 'hair') {
        if (!STYLES[body.style]) return fail(400, 'Unknown hairstyle'); if (body.colour && !(body.colour in COLOURS)) return fail(400, 'Unknown hair colour')
      }
      if (limited(req)) return fail(429, 'Too many requests. Please wait a few minutes and try again.', { code: 'rate' })
      const jobId = type === 'outfit' ? await startOutfit(person, image(body.garment, 'The garment image')) : await startHair(person, STYLES[body.style], COLOURS[body.colour || 'natural'])
      return json(202, { jobId })
    }
    const m = url.pathname.match(/^\/api\/tryon\/([fr])_([A-Za-z0-9_-]{4,80})$/)
    if (m) {
      const [, kind, id] = m
      if (req.method === 'DELETE') { // best effort cancel
        try { if (kind === 'f') await call(`${FASHN()}/cancel/${id}`, { headers: fashnH() }); else await call(`${REPLICATE()}/predictions/${id}/cancel`, { method: 'POST', headers: repH() }) } catch { /* already finished */ }
        return json(200, { ok: true })
      }
      const r = kind === 'f' ? await statusOutfit(id) : await statusHair(id)
      return json(200, r.status === 'error' ? { status: 'error', code: r.code, error: friendly[r.code] || friendly.upstream } : r)
    }
    return fail(404, 'Not found')
  } catch (e) {
    if (e.status) return fail(e.status, e.message)
    console.error('tryon error', e.code || '', e.message) // never logs photos
    return fail(502, friendly[e.code] || friendly.upstream, { code: e.code || 'upstream' })
  }
}

export const config = { path: ['/api/health', '/api/tryon', '/api/tryon/*'] }
