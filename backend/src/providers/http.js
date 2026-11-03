// shared HTTP helper for providers: timeout, safe error codes, never leaks the API key
export async function providerFetch(url, init, timeoutMs) {
  const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), timeoutMs)
  try {
    const res = await fetch(url, { ...init, signal: ctl.signal })
    const ct = res.headers.get('content-type') || ''
    const body = /json/.test(ct) ? await res.json().catch(() => null) : ct.startsWith('image/') ? new Uint8Array(await res.arrayBuffer()) : await res.text().catch(() => '')
    if (!res.ok) {
      const code = res.status === 401 || res.status === 403 ? 'provider_auth' : res.status === 402 ? 'provider_billing' : res.status === 429 ? 'provider_busy' : res.status >= 500 ? 'provider_error' : 'provider_rejected'
      throw Object.assign(new Error(`provider HTTP ${res.status}`), { code, retryable: res.status === 429 || res.status >= 500 })
    }
    return body
  } catch (e) {
    if (e.name === 'AbortError') throw Object.assign(new Error('provider timeout'), { code: 'provider_timeout', retryable: true })
    if (e.code) throw e
    throw Object.assign(new Error('provider unreachable'), { code: 'provider_unreachable', retryable: true })
  } finally { clearTimeout(t) }
}
