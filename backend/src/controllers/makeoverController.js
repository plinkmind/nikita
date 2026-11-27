// POST /api/makeover/generate      start an AI Photo Makeover (multipart: person, garment?, outfitText?, occasion?, instructions?,
//                                  hair, jewellery, avoid?, consent)
// GET  /api/makeover/status/:id    job status, the AI's makeup plan when ready (each call also moves the job forward)
// The finished image: GET /api/images/:id/result. History / delete: GET /api/tryon/history?type=makeover, DELETE /api/tryon/:id
import { json, readForm, notFound } from '../http.js'
import { ownerOf } from '../middleware/auth.js'

const view = (ctx, job) => ctx.services.tryon.publicJob(job)
export const makeoverController = {
  async generate(ctx) {
    const form = await readForm(ctx.req, ctx.cfg.limits.maxRequestBytes)
    const owner = ownerOf(ctx, { create: true })
    const job = await ctx.services.makeover.generate(owner, form, ctx.ip)
    return json(202, { job: view(ctx, job), guest: !ctx.user })
  },
  async status(ctx) {
    const owner = ownerOf(ctx); if (!owner) throw notFound('This makeover was not found.')
    return json(200, { job: view(ctx, await ctx.services.makeover.status(owner, ctx.params.id)) })
  },
}
