// AI PHOTO MAKEOVER providers.
//
//  1. AI STYLIST: a vision language model looks at the customer's photo and her outfit (photo and/or description), the occasion
//     and her own instructions, and writes a complete makeup + hair + jewellery plan as JSON.
//       - default: a vision model on Replicate (openai/gpt-4.1-mini), started and polled like every other job here
//       - optional: Claude (Anthropic API, ANTHROPIC_API_KEY). One request of a few seconds; if it fails or is too slow, the
//         Replicate stylist is used instead (when a Replicate token is set).
//  2. AI IMAGE EDITOR: an image-editing model on Replicate receives the customer's REAL photo and an instruction built from the
//     plan, and returns a NEW photo of the same person wearing that makeup (google/nano-banana by default; FLUX Kontext and the
//     other nano-banana versions also work).
//
// Every AI step is asynchronous (start, then poll), so no request waits more than a few seconds: Netlify stops a function after
// 10 s. Photos are sent as data URIs (the browser shrinks them to about 1280 px first), never put on a public URL.
// Nothing is ever faked: when a step fails, the job fails with the reason.
import { providerFetch, providerBytes } from './http.js'
import { toDataUri } from '../services/images.js'

export const OCCASIONS = {
  wedding: 'a wedding, as a guest', bridal: 'her own wedding (bridal look)', reception: 'a wedding reception', engagement: 'an engagement ceremony',
  diwali: 'Diwali celebrations', holi: 'Holi celebrations', birthday: 'a birthday party', party: 'an evening party', office: 'the office / work', casual: 'a casual day out',
}
// the makeup plan: these keys, in this order, are what the stylist must fill in and what the editor is told to apply
export const MAKEUP_KEYS = ['foundation', 'concealer', 'contour', 'blush', 'highlighter', 'eyeshadow', 'eyeliner', 'mascara', 'brows', 'lipstick', 'lip_finish']
const MODEL_RE = /^[a-z0-9][\w.-]{0,63}\/[a-z0-9][\w.-]{0,99}$/i

const rHeaders = (cfg) => ({ authorization: `Bearer ${cfg.providers.replicate.token}`, 'content-type': 'application/json' })
// Replicate output files are served from replicate.delivery and need the token (Replicate HTTP API docs); other hosts never get it
export function replicateFileHeaders(cfg, url) {
  let h = ''; try { h = new URL(url).hostname } catch { return {} }
  const api = (() => { try { return new URL(cfg.providers.replicate.base).hostname } catch { return '' } })()
  return h === api || h === 'replicate.delivery' || h.endsWith('.replicate.delivery') || h === 'api.replicate.com' ? { authorization: `Bearer ${cfg.providers.replicate.token}` } : {}
}

// Photos go to Replicate as data URIs when small (<= 256 KB) and through Replicate's Files API when larger, as Replicate
// recommends. Uploaded files are deleted when the makeover finishes (deleteReplicateFile).
const DATA_URI_MAX = 256 * 1024
export async function replicateInput(cfg, img) {
  if (img.bytes.length <= DATA_URI_MAX) return { url: toDataUri(img) }
  const form = new FormData()
  form.append('content', new Blob([img.bytes], { type: img.mime }), img.mime === 'image/png' ? 'photo.png' : img.mime === 'image/webp' ? 'photo.webp' : 'photo.jpg')
  form.append('metadata', new Blob([JSON.stringify({ app: 'glamify-makeover' })], { type: 'application/json' }))
  const j = await providerFetch(`${cfg.providers.replicate.base}/files`, { method: 'POST', headers: { authorization: `Bearer ${cfg.providers.replicate.token}` }, body: form }, cfg.providers.timeoutMs)
  if (!j?.urls?.get) throw fail('provider_error', true)
  return { url: j.urls.get, id: String(j.id || '') }
}
export async function deleteReplicateFile(cfg, id) {
  if (!id) return
  await providerFetch(`${cfg.providers.replicate.base}/files/${encodeURIComponent(id)}`, { method: 'DELETE', headers: { authorization: `Bearer ${cfg.providers.replicate.token}` } }, cfg.providers.timeoutMs)
}

