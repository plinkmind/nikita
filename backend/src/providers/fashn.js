// FASHN tryon-v1.6 (https://docs.fashn.ai): a model built only for virtual try-on. Paid (about 1 credit = 1 image).
// Asynchronous API: POST /v1/run -> { id }, then GET /v1/status/:id until "completed" / "failed". Photos are sent as data URIs
// and the result is requested as base64, so no image ever sits on a public URL.
import { providerFetch } from './http.js'
import { toDataUri, fromDataUri } from '../services/images.js'

const headers = (cfg) => ({ authorization: `Bearer ${cfg.providers.fashn.key}`, 'content-type': 'application/json' })
const ERR = { PoseError: 'pose', NSFWError: 'blocked', ImageLoadError: 'input', InputValidationError: 'input', PhotoTypeError: 'input' }

export const fashn = {
  id: 'fashn', label: 'FASHN Virtual Try-On v1.6', type: 'outfit', mode: 'server', paid: true, licence: 'commercial API (paid per image)',
  available: (cfg) => !!cfg.providers.fashn.key,
  async start({ person, garment, options }, cfg) {
    const f = cfg.providers.fashn
    const j = await providerFetch(`${f.base}/run`, { method: 'POST', headers: headers(cfg), body: JSON.stringify({
      model_name: f.model,
      inputs: { model_image: toDataUri(person), garment_image: toDataUri(garment), category: options.category || 'auto', garment_photo_type: 'auto',
        mode: f.mode, segmentation_free: true, moderation_level: 'permissive', num_samples: 1, output_format: 'jpeg', return_base64: true },
    }) }, cfg.providers.timeoutMs)
    if (!j?.id) throw Object.assign(new Error('no job id'), { code: 'provider_error', retryable: true })
    return { externalId: String(j.id) }
  },
  async check(id, cfg) {
    const st = await providerFetch(`${cfg.providers.fashn.base}/status/${encodeURIComponent(id)}`, { headers: headers(cfg) }, cfg.providers.timeoutMs)
    if (st?.status === 'completed') {
      const out = st.output?.[0]; if (!out) return { state: 'failed', code: 'provider_empty' }
      const bytes = fromDataUri(out) || (await providerFetch(out, {}, cfg.providers.timeoutMs))
      return bytes instanceof Uint8Array ? { state: 'succeeded', bytes } : { state: 'failed', code: 'provider_empty' }
    }
    if (st?.status === 'failed' || st?.status === 'canceled') return { state: 'failed', code: ERR[st.error?.name] || 'provider_error' }
    return { state: 'processing', stage: st?.status === 'processing' ? 'generating' : 'waiting' } // starting | in_queue | processing
  },
  async cancel(id, cfg) { await providerFetch(`${cfg.providers.fashn.base}/cancel/${encodeURIComponent(id)}`, { headers: headers(cfg) }, cfg.providers.timeoutMs) },
}
