// shared HTTP helper for providers: timeout, safe error codes, never leaks the API key
// a file download (e.g. a generated image): bytes whatever the content type says; the caller checks they are a real image
export async function providerBytes(url, init, timeoutMs) {
  const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), timeoutMs)
  try {
    const res = await fetch(url, { ...init, signal: ctl.signal })
    if (!res.ok) throw Object.assign(new Error(`provider HTTP ${res.status}`), { code: res.status === 401 || res.status === 403 ? 'provider_auth' : 'provider_empty', status: res.status, retryable: res.status >= 500 })
    return new Uint8Array(await res.arrayBuffer())
  } catch (e) {
    if (e.name === 'AbortError') throw Object.assign(new Error('provider timeout'), { code: 'provider_timeout', retryable: true })
    if (e.code) throw e
    throw Object.assign(new Error('provider unreachable'), { code: 'provider_unreachable', retryable: true })
  } finally { clearTimeout(t) }
}

export async function providerFetch(url, init, timeoutMs) {
  const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), timeoutMs)
  try {
    const res = await fetch(url, { ...init, signal: ctl.signal })
    const ct = res.headers.get('content-type') || ''
    const body = /json/.test(ct) ? await res.json().catch(() => null) : ct.startsWith('image/') ? new Uint8Array(await res.arrayBuffer()) : await res.text().catch(() => '')
    if (!res.ok) {
      const code = res.status === 401 || res.status === 403 ? 'provider_auth' : res.status === 402 ? 'provider_billing' : res.status === 429 ? 'provider_busy' : res.status >= 500 ? 'provider_error' : 'provider_rejected'
      // the provider's own short reason (e.g. Replicate's "detail"), cleaned: shown to the site owner to fix a setup problem
      const detail = String((body && typeof body === 'object' ? body.detail || body.error?.message || body.title || body.message : '') || '').replace(/[\u0000-\u001f<>]/g, ' ').slice(0, 200)
      throw Object.assign(new Error(`provider HTTP ${res.status}`), { code: res.status === 404 ? 'provider_not_found' : code, status: res.status, detail, retryable: res.status === 429 || res.status >= 500 })
    }
    return body
  } catch (e) {
    if (e.name === 'AbortError') throw Object.assign(new Error('provider timeout'), { code: 'provider_timeout', retryable: true })
    if (e.code) throw e
    throw Object.assign(new Error('provider unreachable'), { code: 'provider_unreachable', retryable: true })
  } finally { clearTimeout(t) }
}
