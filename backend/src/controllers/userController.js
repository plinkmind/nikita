// GET /api/user/profile, PATCH /api/user/profile, DELETE /api/user (delete account and all its data)
import { json, readJson, ApiError } from '../http.js'
import { publicUser, cleanName, verifyPassword } from '../services/auth.js'
import { requireUser, clearSessionCookie } from '../middleware/auth.js'
import { ownerOfUser } from '../db/models.js'

export const userController = {
  async profile(ctx) {
    const user = requireUser(ctx)
    const jobs = await ctx.models.TryOn.listForOwner(ownerOfUser(user.id))
    return json(200, { user: publicUser(user), stats: { looks: jobs.filter((j) => j.status === 'succeeded').length, total: jobs.length } })
  },
  async update(ctx) {
    const user = requireUser(ctx), body = await readJson(ctx.req)
    const next = await ctx.models.User.update(user.id, { name: cleanName(body.name) })
    return json(200, { user: publicUser(next) })
  },
  async remove(ctx) {
    const user = requireUser(ctx), body = await readJson(ctx.req)
    // deleting an account is permanent, so the password is asked again
    if (!(await verifyPassword(String(body.password || '').slice(0, 200), user.passwordHash))) throw new ApiError(401, 'bad_password', 'That password is not correct.')
    await ctx.services.tryon.removeAllForOwner(ownerOfUser(user.id))
    await ctx.models.Session.removeAllForUser(user.id)
    await ctx.models.User.remove(user)
    clearSessionCookie(ctx)
    return json(200, { ok: true })
  },
}
