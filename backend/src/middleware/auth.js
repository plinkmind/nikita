// Who is making the request?
//  - signed-in user: "gm_session" cookie (random token; only its SHA-256 hash is stored on the server), HttpOnly, SameSite=Lax
//  - guest: "gm_guest" cookie with a random id, created the first time a guest starts a try-on. Guest looks expire after 24 h.
import { parseCookies, cookie, unauthorized } from '../http.js'
import { ownerOfUser, ownerOfGuest, newId } from '../db/models.js'

export const SESSION_COOKIE = 'gm_session', GUEST_COOKIE = 'gm_guest'

export async function identify(req, ctx) {
  const c = parseCookies(req)
  ctx.user = null; ctx.session = null; ctx.token = c[SESSION_COOKIE] || null
  if (ctx.token) {
    const s = await ctx.models.Session.find(ctx.token)
    if (s) { const u = await ctx.models.User.byId(s.userId); if (u) { ctx.user = u; ctx.session = s } }
    if (!ctx.user) ctx.setCookie(cookie(SESSION_COOKIE, '', { maxAge: 0, secure: ctx.cfg.security.secureCookies })) // stale cookie: remove it
  }
  ctx.guestId = /^g[A-Za-z0-9]{8,40}$/.test(c[GUEST_COOKIE] || '') ? c[GUEST_COOKIE] : null
}

export function requireUser(ctx) { if (!ctx.user) throw unauthorized(); return ctx.user }

// the owner of try-on jobs: the signed-in user, otherwise the guest (created on demand when `create` is true)
export function ownerOf(ctx, { create = false } = {}) {
  if (ctx.user) return ownerOfUser(ctx.user.id)
  if (!ctx.guestId && create) {
    ctx.guestId = newId('g')
    ctx.setCookie(cookie(GUEST_COOKIE, ctx.guestId, { maxAge: ctx.cfg.retention.guestHours * 3600, secure: ctx.cfg.security.secureCookies }))
  }
  return ctx.guestId ? ownerOfGuest(ctx.guestId) : null
}

export function setSessionCookie(ctx, token) {
  ctx.setCookie(cookie(SESSION_COOKIE, token, { maxAge: ctx.cfg.security.sessionDays * 86400, secure: ctx.cfg.security.secureCookies }))
}
export function clearSessionCookie(ctx) { ctx.setCookie(cookie(SESSION_COOKIE, '', { maxAge: 0, secure: ctx.cfg.security.secureCookies })) }
export function clearGuestCookie(ctx) { ctx.setCookie(cookie(GUEST_COOKIE, '', { maxAge: 0, secure: ctx.cfg.security.secureCookies })); ctx.guestId = null }
