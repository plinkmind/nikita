// POST /api/auth/register, POST /api/auth/login, POST /api/auth/logout, GET /api/auth/me
import { json, readJson } from '../http.js'
import { publicUser } from '../services/auth.js'
import { rateLimit } from '../middleware/security.js'
import { setSessionCookie, clearSessionCookie, clearGuestCookie } from '../middleware/auth.js'
import { ownerOfUser, ownerOfGuest } from '../db/models.js'

// looks made as a guest move into the account when the guest signs up or signs in
async function claimGuest(ctx, user) {
  if (!ctx.guestId) return 0
  const n = await ctx.services.tryon.claim(ownerOfGuest(ctx.guestId), ownerOfUser(user.id))
  clearGuestCookie(ctx); return n
}

export const authController = {
  async register(ctx) {
    await rateLimit(ctx.models, 'register', ctx.ip, ctx.cfg.limits.registerPerIp)
    const body = await readJson(ctx.req)
    const { user, token } = await ctx.services.auth.register(body)
    setSessionCookie(ctx, token)
    const claimed = await claimGuest(ctx, user)
    return json(201, { user: publicUser(user), claimedLooks: claimed })
  },
  async login(ctx) {
    await rateLimit(ctx.models, 'login', ctx.ip, ctx.cfg.limits.loginPerIp)
    const body = await readJson(ctx.req)
    const { user, token } = await ctx.services.auth.login(body)
    if (ctx.session) await ctx.models.Session.removeHash(ctx.session.userId, ctx.session.hash) // replace any previous session
    setSessionCookie(ctx, token)
    const claimed = await claimGuest(ctx, user)
    return json(200, { user: publicUser(user), claimedLooks: claimed })
  },
  async logout(ctx) {
    if (ctx.session) await ctx.models.Session.removeHash(ctx.session.userId, ctx.session.hash)
    clearSessionCookie(ctx)
    return json(200, { ok: true })
  },
  async me(ctx) { return json(200, { user: publicUser(ctx.user) }) },
}
