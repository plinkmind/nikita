// POST /api/tryon/generate         start a try-on (multipart upload: person, garment, type, category | style, colour, consent)
// GET  /api/tryon/status/:id       job status (also moves the job forward)
// POST /api/tryon/:id/complete     free provider only: the browser uploads the finished image
// POST /api/tryon/:id/fail         free provider only: the browser reports that the free service failed
// GET  /api/tryon/history          your previous try-ons (newest first)
// DELETE /api/tryon/:id            delete a try-on and its image
// GET  /api/images/:id/result      the generated image (owner only)
import { json, binary, readForm, readJson, notFound } from '../http.js'
import { ownerOf } from '../middleware/auth.js'

const view = (ctx, job) => ctx.services.tryon.publicJob(job)
const mustOwner = (ctx) => { const o = ownerOf(ctx); if (!o) throw notFound('This try-on was not found.'); return o }

export const tryonController = {
  async generate(ctx) {
    const form = await readForm(ctx.req, ctx.cfg.limits.maxRequestBytes)
    const owner = ownerOf(ctx, { create: true })
    const job = await ctx.services.tryon.generate(owner, form, ctx.ip)
    return json(202, { job: view(ctx, job), guest: !ctx.user })
  },
  async status(ctx) { return json(200, { job: view(ctx, await ctx.services.tryon.status(mustOwner(ctx), ctx.params.id)) }) },
  async complete(ctx) {
    const form = await readForm(ctx.req, ctx.cfg.limits.maxRequestBytes)
    return json(200, { job: view(ctx, await ctx.services.tryon.complete(mustOwner(ctx), ctx.params.id, form)) })
  },
  async fail(ctx) {
    const body = await readJson(ctx.req)
    return json(200, { job: view(ctx, await ctx.services.tryon.reportFailure(mustOwner(ctx), ctx.params.id, String(body.code || ''))) })
  },
  async history(ctx) {
    const owner = ownerOf(ctx)
    if (!owner) return json(200, { items: [], guest: true })
    const u = new URL(ctx.req.url), type = u.searchParams.get('type')
    const jobs = await ctx.services.tryon.history(owner, { limit: Number(u.searchParams.get('limit')) || 30, type: type === 'outfit' || type === 'hair' ? type : undefined })
    return json(200, { items: jobs.map((j) => view(ctx, j)), guest: !ctx.user, guestHours: ctx.user ? undefined : ctx.cfg.retention.guestHours })
  },
  async remove(ctx) { await ctx.services.tryon.remove(mustOwner(ctx), ctx.params.id); return json(200, { ok: true }) },
  async image(ctx) {
    const { bytes, mime } = await ctx.services.tryon.image(mustOwner(ctx), ctx.params.id, ctx.params.kind)
    return binary(bytes, mime, { 'content-disposition': `inline; filename="glamify-look-${ctx.params.id}.${mime === 'image/png' ? 'png' : mime === 'image/webp' ? 'webp' : 'jpg'}"` })
  },
}