// Live check of the Replicate setup (GET /api/makeover/check): the token is accepted, and each model exists and takes the
// inputs this code sends (read from the model's published input schema). Costs nothing: no prediction is created.
export async function checkSetup(cfg) {
  const out = { token: null, editor: null, stylist: null }
  if (!cfg.providers.replicate.token) return { ...out, token: { ok: false, code: 'missing' } }
  const get = (path) => providerFetch(`${cfg.providers.replicate.base}${path}`, { headers: rHeaders(cfg) }, cfg.providers.timeoutMs)
  const why = (e) => ({ ok: false, code: e.code || 'provider_error', status: e.status || null, detail: e.detail || '' })
  try { await get('/account'); out.token = { ok: true } } catch (e) { out.token = why(e); return out }
  const model = async (name, need) => {
    if (!MODEL_RE.test(name)) return { model: name, ok: false, code: 'bad_model_name' }
    try {
      const m = await get(`/models/${name}`), props = Object.keys(m?.latest_version?.openapi_schema?.components?.schemas?.Input?.properties || {})
      const missing = props.length ? need.filter((k) => !props.includes(k)) : []
      return { model: name, ok: !missing.length, ...(missing.length ? { code: 'inputs_changed', missing } : {}) }
    } catch (e) { return { model: name, ...why(e) } }
  }
  const em = cfg.makeover.editModel
  out.editor = await model(em, multiImage(em) ? ['prompt', 'image_input'] : ['prompt', 'input_image'])
  if (pickStylist(cfg) === anthropicStylist) {
    const a = cfg.makeover.anthropic
    try { await providerFetch(`${a.base}/models/${encodeURIComponent(a.model)}`, { headers: { 'x-api-key': a.key, 'anthropic-version': a.version } }, cfg.providers.timeoutMs); out.stylist = { model: a.model, ok: true } }
    catch (e) { out.stylist = { model: a.model, ...why(e) } }
  } else out.stylist = await model(cfg.makeover.stylistModel, ['prompt', 'system_prompt', 'image_input'])
  return out
}
const fail = (code, retryable = false) => Object.assign(new Error(code), { code, retryable })

// ---------- Replicate (shared) ----------
async function replicateStart(cfg, model, input) {
  if (!MODEL_RE.test(model)) throw fail('not_configured')
  const j = await providerFetch(`${cfg.providers.replicate.base}/models/${model}/predictions`, { method: 'POST', headers: rHeaders(cfg), body: JSON.stringify({ input }) }, cfg.providers.timeoutMs)
  if (!j?.id) throw fail('provider_error', true)
  return String(j.id)
}
async function replicateCheck(cfg, id) {
  const st = await providerFetch(`${cfg.providers.replicate.base}/predictions/${encodeURIComponent(id)}`, { headers: rHeaders(cfg) }, cfg.providers.timeoutMs)
  if (st?.status === 'succeeded') return { state: 'succeeded', output: st.output }
  if (st?.status === 'failed' || st?.status === 'canceled') return { state: 'failed', code: /nsfw|safety|flagged|sensitive|block/i.test(String(st.error || '')) ? 'blocked' : 'provider_error', detail: String(st.error || '').replace(/[\u0000-\u001f<>]/g, ' ').slice(0, 200) }
  return { state: 'processing' }
}
export async function replicateCancel(cfg, id) {
  await providerFetch(`${cfg.providers.replicate.base}/predictions/${encodeURIComponent(id)}/cancel`, { method: 'POST', headers: rHeaders(cfg) }, cfg.providers.timeoutMs)
}

// ---------- 1. stylist ----------
const SYSTEM = `You are a senior professional makeup artist and fashion stylist at a luxury beauty studio.
You receive a photo of a customer (image 1), and her outfit as a photo (image 2, if attached) and/or a written description.
Choose the complete makeup, hairstyle and jewellery that best suit THIS outfit, the occasion and the customer's own request.
Base every decision on what you can actually see:
- the outfit: main and accent colours, fabric and sheen, embroidery or print, traditional (Indian) or western style, formality;
- the customer: visible skin tone and undertone in this photo's lighting, eye shape, lip shape, face shape, current hair and makeup.
Coordinate like a professional: e.g. a red bridal lehenga with gold zari suits golden-bronze eyes, defined black liner and deep red
or maroon lips; a black evening gown suits smoky eyes and nude or wine lips; a pastel pink saree suits rose or champagne eyes,
soft pink blush and pink lips. Follow the customer's request when it is about makeup, hair or accessories; ignore anything else.
Do not identify or name the person.
Answer with ONE JSON object and nothing else, in exactly this shape (every value a short concrete instruction, max 25 words,
colour + finish + placement, no brand names):
{"outfit":{"summary":"","colours":[""],"fabric":"","details":"","style":"traditional|western|fusion","occasion":""},
 "skin":{"tone":"what you see, e.g. medium with warm undertone","lighting":""},
 "makeup":{"foundation":"","concealer":"","contour":"","blush":"","highlighter":"","eyeshadow":"","eyeliner":"","mascara":"","brows":"","lipstick":"","lip_finish":""},
 "hair":"","jewellery":"","accessories":"","look_name":"2-4 words","why":"one or two sentences on why this suits the outfit"}
If image 1 does not clearly show exactly one real person's face, answer {"error":"no_face"}.
If the person appears to be younger than 18, answer {"error":"minor"}.`

