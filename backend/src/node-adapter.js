// Converts between Node's http objects and web-standard Request / Response (used by backend/server.js and vite.config.js).
export async function toWebRequest(req, base) {
  const headers = new Headers()
  for (const [k, v] of Object.entries(req.headers)) if (v !== undefined) headers.set(k, Array.isArray(v) ? v.join(', ') : v)
  headers.set('x-real-client-ip', req.socket.remoteAddress || 'local') // the real socket address (a client cannot fake it)
  const hasBody = !['GET', 'HEAD'].includes(req.method)
  return new Request(new URL(req.url, base), { method: req.method, headers, body: hasBody ? req : undefined, duplex: hasBody ? 'half' : undefined })
}
export async function sendWebResponse(res, r) {
  const headers = {}
  r.headers.forEach((v, k) => { if (k !== 'set-cookie') headers[k] = v })
  const cookies = typeof r.headers.getSetCookie === 'function' ? r.headers.getSetCookie() : []
  if (cookies.length) headers['set-cookie'] = cookies
  res.writeHead(r.status, headers)
  res.end(r.body ? Buffer.from(await r.arrayBuffer()) : undefined)
}

