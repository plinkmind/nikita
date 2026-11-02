// Tests the server against a MOCK of Google. This proves OUR code (validation, consent, auth signing, request shape, error handling,
// privacy cleanup). It does NOT prove that Google's live service accepts the request: that needs real credentials.
import http from 'node:http'
import crypto from 'node:crypto'
import { createServer } from './index.js'
import { clearTokenCache } from './google.js'

const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 })
const sa = { client_email: 'test@test.iam.gserviceaccount.com', private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }) }
let results = [], mode = 'ok', seen = {}
const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(2000, 1)]).toString('base64')
const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(500, 2)]).toString('base64')
const check = (name, ok, extra = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '  ' + extra}`) }

const mock = http.createServer(async (req, res) => {
  let body = ''; for await (const c of req) body += c
  const json = (code, o) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(o)) }
  if (req.url === '/token') {
    const jwt = new URLSearchParams(body).get('assertion'), [h, p, s] = jwt.split('.')
    const valid = crypto.createVerify('RSA-SHA256').update(`${h}.${p}`).verify(publicKey, Buffer.from(s, 'base64url'))
    const claims = JSON.parse(Buffer.from(p, 'base64url')); seen.jwtValid = valid; seen.claims = claims
    return valid ? json(200, { access_token: 'tok-123', expires_in: 3600 }) : json(401, { error: 'bad signature' })
  }
  seen.auth = req.headers.authorization; seen.url = req.url; seen.body = body ? JSON.parse(body) : null
  if (mode === 'quota') return json(429, { error: { message: 'quota' } })
  if (mode === 'quota-once' && !seen.retried) { seen.retried = true; return json(429, { error: { message: 'quota' } }) }
  if (mode === 'denied') return json(403, { error: { message: 'permission denied' } })
  if (mode === 'slow') return setTimeout(() => json(200, { predictions: [] }), 3000)
  if (mode === 'empty') return json(200, { predictions: [{ raiFilteredReason: 'blocked' }], candidates: [{ content: { parts: [{ text: 'sorry' }] } }] })
  if (req.url.includes(':predict')) return json(200, { predictions: [{ mimeType: 'image/png', bytesBase64Encoded: 'T1VUUFVU' }] })
  if (req.url.includes(':generateContent')) return json(200, { candidates: [{ content: { parts: [{ text: 'done' }, { inlineData: { mimeType: 'image/png', data: 'SEFJUg==' } }] } }] })
  json(404, {})
})
await new Promise((r) => mock.listen(0, '127.0.0.1', r))
const mport = mock.address().port
const env = { GCP_PROJECT: 'proj-1', GOOGLE_SERVICE_ACCOUNT_JSON: JSON.stringify(sa), TOKEN_URL: `http://127.0.0.1:${mport}/token`, UPSTREAM_BASE: `http://127.0.0.1:${mport}`, ALLOWED_ORIGINS: 'https://glamify-xr.netlify.app', RATE_MAX: '50', TRYON_TIMEOUT_MS: '1000', HAIR_TIMEOUT_MS: '1000' }
let app = createServer(env); await new Promise((r) => app.listen(0, '127.0.0.1', r)); let base = `http://127.0.0.1:${app.address().port}`
const post = (path, body, headers = {}) => fetch(base + path, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: typeof body === 'string' ? body : JSON.stringify(body) })
const poll = async (id) => { for (let i = 0; i < 40; i++) { const j = await (await fetch(`${base}/api/tryon/${id}`)).json(); if (j.status !== 'running') return j; await new Promise((r) => setTimeout(r, 100)) } return { status: 'timeout' } }

let r = await (await fetch(base + '/api/health')).json()
check('health reports configured + models', r.ok && r.configured && r.outfit.ready && r.hair.ready && r.outfit.model === 'virtual-try-on-001' && r.hair.styles.length === 15)

r = await post('/api/tryon', { type: 'outfit', person: jpeg, garment: jpeg }); check('refuses without consent (400)', r.status === 400 && (await r.json()).code === 'consent')
r = await post('/api/tryon', 'not json'); check('rejects invalid JSON (400)', r.status === 400)
r = await post('/api/tryon', { type: 'outfit', person: Buffer.from('hello world').toString('base64'), garment: jpeg, consent: true }); check('rejects non-image file (400)', r.status === 400 && /JPEG or PNG/.test((await r.json()).error))
r = await post('/api/tryon', { type: 'outfit', person: jpeg, consent: true }); check('rejects missing garment (400)', r.status === 400)
r = await post('/api/tryon', { type: 'hair', person: jpeg, style: 'h-evil prompt', consent: true }); check('rejects unknown hairstyle id (no prompt injection) (400)', r.status === 400)
r = await post('/api/tryon', { type: 'nope', person: jpeg, consent: true }); check('rejects unknown type (400)', r.status === 400)
const big = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(9 * 1024 * 1024)]).toString('base64')
r = await post('/api/tryon', { type: 'outfit', person: big, garment: jpeg, consent: true }); check('rejects image over 8 MB (400/413)', r.status === 400 || r.status === 413)
r = await post('/api/tryon', { type: 'outfit', person: jpeg, garment: jpeg, consent: true }, { origin: 'https://evil.example' }); check('blocks other websites (CORS) (403)', r.status === 403)
r = await fetch(base + '/api/health', { headers: { origin: 'https://glamify-xr.netlify.app' } }); check('allows the real website origin', r.headers.get('access-control-allow-origin') === 'https://glamify-xr.netlify.app')

