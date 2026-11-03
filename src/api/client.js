// Browser-side client for the Glamify backend (backend/src). Same-origin requests with the session cookie, the CSRF header the
// API requires, and errors turned into readable messages. VITE_API_URL can point to a backend on another address.
const BASE = (import.meta.env?.VITE_API_URL || '').replace(/\/$/, '')

export class ApiError extends Error {
  constructor(status, code, message) { super(message); this.status = status; this.code = code }
}

async function request(method, path, { json, form, signal } = {}) {
  const headers = { 'x-requested-with': 'glamify' }
  let body
  if (json !== undefined) { headers['content-type'] = 'application/json'; body = JSON.stringify(json) }
  else if (form) body = form
  let res
  try { res = await fetch(BASE + path, { method, headers, body, credentials: BASE ? 'include' : 'same-origin', signal }) }
  catch (e) { if (e.name === 'AbortError') throw e; throw new ApiError(0, 'offline', 'Cannot reach the Glamify server. Check your internet connection and try again.') }
  const ct = res.headers.get('content-type') || ''
  const data = ct.includes('json') ? await res.json().catch(() => ({})) : null
  if (!res.ok) throw new ApiError(res.status, data?.error?.code || 'http_' + res.status, data?.error?.message || (res.status === 404 ? 'The Glamify server is not available here.' : 'Something went wrong. Please try again.'))
  if (!ct.includes('json')) throw new ApiError(res.status, 'not_api', 'The Glamify server is not available here.') // e.g. a static host returning index.html
  return data
}

export const api = {
  health: (o) => request('GET', '/api/health', o),
  me: () => request('GET', '/api/auth/me'),
  register: (email, password, name) => request('POST', '/api/auth/register', { json: { email, password, name } }),
  login: (email, password) => request('POST', '/api/auth/login', { json: { email, password } }),
  logout: () => request('POST', '/api/auth/logout'),
  profile: () => request('GET', '/api/user/profile'),
  updateProfile: (name) => request('PATCH', '/api/user/profile', { json: { name } }),
  deleteAccount: (password) => request('DELETE', '/api/user', { json: { password } }),
  generate: (fields, signal) => { const f = new FormData(); for (const [k, v] of Object.entries(fields)) { if (v == null) continue; if (v instanceof Blob) f.append(k, v, `${k}.jpg`); else f.append(k, String(v)) } return request('POST', '/api/tryon/generate', { form: f, signal }) },
  status: (id, signal) => request('GET', `/api/tryon/status/${id}`, { signal }),
  complete: (id, blob) => { const f = new FormData(); f.append('result', blob, 'result.png'); return request('POST', `/api/tryon/${id}/complete`, { form: f }) },
  fail: (id, code) => request('POST', `/api/tryon/${id}/fail`, { json: { code } }),
  history: (type) => request('GET', `/api/tryon/history${type ? `?type=${type}` : ''}`),
  remove: (id) => request('DELETE', `/api/tryon/${id}`),
  // private images need the session cookie, so they are fetched and shown as local object URLs
  async imageUrl(url) {
    const res = await fetch(BASE + url, { credentials: BASE ? 'include' : 'same-origin' })
    if (!res.ok) throw new ApiError(res.status, 'image', 'This image is no longer available.')
    return URL.createObjectURL(await res.blob())
  },
}

// tiny event hub so the account button, the AI page and the studio stay in sync when someone signs in or out
const listeners = new Set()
let current = { user: undefined }
export const session = {
  get user() { return current.user },
  set(user) { current.user = user || null; listeners.forEach((f) => f(current.user)) },
  on(f) { listeners.add(f); return () => listeners.delete(f) },
  async refresh() { try { session.set((await api.me()).user) } catch { session.set(null) } return current.user },
}
