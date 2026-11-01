// The two AI providers. Request formats follow Google's Vertex AI documentation:
//  - outfit: Virtual Try-On model "virtual-try-on-001" (:predict with personImage + productImages)  -> a dedicated try-on model
//  - hair:   Gemini image editing ("gemini-2.5-flash-image", :generateContent with a text instruction + the photo) -> a general
//            image-editing model, NOT a dedicated hairstyle model. It can change the face or background slightly; no guarantee.
import { getAccessToken } from './google.js'

export const STYLES = {
  'h-short': 'a short pixie-style haircut', 'h-bob': 'a chin-length bob haircut', 'h-long': 'long straight hair past the shoulders',
  'h-layers': 'long layered hair with soft face-framing layers', 'h-wavy': 'long wavy hair', 'h-curly': 'voluminous curly hair',
  'h-bangs': 'soft curtain bangs (fringe) over the forehead',
}
export const COLOURS = { black: 'black', 'dark-brown': 'dark brown', chestnut: 'chestnut brown', auburn: 'auburn', blonde: 'honey blonde', platinum: 'platinum blonde', burgundy: 'burgundy', copper: 'copper', ash: 'ash grey', rose: 'rose pink', natural: '' }

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

export async function outfitTryOn(env, { person, garment }) {
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
  const prompt = `Edit this photo: change ONLY the person's hairstyle to ${style}${colour ? `, in ${colour} colour` : ', keeping their natural hair colour'}. ` +
    'Keep the face, identity, skin tone, expression, clothing, pose, background and lighting exactly the same. Make the new hair look natural, with a realistic hairline and strands. Do not add text or anything else.'
  const url = `${base(env, loc)}/v1/projects/${env.GCP_PROJECT}/locations/${loc}/publishers/google/models/${model}:generateContent`
  const j = await call(env, url, { contents: [{ role: 'user', parts: [{ text: prompt }, { inlineData: { mimeType: person.mime, data: person.b64 } }] }], generationConfig: { responseModalities: ['TEXT', 'IMAGE'] } }, +env.HAIR_TIMEOUT_MS || 90_000)
  const part = j?.candidates?.[0]?.content?.parts?.find((x) => (x.inlineData || x.inline_data)?.data)
  const d = part && (part.inlineData || part.inline_data)
  if (!d) throw Object.assign(new Error('The AI returned no image (the photo may have been blocked by a safety filter)'), { code: 'empty' })
  return { mimeType: d.mimeType || d.mime_type || 'image/png', base64: d.data }
}