// outfit happy path + exact request shape from Google's docs
mode = 'ok'; r = await post('/api/tryon', { type: 'outfit', person: jpeg, garment: png, consent: true }); const { jobId } = await r.json(); check('outfit job accepted (202)', r.status === 202 && !!jobId)
let j = await poll(jobId)
check('outfit job finishes with an image', j.status === 'done' && j.result.base64 === 'T1VUUFVU' && j.result.mimeType === 'image/png')
check('service-account JWT signature is valid and has correct claims', seen.jwtValid === true && seen.claims.iss === sa.client_email && seen.claims.scope.includes('cloud-platform') && seen.claims.exp - seen.claims.iat === 3600)
check('sends Bearer token from Google', seen.auth === 'Bearer tok-123')
check('VTO URL matches the documented path', seen.url === '/v1/projects/proj-1/locations/us-central1/publishers/google/models/virtual-try-on-001:predict', seen.url)
check('VTO body matches the documented shape', seen.body.instances[0].personImage.image.bytesBase64Encoded === jpeg && seen.body.instances[0].productImages[0].image.bytesBase64Encoded === png && seen.body.parameters.sampleCount === 1)
r = await fetch(`${base}/api/tryon/${jobId}`); check('result is deleted after it is delivered once (404)', r.status === 404)

// hair
r = await post('/api/tryon', { type: 'hair', person: jpeg, style: 'h-bob', colour: 'burgundy', consent: true }); j = await poll((await r.json()).jobId)
const parts = seen.body.contents[0].parts
check('hair job returns the edited image', j.status === 'done' && j.result.base64 === 'SEFJUg==')
check('hair prompt is built on the server from ids (bob + burgundy) and photo is sent inline', /bob/.test(parts[0].text) && /same person/.test(parts[0].text) && /burgundy/.test(parts[0].text) && parts[1].inlineData.data === jpeg && seen.body.generationConfig.responseModalities.includes('IMAGE'))
check('hair URL uses the global Gemini image model path', seen.url === '/v1/projects/proj-1/locations/global/publishers/google/models/gemini-2.5-flash-image:generateContent', seen.url)

// failure modes
mode = 'quota-once'; seen.retried = false; r = await post('/api/tryon', { type: 'outfit', person: jpeg, garment: jpeg, consent: true }); j = await poll((await r.json()).jobId); check('retries once after a 429 then succeeds', j.status === 'done')
mode = 'quota'; r = await post('/api/tryon', { type: 'outfit', person: jpeg, garment: jpeg, consent: true }); j = await poll((await r.json()).jobId); check('persistent 429 -> friendly quota error', j.status === 'error' && j.code === 'quota' && /usage limit/.test(j.error))
mode = 'denied'; r = await post('/api/tryon', { type: 'outfit', person: jpeg, garment: jpeg, consent: true }); j = await poll((await r.json()).jobId); check('403 -> friendly permission error', j.status === 'error' && j.code === 'permission')
mode = 'empty'; r = await post('/api/tryon', { type: 'outfit', person: jpeg, garment: jpeg, consent: true }); j = await poll((await r.json()).jobId); check('no image returned (safety filter) -> clear error', j.status === 'error' && j.code === 'empty')
mode = 'slow'; r = await post('/api/tryon', { type: 'outfit', person: jpeg, garment: jpeg, consent: true }); j = await poll((await r.json()).jobId); check('upstream timeout -> timeout error', j.status === 'error' && j.code === 'timeout')

