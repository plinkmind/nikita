// The two AI providers. Request formats follow Google's Vertex AI documentation:
//  - outfit: Virtual Try-On model "virtual-try-on-001" (:predict with personImage + productImages)  -> a dedicated try-on model
//  - hair:   Gemini image editing ("gemini-2.5-flash-image", :generateContent with a text instruction + the photo) -> a general
//            image-editing model, NOT a dedicated hairstyle model. It can change the face or background slightly; no guarantee.
import { getAccessToken } from './google.js'

import { STYLES, COLOURS, hairPrompt } from './prompts.js'
export { STYLES, COLOURS }

const host = (loc) => (loc === 'global' ? 'aiplatform.googleapis.com' : `${loc}-aiplatform.googleapis.com`)
const base = (env, loc) => env.UPSTREAM_BASE || `https://${host(loc)}`

async function call(env, url, body, timeoutMs) {
  const token = await getAccessToken(env)
  for (let attempt = 0; attempt < 2; attempt++) { // one retry for rate limits / temporary overload
    const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), timeoutMs)
    try {
      const res = await fetch(url, { method: 'POST', signal: ctl.signal, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json; charset=utf-8' }, body: JSON.stringify(body) })
      if ((res.status === 429 || res.status === 503) && attempt === 0) { await new Promise((r) => setTimeout(r, 1500)); continue }
      const text = await res.text()
      let json; try { json = JSON.parse(text) } catch { json = null }
      if (!res.ok) throw Object.assign(new Error(json?.error?.message || `Upstream error ${res.status}`), { code: res.status === 429 ? 'quota' : res.status === 403 ? 'permission' : 'upstream', status: res.status })
      return json
    } catch (e) {
      if (e.name === 'AbortError') throw Object.assign(new Error('The AI service took too long'), { code: 'timeout' })
      throw e
    } finally { clearTimeout(timer) }
  }
}

// FASHN Virtual Try-On (https://docs.fashn.ai): a dedicated, commercially licensed try-on model. Asynchronous API:
// POST /v1/run -> { id }, then GET /v1/status/:id until completed / failed. Inputs are sent as data URIs, the output is
// requested as base64 so the image never has to be fetched from a third-party URL.
async function fashnTryOn(env, { person, garment }) {
  const base = env.FASHN_BASE || 'https://api.fashn.ai/v1', limit = +env.TRYON_TIMEOUT_MS || 150_000, t0 = Date.now()
  const H = { authorization: `Bearer ${env.FASHN_API_KEY}`, 'content-type': 'application/json' }
  const req = async (url, init) => {
    const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), Math.min(30_000, limit))
    try {
      const res = await fetch(url, { ...init, signal: ctl.signal }), j = await res.json().catch(() => null)
      if (!res.ok) throw Object.assign(new Error(j?.error?.message || j?.message || `FASHN error ${res.status}`), { code: res.status === 429 ? 'quota' : res.status === 401 || res.status === 403 ? 'permission' : 'upstream' })
      return j
    } catch (e) { if (e.name === 'AbortError') throw Object.assign(new Error('The AI service took too long'), { code: 'timeout' }); throw e } finally { clearTimeout(timer) }
  }
  const run = await req(`${base}/run`, { method: 'POST', headers: H, body: JSON.stringify({ model_name: env.FASHN_MODEL || 'tryon-v1.6', inputs: {
    model_image: `data:${person.mime};base64,${person.b64}`, garment_image: `data:${garment.mime};base64,${garment.b64}`,
    category: 'auto', garment_photo_type: 'auto', mode: env.FASHN_MODE || 'quality', segmentation_free: true,
    moderation_level: 'permissive', num_samples: 1, output_format: 'png', return_base64: true } }) })
  if (!run?.id) throw Object.assign(new Error(run?.error?.message || 'FASHN did not start the job'), { code: 'upstream' })
  while (Date.now() - t0 < limit) {
    await new Promise((r) => setTimeout(r, +env.FASHN_POLL_MS || 1500))
    const st = await req(`${base}/status/${run.id}`, { headers: H })
    if (st.status === 'completed') {
      const out = st.output?.[0]; if (!out) throw Object.assign(new Error('The AI returned no image'), { code: 'empty' })
      const m = /^data:([^;]+);base64,(.*)$/.exec(out)
      if (m) return { mimeType: m[1], base64: m[2] }
      const img = await fetch(out); if (!img.ok) throw Object.assign(new Error('Could not download the result'), { code: 'upstream' })
      return { mimeType: img.headers.get('content-type') || 'image/png', base64: Buffer.from(await img.arrayBuffer()).toString('base64') }
    }
    if (st.status === 'failed' || st.status === 'canceled') {
      const n = st.error?.name || ''
      throw Object.assign(new Error(st.error?.message || 'FASHN could not finish'), { code: n === 'PoseError' ? 'pose' : n === 'NSFWError' ? 'blocked' : n === 'ImageLoadError' || n === 'InputValidationError' || n === 'PhotoTypeError' ? 'input' : 'upstream' })
    }
  }
  throw Object.assign(new Error('The AI service took too long'), { code: 'timeout' })
}

export const outfitProvider = (env) => (env.TRYON_PROVIDER || 'google').toLowerCase()
export async function outfitTryOn(env, { person, garment }) {
  if (outfitProvider(env) === 'fashn') return fashnTryOn(env, { person, garment })
  const loc = env.TRYON_LOCATION || 'us-central1', model = env.TRYON_MODEL || 'virtual-try-on-001'
  const url = `${base(env, loc)}/v1/projects/${env.GCP_PROJECT}/locations/${loc}/publishers/google/models/${model}:predict`
  const j = await call(env, url, { instances: [{ personImage: { image: { bytesBase64Encoded: person.b64 } }, productImages: [{ image: { bytesBase64Encoded: garment.b64 } }] }], parameters: { sampleCount: 1 } }, +env.TRYON_TIMEOUT_MS || 150_000)
  const p = j?.predictions?.[0]
  if (!p?.bytesBase64Encoded) throw Object.assign(new Error('The AI returned no image (the photo may have been blocked by a safety filter)'), { code: 'empty' })
  return { mimeType: p.mimeType || 'image/png', base64: p.bytesBase64Encoded }
}

export async function hairEdit(env, { person, styleId, colourId }) {
  const loc = env.HAIR_LOCATION || 'global', model = env.HAIR_MODEL || 'gemini-2.5-flash-image'
  const style = STYLES[styleId], colour = COLOURS[colourId ?? 'natural']
  if (!style) throw Object.assign(new Error('Unknown hairstyle'), { code: 'bad' })
  const prompt = hairPrompt(style, colour)
  const url = `${base(env, loc)}/v1/projects/${env.GCP_PROJECT}/locations/${loc}/publishers/google/models/${model}:generateContent`
  const j = await call(env, url, { contents: [{ role: 'user', parts: [{ text: prompt }, { inlineData: { mimeType: person.mime, data: person.b64 } }] }], generationConfig: { responseModalities: ['TEXT', 'IMAGE'] } }, +env.HAIR_TIMEOUT_MS || 90_000)
  const part = j?.candidates?.[0]?.content?.parts?.find((x) => (x.inlineData || x.inline_data)?.data)
  const d = part && (part.inlineData || part.inline_data)
  if (!d) throw Object.assign(new Error('The AI returned no image (the photo may have been blocked by a safety filter)'), { code: 'empty' })
  return { mimeType: d.mimeType || d.mime_type || 'image/png', base64: d.data }
}
