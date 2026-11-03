// Test helpers: a cookie-keeping API client that calls the app in-process, real image bytes, and MOCK AI providers that follow
// the providers' documented APIs (FASHN: POST /v1/run, GET /v1/status/:id; Replicate: POST /models/../predictions, GET /predictions/:id).
// The mocks prove OUR code; they do not prove the live services accept the requests (that needs real API keys).
import http from 'node:http'
import { deflateSync } from 'node:zlib'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

export const ORIGIN = 'https://glamify.test'
const here = dirname(fileURLToPath(import.meta.url))
export const PERSON_JPG = readFileSync(join(here, '..', 'img', 'hand1.jpg')) // a real 640x521 JPEG
export const PORTRAIT_PNG = readFileSync(join(here, '..', 'img', 'portrait.png')) // a real 958x1358 PNG

// a valid PNG of any size (solid colour) - used as "AI results" and for size checks
export function png(w, h, rgb = [200, 40, 90]) {
  const crcT = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0 })
  const crc = (b) => { let c = 0xffffffff; for (const x of b) c = crcT[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0 }
  const chunk = (type, data) => { const t = Buffer.from(type), len = Buffer.alloc(4), c = Buffer.alloc(4); len.writeUInt32BE(data.length); c.writeUInt32BE(crc(Buffer.concat([t, data]))); return Buffer.concat([len, t, data, c]) }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2
  const row = Buffer.concat([Buffer.from([0]), Buffer.from(Array.from({ length: w }, () => rgb).flat())])
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(Buffer.concat(Array(h).fill(row)))), chunk('IEND', Buffer.alloc(0))])
}

export class Client {
  constructor(app, { origin = ORIGIN, ip = '10.0.0.1' } = {}) { this.app = app; this.origin = origin; this.ip = ip; this.jar = {} }
  cookieHeader() { return Object.entries(this.jar).map(([k, v]) => `${k}=${v}`).join('; ') }
  store(res) {
    for (const c of res.headers.getSetCookie()) {
      const [kv, ...attrs] = c.split(';'), i = kv.indexOf('='), k = kv.slice(0, i), v = kv.slice(i + 1)
      if (/max-age=0/i.test(attrs.join(';')) || v === '') delete this.jar[k]; else this.jar[k] = v
      ;(this.lastCookies ||= []).push(c)
    }
  }
  async req(method, path, { json, form, headers = {}, csrf = true, origin = this.origin, raw } = {}) {
    const h = { 'x-nf-client-connection-ip': this.ip, ...headers }
    if (origin) h.origin = origin
    if (csrf && method !== 'GET') h['x-requested-with'] = 'glamify'
    const ck = this.cookieHeader(); if (ck) h.cookie = ck
    let body
    if (json !== undefined) { h['content-type'] = 'application/json'; body = JSON.stringify(json) }
    else if (form) { body = new FormData(); for (const [k, v] of Object.entries(form)) { if (v instanceof Uint8Array) body.append(k, new Blob([v]), `${k}.bin`); else body.append(k, String(v)) } }
    else if (raw) { body = raw.body; Object.assign(h, raw.headers) }
    this.lastCookies = []
    const res = await this.app.handle(new Request(ORIGIN + path, { method, headers: h, body }))
    this.store(res)
    const ct = res.headers.get('content-type') || ''
    const data = ct.includes('json') ? await res.json() : new Uint8Array(await res.arrayBuffer())
    return { status: res.status, data, headers: res.headers, cookies: this.lastCookies }
  }
  get(p, o) { return this.req('GET', p, o) }
  post(p, o) { return this.req('POST', p, o) }
  patch(p, o) { return this.req('PATCH', p, o) }
  del(p, o) { return this.req('DELETE', p, o) }
}

// ---- mock AI providers ----
export async function startMockProviders() {
  const st = { fashnMode: 'ok', fashnRuns: 0, polls: 0, runFailOnce: false, lastFashn: null, lastReplicate: null, cancelled: [], resultPng: png(600, 900) }
  const server = http.createServer(async (req, res) => {
    let b = []; for await (const c of req) b.push(c); b = Buffer.concat(b).toString()
    const j = (code, o) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(o)) }
    st.lastAuth = req.headers.authorization
    // FASHN
    if (req.url === '/fashn/v1/run' && req.method === 'POST') {
      st.fashnRuns++; st.lastFashn = JSON.parse(b); st.polls = 0
      if (st.fashnMode === 'badkey') return j(401, { error: 'unauthorized' })
      if (st.runFailOnce) { st.runFailOnce = false; return j(429, { error: 'rate limited' }) }
      return j(200, { id: 'fj' + st.fashnRuns, error: null })
    }
    let m = /^\/fashn\/v1\/status\/(\w+)$/.exec(req.url)
    if (m) {
      st.polls++
      if (st.polls < 2) return j(200, { id: m[1], status: 'in_queue' })
      if (st.fashnMode === 'pose') return j(200, { id: m[1], status: 'failed', error: { name: 'PoseError', message: 'no pose' } })
      if (st.fashnMode === 'garbage') return j(200, { id: m[1], status: 'completed', output: ['data:image/jpeg;base64,' + Buffer.from('this is not an image at all, sorry').toString('base64')] })
      return j(200, { id: m[1], status: 'completed', output: ['data:image/png;base64,' + st.resultPng.toString('base64')] })
    }
    m = /^\/fashn\/v1\/cancel\/(\w+)$/.exec(req.url); if (m) { st.cancelled.push(m[1]); return j(200, { id: m[1], status: 'canceled' }) }
    // Replicate
    if (/^\/replicate\/v1\/models\/[\w.-]+\/[\w.-]+\/predictions$/.test(req.url) && req.method === 'POST') { st.lastReplicate = JSON.parse(b); st.polls = 0; return j(201, { id: 'rp1', status: 'starting' }) }
    if (req.url === '/replicate/v1/predictions/rp1') { st.polls++; return st.polls < 2 ? j(200, { status: 'processing' }) : j(200, { status: 'succeeded', output: `http://127.0.0.1:${server.address().port}/files/out.png` }) }
    if (req.url === '/files/out.png') { res.writeHead(200, { 'content-type': 'image/png' }); return res.end(st.resultPng) }
    j(404, {})
  })
  await new Promise((r) => server.listen(0, '127.0.0.1', r))
  const base = `http://127.0.0.1:${server.address().port}`
  return { st, server, env: { FASHN_BASE: `${base}/fashn/v1`, REPLICATE_BASE: `${base}/replicate/v1` }, close: () => new Promise((r) => server.close(r)) }
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
// poll a job until it is finished (each status call moves server jobs forward; tests set PROVIDER_CHECK_MS=0)
export async function waitJob(client, id, { tries = 12 } = {}) {
  let r
  for (let i = 0; i < tries; i++) { r = await client.get(`/api/tryon/status/${id}`); if (['succeeded', 'failed'].includes(r.data.job?.status) || r.status !== 200) return r; await sleep(20) }
  return r
}
