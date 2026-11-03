// AI hairstyles: FLUX.1 Kontext [pro] (text-instructed image editing) on Replicate. Paid (about $0.04 per image).
// Asynchronous API: POST /v1/models/<owner>/<name>/predictions -> { id }, then GET /v1/predictions/:id.
// A general image editor, not a dedicated hair model: it usually keeps the face, but there is no identity guarantee.
import { providerFetch } from './http.js'
import { toDataUri } from '../services/images.js'
import { STYLES, COLOURS, hairPrompt } from './prompts.js'

const headers = (cfg) => ({ authorization: `Bearer ${cfg.providers.replicate.token}`, 'content-type': 'application/json' })

export const replicateHair = {
  id: 'replicate-kontext', label: 'FLUX.1 Kontext [pro] on Replicate', type: 'hair', mode: 'server', paid: true, licence: 'commercial API (paid per image)',
  available: (cfg) => !!cfg.providers.replicate.token,
  async start({ person, options }, cfg) {
    const r = cfg.providers.replicate
    const j = await providerFetch(`${r.base}/models/${r.hairModel}/predictions`, { method: 'POST', headers: headers(cfg), body: JSON.stringify({
      input: { prompt: hairPrompt(STYLES[options.style], COLOURS[options.colour || 'natural']), input_image: toDataUri(person), aspect_ratio: 'match_input_image', output_format: 'jpg', safety_tolerance: 2 },
    }) }, cfg.providers.timeoutMs)
    if (!j?.id) throw Object.assign(new Error('no job id'), { code: 'provider_error', retryable: true })
    return { externalId: String(j.id) }
  },
  async check(id, cfg) {
    const st = await providerFetch(`${cfg.providers.replicate.base}/predictions/${encodeURIComponent(id)}`, { headers: headers(cfg) }, cfg.providers.timeoutMs)
    if (st?.status === 'succeeded') {
      const out = Array.isArray(st.output) ? st.output[0] : st.output
      if (!out) return { state: 'failed', code: 'provider_empty' }
      const bytes = await providerFetch(out, {}, cfg.providers.timeoutMs)
      return bytes instanceof Uint8Array ? { state: 'succeeded', bytes } : { state: 'failed', code: 'provider_empty' }
    }
    if (st?.status === 'failed' || st?.status === 'canceled') return { state: 'failed', code: /nsfw|safety|flagged/i.test(st.error || '') ? 'blocked' : 'provider_error' }
    return { state: 'processing', stage: st?.status === 'processing' ? 'generating' : 'waiting' }
  },
  async cancel(id, cfg) { await providerFetch(`${cfg.providers.replicate.base}/predictions/${encodeURIComponent(id)}/cancel`, { method: 'POST', headers: headers(cfg) }, cfg.providers.timeoutMs) },
}
