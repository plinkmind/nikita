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
  const st = { fashnMode: 'ok', fashnRuns: 0, polls: 0, runFailOnce: false, lastFashn: null, lastReplicate: null, cancelled: [], resultPng: png(600, 900),
    // AI Photo Makeover: stylist (Replicate vision model / Anthropic) and image editor (Replicate)
    stylistMode: 'ok', stylistRuns: 0, stylistPolls: {}, lastStylist: null, editMode: 'ok', editRuns: 0, editPolls: {}, lastEdit: null, editModel: null,
    anthropicMode: 'ok', anthropicCalls: 0, lastAnthropic: null, lastAnthropicHeaders: null, plan: PLAN, makeoverJpg: png(512, 768, [180, 120, 110]) }
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
    // Replicate: AI Photo Makeover stylist (OpenAI vision models) and image editors (nano-banana, FLUX Kontext)
    let mm = /^\/replicate\/v1\/models\/(openai\/[\w.-]+)\/predictions$/.exec(req.url)
    if (mm && req.method === 'POST') { st.lastStylist = JSON.parse(b); st.stylistModel = mm[1]; return j(201, { id: 'st' + ++st.stylistRuns, status: 'starting' }) }
    mm = /^\/replicate\/v1\/models\/((?:google\/nano-banana[\w.-]*)|(?:black-forest-labs\/flux-kontext[\w.-]*))\/predictions$/.exec(req.url)
    // (flux-kontext-pro stays the hairstyle mock further down)
    if (mm && req.method === 'POST' && mm[1] !== 'black-forest-labs/flux-kontext-pro') { st.lastEdit = JSON.parse(b); st.editModel = mm[1]; return j(201, { id: 'ed' + ++st.editRuns, status: 'starting' }) }
    mm = /^\/replicate\/v1\/predictions\/(st\d+)$/.exec(req.url)
    if (mm) {
      const n = (st.stylistPolls[mm[1]] = (st.stylistPolls[mm[1]] || 0) + 1)
      if (n < 2) return j(200, { id: mm[1], status: 'processing' })
      if (st.stylistMode === 'fail') return j(200, { id: mm[1], status: 'failed', error: 'model error' })
      const text = st.stylistMode === 'garbage' ? 'I would suggest a lovely look!' : st.stylistMode === 'noface' ? '{"error":"no_face"}' : st.stylistMode === 'minor' ? '{"error":"minor"}' : '```json\n' + JSON.stringify(st.plan) + '\n```'
      return j(200, { id: mm[1], status: 'succeeded', output: text.match(/.{1,7}/gs) }) // streamed tokens, as Replicate's language models return them
    }
    mm = /^\/replicate\/v1\/predictions\/(ed\d+)$/.exec(req.url)
    if (mm) {
      const n = (st.editPolls[mm[1]] = (st.editPolls[mm[1]] || 0) + 1)
      if (n < 2) return j(200, { id: mm[1], status: 'processing' })
      if (st.editMode === 'blocked') return j(200, { id: mm[1], status: 'failed', error: 'Prediction failed: content flagged as sensitive (E005)' })
      return j(200, { id: mm[1], status: 'succeeded', output: `http://127.0.0.1:${server.address().port}/files/${st.editMode === 'garbage' ? 'notimage.jpg' : 'makeover.jpg'}` })
    }
    mm = /^\/replicate\/v1\/predictions\/(\w+)\/cancel$/.exec(req.url); if (mm && req.method === 'POST') { st.cancelled.push(mm[1]); return j(200, { id: mm[1], status: 'canceled' }) }
    if (req.url === '/files/makeover.jpg') { res.writeHead(200, { 'content-type': 'image/png' }); return res.end(st.makeoverJpg) }
    if (req.url === '/files/notimage.jpg') { res.writeHead(200, { 'content-type': 'image/jpeg' }); return res.end(Buffer.from('<html>not an image</html>')) }
    // Anthropic Messages API (optional Claude stylist)
    if (req.url === '/anthropic/v1/messages' && req.method === 'POST') {
      st.anthropicCalls++; st.lastAnthropic = JSON.parse(b); st.lastAnthropicHeaders = req.headers
      if (st.anthropicMode === 'error') return j(500, { type: 'error', error: { type: 'api_error', message: 'overloaded' } })
      if (st.anthropicMode === 'slow') { await new Promise((r) => setTimeout(r, 3000)); return j(200, { content: [{ type: 'text', text: JSON.stringify(st.plan) }] }) }
      return j(200, { id: 'msg_1', type: 'message', role: 'assistant', content: [{ type: 'text', text: JSON.stringify(st.plan) }], stop_reason: 'end_turn' })
    }
    // Replicate
    if (/^\/replicate\/v1\/models\/[\w.-]+\/[\w.-]+\/predictions$/.test(req.url) && req.method === 'POST') { st.lastReplicate = JSON.parse(b); st.polls = 0; return j(201, { id: 'rp1', status: 'starting' }) }
    if (req.url === '/replicate/v1/predictions/rp1') { st.polls++; return st.polls < 2 ? j(200, { status: 'processing' }) : j(200, { status: 'succeeded', output: `http://127.0.0.1:${server.address().port}/files/out.png` }) }
    if (req.url === '/files/out.png') { res.writeHead(200, { 'content-type': 'image/png' }); return res.end(st.resultPng) }
    j(404, {})
  })
  await new Promise((r) => server.listen(0, '127.0.0.1', r))
  const base = `http://127.0.0.1:${server.address().port}`
  return { st, server, env: { FASHN_BASE: `${base}/fashn/v1`, REPLICATE_BASE: `${base}/replicate/v1`, ANTHROPIC_BASE: `${base}/anthropic/v1` }, close: () => new Promise((r) => server.close(r)) }
}

// a stylist answer in the shape the system prompt asks for (red bridal lehenga)
export const PLAN = {
  outfit: { summary: 'Red silk bridal lehenga with heavy gold zari embroidery', colours: ['deep red', 'gold'], fabric: 'raw silk', details: 'gold zari and sequin work', style: 'traditional', occasion: 'bridal' },
  skin: { tone: 'medium with warm undertone', lighting: 'warm indoor light' },
  makeup: { foundation: 'satin warm-beige foundation matched to her medium warm skin', concealer: 'peach corrector then light concealer under the eyes', contour: 'soft warm bronze under the cheekbones and along the jaw',
    blush: 'warm rose blush on the apples blended up', highlighter: 'gold highlighter on cheekbones, brow bone and nose tip', eyeshadow: 'gold shimmer on the lid with bronze crease and deep brown outer V',
    eyeliner: 'defined black winged liner and black kohl in the waterline', mascara: 'volumising black mascara with soft lash extensions', brows: 'filled and defined with dark brown powder',
    lipstick: 'deep red matte lipstick with a maroon liner', lip_finish: 'matte' },
  hair: 'low braided bridal bun with jasmine flowers and a centre part', jewellery: 'gold kundan maang tikka, matching jhumkas and a nath', accessories: 'none', look_name: 'Classic red bride', why: 'Gold eyes echo the zari work and deep red lips match the lehenga.',
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
// poll a job until it is finished (each status call moves server jobs forward; tests set PROVIDER_CHECK_MS=0)
export async function waitJob(client, id, { tries = 12 } = {}) {
  let r
  for (let i = 0; i < tries; i++) { r = await client.get(`/api/tryon/status/${id}`); if (['succeeded', 'failed'].includes(r.data.job?.status) || r.status !== 200) return r; await sleep(20) }
  return r
}