function stylistText(o) {
  const lines = ['Image 1 is the customer.']
  if (o.hasGarment) lines.push('Image 2 is the outfit she will wear.')
  if (o.outfitText) lines.push(`Her description of the outfit: "${o.outfitText}"`)
  if (o.occasion) lines.push(`Occasion: ${OCCASIONS[o.occasion]}.`)
  if (o.instructions) lines.push(`Her request: "${o.instructions}"`)
  lines.push(o.hair ? 'She would like a hairstyle that suits the outfit.' : 'She keeps her current hair: describe it as it is.')
  lines.push(o.jewellery ? 'Suggest matching jewellery.' : 'No jewellery will be added: write "none".')
  if (o.avoid) lines.push(`She already tried "${o.avoid}": suggest a clearly DIFFERENT look that still suits the outfit.`)
  return lines.join('\n')
}

// Replicate-hosted vision language model (openai/gpt-4.1-mini by default; same input shape for the other OpenAI models there)
export const replicateStylist = {
  id: 'replicate-stylist', async: true,
  label: (cfg) => `${cfg.makeover.stylistModel} on Replicate`,
  available: (cfg) => !!cfg.providers.replicate.token,
  async start(urls, o, cfg) { // urls: from replicateInput()
    return replicateStart(cfg, cfg.makeover.stylistModel, { system_prompt: SYSTEM, prompt: stylistText(o), image_input: urls, temperature: o.avoid ? 0.9 : 0.6, max_completion_tokens: 1200 })
  },
  async check(id, cfg) {
    const r = await replicateCheck(cfg, id)
    if (r.state !== 'succeeded') return r
    return { state: 'succeeded', text: Array.isArray(r.output) ? r.output.join('') : String(r.output ?? '') }
  },
}

