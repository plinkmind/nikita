// Tests netlify/functions/tryon.mjs against MOCKS of the FASHN and Replicate APIs (shapes from their public docs).
// Proves our code (validation, consent, request shapes, polling, errors). Does NOT prove the live services accept it.
import http from 'node:http'
const results = []; const check = (n, ok, x = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${ok ? '' : '  ' + x}`) }
const seen = {}; let mode = 'ok', polls = 0
const mock = http.createServer(async (req, res) => {
  let body = ''; for await (const c of req) body += c
  const j = (code, o) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(o)) }
  seen.auth = req.headers.authorization
  if (req.url === '/fashn/run') { seen.fashn = JSON.parse(body); return mode === 'badkey' ? j(401, { error: { message: 'bad' } }) : j(200, { id: 'abc123', error: null }) }
  if (req.url === '/fashn/status/abc123') { polls++; return polls < 2 ? j(200, { status: 'processing' }) : mode === 'pose' ? j(200, { status: 'failed', error: { name: 'PoseError' } }) : j(200, { status: 'completed', output: ['data:image/jpeg;base64,T1VURklU'] }) }
  if (req.url === '/rep/models/black-forest-labs/flux-kontext-pro/predictions') { seen.rep = JSON.parse(body); return j(201, { id: 'rp987', status: 'starting' }) }
  if (req.url === '/rep/predictions/rp987') { polls++; return polls < 2 ? j(200, { status: 'processing' }) : j(200, { status: 'succeeded', output: `http://127.0.0.1:${mock.address().port}/out.jpg` }) }
  if (req.url === '/out.jpg') { res.writeHead(200, { 'content-type': 'image/jpeg' }); return res.end(Buffer.from('HAIRJPG')) }
  j(404, {})
})
await new Promise((r) => mock.listen(0, '127.0.0.1', r)); const mb = `http://127.0.0.1:${mock.address().port}`
const { default: handler } = await import('../netlify/functions/tryon.mjs')
const site = 'https://glamify.example'
const call = (path, init = {}) => handler(new Request(site + path, { ...init, headers: { origin: site, 'content-type': 'application/json', ...(init.headers || {}) } }))
const jpeg = 'data:image/jpeg;base64,' + Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(500, 1)]).toString('base64')
const post = (b) => call('/api/tryon', { method: 'POST', body: JSON.stringify(b) })

let r = await (await call('/api/health')).json(); check('no keys -> health says nothing set up', r.configured === false && r.outfit.ready === false && r.hair.ready === false)
r = await post({ type: 'outfit', person: jpeg, garment: jpeg, consent: true }); check('no keys -> honest 501, no fake result', r.status === 501)
Object.assign(process.env, { FASHN_API_KEY: 'fk', REPLICATE_API_TOKEN: 'rt', FASHN_BASE: mb + '/fashn', REPLICATE_BASE: mb + '/rep' })
r = await (await call('/api/health')).json(); check('keys -> both modes ready', r.outfit.ready && r.hair.ready && r.hair.styles.length === 15)
r = await call('/api/tryon', { method: 'POST', body: '{}', headers: { origin: 'https://evil.example' } }); check('other websites blocked (403)', r.status === 403)
r = await post({ type: 'outfit', person: jpeg, garment: jpeg }); check('consent required (400)', r.status === 400)
r = await post({ type: 'outfit', person: 'data:image/png;base64,aGVsbG8=', garment: jpeg, consent: true }); check('non-image rejected (400)', r.status === 400)
r = await post({ type: 'hair', person: jpeg, style: 'ignore previous', consent: true }); check('unknown hairstyle id rejected (no prompt injection)', r.status === 400)
r = await post({ type: 'outfit', person: jpeg, garment: jpeg, consent: true }); let j = await r.json()
check('outfit job started at FASHN (202)', r.status === 202 && j.jobId === 'f_abc123')
check('FASHN request shape', seen.auth === 'Bearer fk' && seen.fashn.model_name === 'tryon-v1.6' && seen.fashn.inputs.model_image === jpeg && seen.fashn.inputs.return_base64 === true)
polls = 0; let s1 = await (await call('/api/tryon/f_abc123')).json(); let s2 = await (await call('/api/tryon/f_abc123')).json()
check('outfit: running, then done with the image', s1.status === 'running' && s2.status === 'done' && s2.result.base64 === 'T1VURklU')
r = await post({ type: 'hair', person: jpeg, style: 'h-deep-curly', colour: 'burgundy', consent: true }); j = await r.json()
check('hair job started at Replicate (202)', r.status === 202 && j.jobId === 'r_rp987' && /deep curls/.test(seen.rep.input.prompt) && /burgundy/.test(seen.rep.input.prompt) && seen.rep.input.input_image === jpeg && seen.auth === 'Bearer rt')
polls = 0; s1 = await (await call('/api/tryon/r_rp987')).json(); s2 = await (await call('/api/tryon/r_rp987')).json()
check('hair: running, then done (result downloaded and returned as base64)', s1.status === 'running' && s2.status === 'done' && Buffer.from(s2.result.base64, 'base64').toString() === 'HAIRJPG')
mode = 'pose'; polls = 0; await post({ type: 'outfit', person: jpeg, garment: jpeg, consent: true }); await call('/api/tryon/f_abc123'); s2 = await (await call('/api/tryon/f_abc123')).json()
check('FASHN PoseError -> clear message', s2.status === 'error' && s2.code === 'pose' && /pose/.test(s2.error))
mode = 'badkey'; r = await post({ type: 'outfit', person: jpeg, garment: jpeg, consent: true }); j = await r.json(); check('wrong key -> clear message', r.status === 502 && j.code === 'permission')
r = await call('/api/tryon/x_../../etc'); check('bad job ids rejected (404)', r.status === 404)
mock.close(); console.log(`\n${results.filter(Boolean).length}/${results.length} passed`); process.exit(results.every(Boolean) ? 0 : 1)