// rate limit, busy, not configured
app.close(); app = createServer({ ...env, RATE_MAX: '2' }); await new Promise((r2) => app.listen(0, '127.0.0.1', r2)); base = `http://127.0.0.1:${app.address().port}`; mode = 'ok'
const codes = []; for (let i = 0; i < 3; i++) codes.push((await post('/api/tryon', { type: 'outfit', person: jpeg, garment: jpeg, consent: true })).status)
check('rate limit: 3rd request in the window is refused (429)', codes[2] === 429 && codes[0] === 202, codes.join())
app.close(); app = createServer({ ...env, MAX_CONCURRENT: '1' }); await new Promise((r2) => app.listen(0, '127.0.0.1', r2)); base = `http://127.0.0.1:${app.address().port}`; mode = 'slow'
const a = await post('/api/tryon', { type: 'outfit', person: jpeg, garment: jpeg, consent: true }), b2 = await post('/api/tryon', { type: 'outfit', person: jpeg, garment: jpeg, consent: true })
check('busy server refuses extra jobs (503)', a.status === 202 && b2.status === 503)
app.close(); app = createServer({ ALLOWED_ORIGINS: '' }); await new Promise((r2) => app.listen(0, '127.0.0.1', r2)); base = `http://127.0.0.1:${app.address().port}`
r = await post('/api/tryon', { type: 'outfit', person: jpeg, garment: jpeg, consent: true }); check('not configured -> honest 501, no fake result', r.status === 501 && (await r.json()).code === 'not_configured')
r = await (await fetch(base + '/api/health')).json(); check('health says configured:false', r.configured === false)

// FASHN provider (mock of the documented API: POST /v1/run -> id, GET /v1/status/:id)
const fseen = { polls: 0 }; let fmode = 'ok'
const fmock = http.createServer(async (req, res) => {
  let body = ''; for await (const c of req) body += c
  const json = (code, o) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(o)) }
  fseen.auth = req.headers.authorization
  if (req.method === 'POST' && req.url === '/v1/run') { fseen.body = JSON.parse(body); return fmode === 'badkey' ? json(401, { error: { message: 'bad key' } }) : json(200, { id: 'pred-1', error: null }) }
  if (req.url === '/v1/status/pred-1') { fseen.polls++; if (fseen.polls < 2) return json(200, { id: 'pred-1', status: 'processing' })
    return fmode === 'pose' ? json(200, { id: 'pred-1', status: 'failed', error: { name: 'PoseError', message: 'no pose' } }) : json(200, { id: 'pred-1', status: 'completed', output: ['data:image/png;base64,RkFTSE4='] }) }
  json(404, {})
})
await new Promise((r2) => fmock.listen(0, '127.0.0.1', r2))
const fenv = { ALLOWED_ORIGINS: '', TRYON_PROVIDER: 'fashn', FASHN_API_KEY: 'fa-test', FASHN_BASE: `http://127.0.0.1:${fmock.address().port}/v1`, FASHN_POLL_MS: '20', RATE_MAX: '50' }
app.close(); app = createServer(fenv); await new Promise((r2) => app.listen(0, '127.0.0.1', r2)); base = `http://127.0.0.1:${app.address().port}`
r = await (await fetch(base + '/api/health')).json(); check('fashn: health says outfit ready, hair not ready (no Google set up)', r.outfit.ready === true && r.outfit.provider === 'fashn' && r.hair.ready === false)
r = await post('/api/tryon', { type: 'hair', person: jpeg, style: 'h-bob', consent: true }); check('fashn-only server refuses hair honestly (501)', r.status === 501)
r = await post('/api/tryon', { type: 'outfit', person: jpeg, garment: png, consent: true }); j = await poll((await r.json()).jobId)
check('fashn: outfit job finishes with the returned image', j.status === 'done' && j.result.base64 === 'RkFTSE4=' && j.result.mimeType === 'image/png')
check('fashn: documented request shape (model_name, inputs as data URIs, base64 output)', fseen.auth === 'Bearer fa-test' && fseen.body.model_name === 'tryon-v1.6' && fseen.body.inputs.model_image === `data:image/jpeg;base64,${jpeg}` && fseen.body.inputs.garment_image === `data:image/png;base64,${png}` && fseen.body.inputs.return_base64 === true && fseen.polls >= 2)
fmode = 'pose'; fseen.polls = 0; r = await post('/api/tryon', { type: 'outfit', person: jpeg, garment: png, consent: true }); j = await poll((await r.json()).jobId); check('fashn: PoseError -> clear message about the photo', j.status === 'error' && j.code === 'pose' && /pose/.test(j.error))
fmode = 'badkey'; r = await post('/api/tryon', { type: 'outfit', person: jpeg, garment: png, consent: true }); j = await poll((await r.json()).jobId); check('fashn: wrong API key -> permission error', j.status === 'error' && j.code === 'permission')
fmock.close()

app.close(); mock.close(); clearTokenCache()
console.log(`\n${results.filter(Boolean).length}/${results.length} passed`); process.exit(results.every(Boolean) ? 0 : 1)
