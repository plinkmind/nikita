// AI provider registry. Every provider has the same shape, so another model can be added by writing one file and listing it here:
//   { id, label, type: 'outfit' | 'hair', mode: 'server' | 'browser', paid, licence, available(cfg),
//     start(input, cfg) -> { externalId }        (server mode: send the photos to the AI service)
//     check(externalId, cfg) -> { state: 'processing' | 'succeeded' | 'failed', stage?, bytes?, code? }
//     cancel?(externalId, cfg) }
// "browser" mode: the generation itself runs in the visitor's browser (free Hugging Face demo, see free.js). The backend only
// creates the job and stores the finished image the browser sends back.
import { fashn } from './fashn.js'
import { replicateHair } from './replicate.js'
import { freeIdmVton } from './free.js'

export const PROVIDERS = [fashn, replicateHair, freeIdmVton]
export const providerById = (id) => PROVIDERS.find((p) => p.id === id) || null

// which provider handles a request of this type right now (null = not available: the API says so honestly)
export function pickProvider(type, cfg) {
  const ok = (p) => p && p.type === type && p.available(cfg)
  if (type === 'outfit') {
    const want = cfg.providers.outfit
    if (want === 'fashn') return ok(fashn) ? fashn : null
    if (want === 'free') return ok(freeIdmVton) ? freeIdmVton : null
    return ok(fashn) ? fashn : ok(freeIdmVton) ? freeIdmVton : null // auto: paid key set -> FASHN, otherwise free
  }
  if (type === 'hair') return ok(replicateHair) ? replicateHair : null
  return null
}

export const describe = (p, cfg) => p && ({ id: p.id, label: p.label, mode: p.mode, paid: p.paid, licence: p.licence, ...(p.mode === 'browser' ? { space: cfg.providers.freeSpace } : {}) })
export { providerFetch } from './http.js'
