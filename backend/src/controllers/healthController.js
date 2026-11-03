// GET /api/health: is the backend up, can it reach its database, and which AI features are switched on (no secrets shown).
import { json } from '../http.js'
import { pickProvider, describe } from '../providers/index.js'
import { STYLES, COLOURS } from '../providers/prompts.js'

export const healthController = {
  async health(ctx) {
    let db = 'ok'
    try { await ctx.storage.db.getJSON('health/ping') } catch { db = 'error' }
    const outfit = pickProvider('outfit', ctx.cfg), hair = pickProvider('hair', ctx.cfg)
    return json(db === 'ok' ? 200 : 503, {
      ok: db === 'ok', version: ctx.cfg.version, storage: ctx.storage.driver, database: db,
      accounts: true, guests: true,
      tryon: {
        outfit: { ready: !!outfit, provider: describe(outfit, ctx.cfg) },
        hair: { ready: !!hair, provider: describe(hair, ctx.cfg), styles: Object.keys(STYLES), colours: Object.keys(COLOURS) },
      },
      limits: { maxImageMB: Math.round(ctx.cfg.limits.maxImageBytes / 1e5) / 10, minImageSide: ctx.cfg.limits.minImageSide, guestHours: ctx.cfg.retention.guestHours, resultDays: ctx.cfg.retention.resultDays },
    })
  },
}
