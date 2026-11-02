// Glamify XR AI photo try-on server. No dependencies (Node 18+).
// Privacy: photos are held in memory only while a job runs. They are never written to disk or logged, and results are deleted after
// they are delivered (or after 10 minutes). A request is refused unless the person explicitly consented in the request.
import http from 'node:http'
import crypto from 'node:crypto'
import { hasGoogleAuth } from './google.js'
import { outfitTryOn, outfitProvider, hairEdit, STYLES, COLOURS } from './providers.js'

const MAX_IMG = 8 * 1024 * 1024 // decoded bytes per image (Google's try-on limit is 10 MB)

export function createServer(env = process.env) {
  const origins = (env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean)
  const maxConcurrent = +env.MAX_CONCURRENT || 3, rateMax = +env.RATE_MAX || 6, rateWindow = +env.RATE_WINDOW_MS || 10 * 60_000, ttl = +env.RESULT_TTL_MS || 10 * 60_000
  const jobs = new Map(), hits = new Map()
  const outfitReady = outfitProvider(env) === 'fashn' ? !!env.FASHN_API_KEY : hasGoogleAuth(env)
  const hairReady = hasGoogleAuth(env)
  const configured = outfitReady || hairReady

  const cors = (req, res) => {
    const o = req.headers.origin
    if (o && origins.includes(o)) { res.setHeader('access-control-allow-origin', o); res.setHeader('vary', 'origin'); res.setHeader('access-control-allow-headers', 'content-type'); res.setHeader('access-control-allow-methods', 'GET,POST,DELETE,OPTIONS') }
    return !o || origins.includes(o)
  }
  const send = (res, code, obj) => { res.writeHead(code, { 'content-type': 'application/json', 'cache-control': 'no-store' }); res.end(JSON.stringify(obj)) }
  const limited = (ip) => { const now = Date.now(), a = (hits.get(ip) || []).filter((t) => now - t < rateWindow); a.push(now); hits.set(ip, a); return a.length > rateMax }
  const readBody = (req, limit) => new Promise((ok, no) => {
    const chunks = []; let n = 0
    req.on('data', (c) => { n += c.length; if (n > limit) { no(Object.assign(new Error('Request too large'), { status: 413 })); req.destroy() } else chunks.push(c) })
    req.on('end', () => ok(Buffer.concat(chunks).toString('utf8'))); req.on('error', no)
  })
  // accepts a data URL or plain base64; checks it is really a JPEG or PNG and not too big
  const image = (v, what) => {
    if (typeof v !== 'string') throw bad(`${what} is missing`)
    const b64 = v.replace(/^data:image\/[a-z+]+;base64,/i, ''), buf = Buffer.from(b64, 'base64')
    if (!buf.length || buf.length > MAX_IMG) throw bad(`${what} must be smaller than 8 MB`)
    const mime = buf[0] === 0xff && buf[1] === 0xd8 ? 'image/jpeg' : buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) ? 'image/png' : null
    if (!mime) throw bad(`${what} must be a JPEG or PNG image`)
    return { b64, mime, bytes: buf.length }
  }
  const bad = (m) => Object.assign(new Error(m), { status: 400 })
  const sweep = setInterval(() => { const now = Date.now(); for (const [id, j] of jobs) if (now - j.created > ttl) jobs.delete(id) }, 30_000); sweep.unref?.()

  const server = http.createServer(async (req, res) => {
    try {
      if (!cors(req, res)) return send(res, 403, { error: 'This website is not allowed to use this server' })
      if (req.method === 'OPTIONS') { res.writeHead(204); return res.end() }
      const url = new URL(req.url, 'http://x'), ip = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').toString().split(',')[0].trim()
      if (req.method === 'GET' && url.pathname === '/api/health') {
        return send(res, 200, { ok: true, configured, outfit: { ready: outfitReady, provider: outfitProvider(env), model: outfitProvider(env) === 'fashn' ? env.FASHN_MODEL || 'tryon-v1.6' : env.TRYON_MODEL || 'virtual-try-on-001' }, hair: { ready: hairReady, model: env.HAIR_MODEL || 'gemini-2.5-flash-image', styles: Object.keys(STYLES), colours: Object.keys(COLOURS) }, limits: { imageMB: 8, perWindow: rateMax, windowMinutes: rateWindow / 60000 } })
      }
      if (req.method === 'POST' && url.pathname === '/api/tryon') {
        if (!configured) return send(res, 501, { error: 'AI photo try-on is not set up on this server yet', code: 'not_configured' })
        if (limited(ip)) return send(res, 429, { error: 'Too many requests. Please wait a few minutes and try again.', code: 'rate' })
        let body; try { body = JSON.parse(await readBody(req, 14 * 1024 * 1024)) } catch (e) { return send(res, e.status || 400, { error: e.status === 413 ? 'The photos are too large' : 'Invalid request' }) }
        if (body.consent !== true) return send(res, 400, { error: 'Consent is required before a photo can be processed', code: 'consent' })
        const type = body.type, person = image(body.person, 'Your photo')
        if ((type === 'outfit' && !outfitReady) || (type === 'hair' && !hairReady)) return send(res, 501, { error: `AI ${type === 'outfit' ? 'outfit' : 'hairstyle'} try-on is not set up on this server yet`, code: 'not_configured' })
        let work
        if (type === 'outfit') { const garment = image(body.garment, 'The garment image'); work = () => outfitTryOn(env, { person, garment }) }
        else if (type === 'hair') {
          if (!STYLES[body.style]) throw bad('Unknown hairstyle'); if (body.colour && !(body.colour in COLOURS)) throw bad('Unknown hair colour')
          work = () => hairEdit(env, { person, styleId: body.style, colourId: body.colour || 'natural' })
        } else throw bad('Unknown try-on type')
        if ([...jobs.values()].filter((j) => j.status === 'running').length >= maxConcurrent) return send(res, 503, { error: 'The AI service is busy. Please try again in a minute.', code: 'busy' })
        const id = crypto.randomUUID(), job = { status: 'running', created: Date.now(), type }
        jobs.set(id, job)
        work().then((r) => { job.status = 'done'; job.result = r }).catch((e) => { job.status = 'error'; job.error = friendly(e); job.code = e.code || 'error'; console.error(`job ${id} failed: ${e.code || ''} ${e.message}`) }).finally(() => { job.done = Date.now() })
        console.log(`job ${id} started (${type}, ${person.bytes} bytes)`) // never log the photo itself
        return send(res, 202, { jobId: id })
      }
      const m = url.pathname.match(/^\/api\/tryon\/([0-9a-f-]{36})$/)
      if (m) {
        const job = jobs.get(m[1]); if (!job) return send(res, 404, { error: 'Result not found or already collected', code: 'gone' })
        if (req.method === 'DELETE') { jobs.delete(m[1]); return send(res, 200, { ok: true }) }
        if (req.method === 'GET') {
          if (job.status === 'running') return send(res, 200, { status: 'running', elapsedMs: Date.now() - job.created })
          jobs.delete(m[1]) // delivered once, then removed
          return job.status === 'done' ? send(res, 200, { status: 'done', result: job.result, elapsedMs: job.done - job.created }) : send(res, 200, { status: 'error', error: job.error, code: job.code })
        }
      }
      send(res, 404, { error: 'Not found' })
    } catch (e) { send(res, e.status || 500, { error: e.status ? e.message : 'Something went wrong on the server' }) }
  })
  server.close = ((orig) => function (...a) { clearInterval(sweep); return orig.apply(this, a) })(server.close)
  return server
}
const friendly = (e) => ({ pose: 'The AI could not find a body pose in the photo. Use a clear, front-facing photo showing your upper body.', input: 'The AI could not use one of the photos. Try a clear JPG or PNG.', blocked: 'The AI service declined this photo.', quota: 'The AI service is at its usage limit right now. Try again later.', permission: 'The server is not allowed to use the AI service. The site owner needs to check the Google Cloud setup.', timeout: 'The AI service took too long. Try a smaller photo or try again.', empty: e.message, auth: 'The server could not sign in to Google Cloud. The site owner needs to check the setup.' }[e.code] || 'The AI service could not finish this try-on. Please try again.')

if (import.meta.url === `file://${process.argv[1]}`) {
  const port = +process.env.PORT || 8080
  createServer().listen(port, () => console.log(`Glamify XR AI server listening on ${port}. outfit provider=${outfitProvider(process.env)}`))
}