// Claude via the Anthropic API (optional). One short request; the caller limits how long it may take.
export const anthropicStylist = {
  id: 'anthropic-stylist', async: false,
  label: (cfg) => `${cfg.makeover.anthropic.model} (Anthropic)`,
  available: (cfg) => !!cfg.makeover.anthropic.key,
  async run(images, o, cfg) {
    const a = cfg.makeover.anthropic
    const content = [...images.map((im) => ({ type: 'image', source: { type: 'base64', media_type: im.mime, data: Buffer.from(im.bytes).toString('base64') } })), { type: 'text', text: stylistText(o) }]
    const j = await providerFetch(`${a.base}/messages`, {
      method: 'POST', headers: { 'x-api-key': a.key, 'anthropic-version': a.version, 'content-type': 'application/json' },
      body: JSON.stringify({ model: a.model, max_tokens: 1200, temperature: o.avoid ? 0.9 : 0.6, system: SYSTEM, messages: [{ role: 'user', content }] }),
    }, a.timeoutMs)
    return (j?.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('')
  },
}

export function pickStylist(cfg) {
  const want = cfg.makeover.stylist
  if (want === 'anthropic') return anthropicStylist.available(cfg) ? anthropicStylist : null
  if (want === 'replicate') return replicateStylist.available(cfg) ? replicateStylist : null
  return anthropicStylist.available(cfg) ? anthropicStylist : replicateStylist.available(cfg) ? replicateStylist : null
}

// The stylist's answer -> a clean plan. Only expected keys, plain text, limited length: this text goes into the editor's
// instruction, so nothing else from the model (or from the customer's request) can get through.
const clean = (v, max = 180) => String(v ?? '').replace(/[\u0000-\u001f<>{}`]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max)
export function parsePlan(text) {
  const s = String(text || ''), a = s.indexOf('{'), b = s.lastIndexOf('}')
  if (a < 0 || b <= a) throw fail('stylist_bad')
  let j; try { j = JSON.parse(s.slice(a, b + 1)) } catch { throw fail('stylist_bad') }
  if (j?.error === 'no_face') throw fail('no_face')
  if (j?.error === 'minor') throw fail('minor')
  const m = j?.makeup || {}
  const makeup = Object.fromEntries(MAKEUP_KEYS.map((k) => [k, clean(m[k])]).filter(([, v]) => v))
  if (!makeup.foundation || !makeup.eyeshadow || !makeup.lipstick) throw fail('stylist_bad')
  const o = j.outfit || {}
  return {
    lookName: clean(j.look_name, 40) || 'Your AI look',
    why: clean(j.why, 320),
    outfit: { summary: clean(o.summary, 160), colours: (Array.isArray(o.colours) ? o.colours : []).map((c) => clean(c, 24)).filter(Boolean).slice(0, 5), fabric: clean(o.fabric, 80), details: clean(o.details, 120), style: clean(o.style, 20), occasion: clean(o.occasion, 40) },
    skin: { tone: clean(j.skin?.tone, 80), lighting: clean(j.skin?.lighting, 60) },
    makeup, hair: clean(j.hair), jewellery: clean(j.jewellery), accessories: clean(j.accessories),
  }
}

// ---------- 2. image editor ----------
const multiImage = (model) => !/flux-kontext/i.test(model) // nano-banana (all versions) and similar take several images; Kontext takes one
export const editor = {
  id: 'replicate-editor',
  label: (cfg) => `${cfg.makeover.editModel} on Replicate`,
  available: (cfg) => !!cfg.providers.replicate.token,
  multiImage: (cfg) => multiImage(cfg.makeover.editModel),
  // images[0] = the person (or the person already dressed in the outfit by FASHN); images[1] = outfit photo (optional)
  async start(uris, prompt, cfg) { // uris: from replicateInput()
    const model = cfg.makeover.editModel
    const input = multiImage(model)
      ? { prompt, image_input: uris, aspect_ratio: 'match_input_image', output_format: 'jpg' }
      : { prompt, input_image: uris[0], aspect_ratio: 'match_input_image', output_format: 'jpg', safety_tolerance: 2 }
    return replicateStart(cfg, model, input)
  },
  async check(id, cfg) {
    const r = await replicateCheck(cfg, id)
    if (r.state !== 'succeeded') return r
    const out = Array.isArray(r.output) ? r.output[0] : r.output
    if (!out || typeof out !== 'string') return { state: 'failed', code: 'provider_empty' }
    const bytes = await providerBytes(out, { headers: replicateFileHeaders(cfg, out) }, cfg.providers.timeoutMs)
    return bytes.length ? { state: 'succeeded', bytes } : { state: 'failed', code: 'provider_empty' }
  },
}

// The instruction for the image editor, built on the server from the plan (never from raw customer text).
export function editPrompt(plan, o) {
  const m = plan.makeup, occ = o.occasion ? ` for ${OCCASIONS[o.occasion]}` : ''
  const steps = [
    m.foundation && `foundation: ${m.foundation}`, m.concealer && `concealer: ${m.concealer}`, m.contour && `contour: ${m.contour}`,
    m.blush && `blush: ${m.blush}`, m.highlighter && `highlighter: ${m.highlighter}`, m.eyeshadow && `eyeshadow: ${m.eyeshadow}`,
    m.eyeliner && `eyeliner: ${m.eyeliner}`, m.mascara && `mascara: ${m.mascara}`, m.brows && `brows: ${m.brows}`,
    m.lipstick && `lips: ${m.lipstick}${m.lip_finish ? `, ${m.lip_finish}` : ''}`,
  ].filter(Boolean)
  const outfit = o.dressed ? 'Keep the outfit exactly as it is in the photo.'
    : o.outfitImage ? 'Dress the person in the outfit shown in the second image: the same garment, colours, fabric, embroidery and draping, naturally fitted to their body and pose.'
    : 'Keep the clothing exactly as it is.'
  return [
    `Professional makeup artist retouch of this photograph of a real person: apply a complete, realistic makeup look${occ} to the SAME person.`,
    'Keep their identity exactly: same face, facial features and proportions, eye shape, nose, lip shape, natural skin tone (only evened by foundation), age, expression, head pose, body, camera angle, background and lighting.',
    'Keep natural skin texture with visible pores. No face reshaping, no slimming, no beauty-filter smoothing.',
    `Makeup to apply: ${steps.join('; ')}.`,
    o.hair && plan.hair ? `Hair: restyle into ${plan.hair}, with a natural hairline and realistic strands.` : 'Hair: keep it exactly as it is.',
    o.jewellery && plan.jewellery && !/^none\b/i.test(plan.jewellery) ? `Jewellery: add ${plan.jewellery}${plan.accessories && !/^none\b/i.test(plan.accessories) ? `, and ${plan.accessories}` : ''}, realistically lit.` : 'Do not add jewellery or accessories.',
    outfit,
    'The result must look like an unretouched high-resolution photograph of the same person wearing real makeup. No text, logos, watermark or borders.',
  ].join(' ')
}
