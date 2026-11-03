// Data models (records kept in the "db" storage namespace). Each model validates what it stores and hides the key layout.
//
//   users/<userId>                     { id, email, name, passwordHash, createdAt, updatedAt, lastLoginAt }
//   users-by-email/<sha256(email)>     { userId }                   unique index, created atomically ("only if new")
//   sessions/<sha256(token)>           { userId, createdAt, expiresAt }   the raw token only ever exists in the user's cookie
//   user-sessions/<userId>/<hash>      { createdAt }                index, so all sessions can be ended (sign out everywhere)
//   tryons/<owner>/<jobId>             try-on job (see TryOn.create)   owner = "u.<userId>" or "g.<guestId>"
//   rl/<bucket>/<key>/<window>         { n }                        rate-limit counters
import { createHash, randomBytes } from 'node:crypto'

export const sha256 = (s) => createHash('sha256').update(s).digest('hex')
export const newId = (prefix = '') => prefix + randomBytes(12).toString('base64url').replace(/[-_]/g, 'x')
const now = () => new Date().toISOString()

export const ownerOfUser = (userId) => `u.${userId}`
export const ownerOfGuest = (guestId) => `g.${guestId}`
export const isGuestOwner = (owner) => owner.startsWith('g.')

export function models(storage) {
  const db = storage.db

  const User = {
    async create({ email, name, passwordHash }) {
      const id = newId('u'), emailKey = `users-by-email/${sha256(email)}`
      // reserve the e-mail address first: atomic, so two simultaneous sign-ups with the same address cannot both succeed
      if (!(await db.setJSON(emailKey, { userId: id }, { onlyIfNew: true }))) return null
      const user = { id, email, name, passwordHash, createdAt: now(), updatedAt: now(), lastLoginAt: null }
      await db.setJSON(`users/${id}`, user)
      return user
    },
    async byId(id) { return /^u[A-Za-z0-9]{8,40}$/.test(id || '') ? db.getJSON(`users/${id}`) : null },
    async byEmail(email) { const ix = await db.getJSON(`users-by-email/${sha256(email)}`); return ix ? User.byId(ix.userId) : null },
    async update(id, patch) { const u = await User.byId(id); if (!u) return null; const next = { ...u, ...patch, id: u.id, email: u.email, updatedAt: now() }; await db.setJSON(`users/${id}`, next); return next },
    async remove(user) { await db.delete(`users-by-email/${sha256(user.email)}`); await db.delete(`users/${user.id}`) },
  }

  const Session = {
    async create(userId, days) {
      const token = randomBytes(32).toString('base64url'), hash = sha256(token)
      const s = { userId, createdAt: now(), expiresAt: new Date(Date.now() + days * 864e5).toISOString() }
      await db.setJSON(`sessions/${hash}`, s); await db.setJSON(`user-sessions/${userId}/${hash}`, { createdAt: s.createdAt })
      return { token, session: s }
    },
    async find(token) {
      if (!/^[A-Za-z0-9_-]{40,60}$/.test(token || '')) return null
      const hash = sha256(token), s = await db.getJSON(`sessions/${hash}`)
      if (!s) return null
      if (Date.parse(s.expiresAt) < Date.now()) { await Session.removeHash(s.userId, hash); return null }
      return { ...s, hash }
    },
    async removeHash(userId, hash) { await db.delete(`sessions/${hash}`); await db.delete(`user-sessions/${userId}/${hash}`) },
    async removeAllForUser(userId) { for (const k of await db.list(`user-sessions/${userId}/`)) await Session.removeHash(userId, k.split('/').pop()) },
  }

  // job ids sort by creation time (newest first when sorted descending)
  const jobId = () => 't' + (9e12 - Date.now()).toString(36).padStart(9, '0') + randomBytes(5).toString('hex')
  const TryOn = {
    async create(owner, fields) {
      const job = {
        id: jobId(), owner, type: fields.type, provider: fields.provider, mode: fields.mode, status: 'queued', stage: 'queued',
        options: fields.options || {}, externalId: null, error: null, inputs: {}, result: null, attempts: 0,
        createdAt: now(), updatedAt: now(), completedAt: null, expiresAt: fields.expiresAt || null,
      }
      await db.setJSON(`tryons/${owner}/${job.id}`, job)
      return job
    },
    async get(owner, id) { return /^t[a-z0-9]{9}[a-f0-9]{10}$/.test(id || '') ? db.getJSON(`tryons/${owner}/${id}`) : null },
    async save(job) { job.updatedAt = now(); await db.setJSON(`tryons/${job.owner}/${job.id}`, job); return job },
    async listForOwner(owner) { const keys = await db.list(`tryons/${owner}/`); return (await Promise.all(keys.map((k) => db.getJSON(k)))).filter(Boolean) },
    async remove(job) { await db.delete(`tryons/${job.owner}/${job.id}`) },
    async allKeys() { return db.list('tryons/') },
    async getByKey(k) { return db.getJSON(k) },
  }

  const RateLimit = {
    // fixed-window counter shared by all server instances (kept in storage, not in memory)
    async hit(bucket, key, max, windowSec) {
      const win = Math.floor(Date.now() / 1000 / windowSec), k = `rl/${bucket}/${sha256(String(key)).slice(0, 32)}/${win}`
      const cur = (await db.getJSON(k))?.n || 0
      if (cur >= max) return { ok: false, retryAfter: (win + 1) * windowSec - Math.floor(Date.now() / 1000) }
      await db.setJSON(k, { n: cur + 1, exp: (win + 1) * windowSec })
      return { ok: true, remaining: max - cur - 1 }
    },
    async sweep() { let n = 0; const t = Date.now() / 1000; for (const k of await db.list('rl/')) { const v = await db.getJSON(k); if (!v || v.exp < t) { await db.delete(k); n++ } } return n },
  }

  return { User, Session, TryOn, RateLimit }
}
