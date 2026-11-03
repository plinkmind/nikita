// Accounts: password hashing, validation, sign-up / sign-in / sessions.
// Passwords are hashed with scrypt (memory-hard, built into Node: no extra library), a random 16-byte salt per user, and
// compared in constant time. The plain password is never stored or logged.
import { scrypt as _scrypt, randomBytes, timingSafeEqual } from 'node:crypto'
import { promisify } from 'node:util'
import { bad, ApiError } from '../http.js'

const scrypt = promisify(_scrypt)
const N = 16384, R = 8, P = 1, KEYLEN = 64

export async function hashPassword(pw) {
  const salt = randomBytes(16), key = await scrypt(pw.normalize('NFKC'), salt, KEYLEN, { N, r: R, p: P, maxmem: 64 * 1024 * 1024 })
  return `scrypt$${N}$${R}$${P}$${salt.toString('base64')}$${key.toString('base64')}`
}
export async function verifyPassword(pw, stored) {
  const parts = String(stored || '').split('$')
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false
  const [, n, r, p, salt, hash] = parts, expected = Buffer.from(hash, 'base64')
  const key = await scrypt(pw.normalize('NFKC'), Buffer.from(salt, 'base64'), expected.length, { N: +n, r: +r, p: +p, maxmem: 64 * 1024 * 1024 })
  return key.length === expected.length && timingSafeEqual(key, expected)
}
// used when an e-mail address is unknown, so a failed sign-in takes the same time either way (does not reveal who has an account)
let dummy = null
export const dummyVerify = async (pw) => { dummy ||= await hashPassword('dummy-password-not-used'); await verifyPassword(pw, dummy); return false }

const EMAIL_RE = /^[^\s@<>()[\]\\,;:"]{1,64}@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$/
export function cleanEmail(v) {
  const e = String(v ?? '').trim().toLowerCase()
  if (e.length > 254 || !EMAIL_RE.test(e)) throw bad('bad_email', 'Please enter a valid e-mail address.')
  return e
}
export function checkPassword(v, email) {
  const pw = typeof v === 'string' ? v : ''
  if (pw.length < 8) throw bad('weak_password', 'Your password needs at least 8 characters.')
  if (pw.length > 200) throw bad('weak_password', 'Your password is too long (200 characters at most).')
  if (/^(.)\1+$/.test(pw) || pw.toLowerCase() === email || /^(12345678|password|qwertyui|11111111)/i.test(pw)) throw bad('weak_password', 'Please choose a less obvious password.')
  return pw
}
export function cleanName(v) {
  const n = String(v ?? '').replace(/[\u0000-\u001f\u007f<>]/g, '').replace(/\s+/g, ' ').trim()
  if (n.length > 60) throw bad('bad_name', 'Your name can be 60 characters at most.')
  return n
}

export function authService({ User, Session }, cfg) {
  return {
    async register({ email, password, name }) {
      const e = cleanEmail(email), pw = checkPassword(password, e), nm = cleanName(name)
      const user = await User.create({ email: e, name: nm, passwordHash: await hashPassword(pw) })
      if (!user) throw new ApiError(409, 'email_taken', 'An account with this e-mail already exists. Please sign in instead.')
      const { token } = await Session.create(user.id, cfg.security.sessionDays)
      return { user, token }
    },
    async login({ email, password }) {
      let e; try { e = cleanEmail(email) } catch { throw new ApiError(401, 'bad_login', 'Wrong e-mail or password.') }
      const pw = typeof password === 'string' ? password.slice(0, 200) : ''
      const user = await User.byEmail(e)
      const ok = user ? await verifyPassword(pw, user.passwordHash) : await dummyVerify(pw)
      if (!ok) throw new ApiError(401, 'bad_login', 'Wrong e-mail or password.')
      await User.update(user.id, { lastLoginAt: new Date().toISOString() })
      const { token } = await Session.create(user.id, cfg.security.sessionDays)
      return { user, token }
    },
  }
}

export const publicUser = (u) => u && ({ id: u.id, email: u.email, name: u.name || '', createdAt: u.createdAt, lastLoginAt: u.lastLoginAt })
