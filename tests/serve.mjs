// Local end-to-end test server: serves the BUILT site (dist/) and runs the REAL Netlify Function (netlify/functions/tryon.mjs)
// for /api/*. With MOCK=1 the paid FASHN service is replaced by a local mock that returns a stamped "TEST - NOT AI" image,
// so the upload -> generate -> result flow can be tested without an API key. Without MOCK the function talks to the real
// FASHN API (needs FASHN_API_KEY). usage: [MOCK=1] [FASHN_API_KEY=...] node tests/serve.mjs [port]
import http from 'node:http'
import { readFileSync, existsSync, statSync } from 'node:fs'
import { join, extname } from 'node:path'
const root = join(import.meta.dirname, '..', 'dist'), port = +(process.argv[2] || 5300)
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg', '.ico': 'image/x-icon', '.mp4': 'video/mp4', '.wasm': 'application/wasm', '.json': 'application/json', '.svg': 'image/svg+xml' }
if (process.env.MOCK) {
  const result = readFileSync(join(import.meta.dirname, 'img', 'mock-result.jpg')).toString('base64'); let n = 0, last = null
  const mock = http.createServer(async (req, res) => {
    let b = ''; for await (const c of req) b += c
    const j = (o) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(o)) }
    if (req.url === '/v1/run') { last = JSON.parse(b); n = 0; console.log('[mock FASHN] run', last.inputs.category, Math.round(b.length / 1024) + ' KB'); return j({ id: 'mock' + Date.now(), error: null }) }
    if (req.url.startsWith('/v1/status/')) { n++; return j(n < 3 ? { status: n < 2 ? 'in_queue' : 'processing' } : { status: 'completed', output: ['data:image/jpeg;base64,' + result] }) }
    if (req.url.startsWith('/v1/cancel/')) return j({ status: 'canceled' })
    res.writeHead(404); res.end()
  }).listen(0)
  await new Promise((r) => mock.on('listening', r))
  process.env.FASHN_BASE = `http://127.0.0.1:${mock.address().port}/v1`; process.env.FASHN_API_KEY ||= 'mock-key'
}
const { default: fn } = await import('../netlify/functions/tryon.mjs')
http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${port}`)
  if (url.pathname.startsWith('/api/')) {
    let body = []; for await (const c of req) body.push(c)
    const r = await fn(new Request(url, { method: req.method, headers: req.headers, body: ['GET', 'HEAD'].includes(req.method) ? undefined : Buffer.concat(body) }))
    res.writeHead(r.status, Object.fromEntries(r.headers)); return res.end(Buffer.from(await r.arrayBuffer()))
  }
  let f = join(root, decodeURIComponent(url.pathname)); if (!existsSync(f) || statSync(f).isDirectory()) f = join(root, 'index.html')
  res.writeHead(200, { 'content-type': TYPES[extname(f)] || 'application/octet-stream' }); res.end(readFileSync(f))
}).listen(port, () => console.log(`site + function on http://localhost:${port}${process.env.MOCK ? '  (MOCK FASHN)' : ''}`))
