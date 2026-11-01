// Google Cloud authentication without any library: service-account JSON (signed JWT) or, on Cloud Run, the metadata server.
// Secrets stay in server environment variables. Nothing here is ever sent to the browser.
import crypto from 'node:crypto'

const b64u = (b) => Buffer.from(b).toString('base64url')
let cached = null

export function signJwt(sa, now = Math.floor(Date.now() / 1000), tokenUrl = 'https://oauth2.googleapis.com/token') {
  const head = b64u(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))
  const body = b64u(JSON.stringify({ iss: sa.client_email, scope: 'https://www.googleapis.com/auth/cloud-platform', aud: tokenUrl, iat: now, exp: now + 3600 }))
  const sig = crypto.createSign('RSA-SHA256').update(`${head}.${body}`).sign(sa.private_key).toString('base64url')
  return `${head}.${body}.${sig}`
}

export async function getAccessToken(env = process.env) {
  if (cached && cached.exp - Date.now() > 60_000) return cached.token
  let res
  if (env.GOOGLE_SERVICE_ACCOUNT_JSON) {
    const sa = JSON.parse(env.GOOGLE_SERVICE_ACCOUNT_JSON), url = env.TOKEN_URL || 'https://oauth2.googleapis.com/token'
    res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: signJwt(sa, undefined, url) }) })
  } else {
    const url = env.METADATA_TOKEN_URL || 'http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token'
    res = await fetch(url, { headers: { 'Metadata-Flavor': 'Google' } })
  }
  if (!res.ok) throw Object.assign(new Error('Could not authenticate with Google Cloud'), { code: 'auth' })
  const j = await res.json()
  cached = { token: j.access_token, exp: Date.now() + (j.expires_in || 3000) * 1000 }
  return cached.token
}
export const clearTokenCache = () => { cached = null }
export const hasGoogleAuth = (env = process.env) => !!(env.GCP_PROJECT && (env.GOOGLE_SERVICE_ACCOUNT_JSON || env.K_SERVICE || env.USE_METADATA_AUTH))
