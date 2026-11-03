// Standalone Node server: the same backend outside Netlify (your computer, a VPS, Render, Railway, Docker...).
//   npm run build && npm start        -> website (dist/) + API on http://localhost:8787
// Data goes to the folder DATA_DIR (default .data/) unless STORAGE_DRIVER says otherwise. Settings: .env (see .env.example).
import http from 'node:http'
import { readFile, stat } from 'node:fs/promises'
import { join, extname, normalize, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createApp } from './src/app.js'
import { loadDotEnv } from './src/dotenv.js'
import { toWebRequest, sendWebResponse } from './src/node-adapter.js'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
loadDotEnv(join(root, '.env'))
const port = Number(process.env.PORT || 8787), host = process.env.HOST || '0.0.0.0'
const dist = join(root, process.env.STATIC_DIR || 'dist'), serveStatic = process.env.SERVE_STATIC !== 'false'
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.mp4': 'video/mp4', '.wasm': 'application/wasm', '.json': 'application/json', '.task': 'application/octet-stream', '.tflite': 'application/octet-stream', '.webp': 'image/webp' }

const app = await createApp()

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`)
    if (url.pathname.startsWith('/api/')) return await sendWebResponse(res, await app.handle(await toWebRequest(req, `${req.headers['x-forwarded-proto'] === 'https' && app.cfg.security.trustProxy ? 'https' : 'http'}://${req.headers.host || 'localhost'}`)))
    if (!serveStatic) { res.writeHead(404); return res.end('Not found') }
    let file = normalize(join(dist, decodeURIComponent(url.pathname)))
    if (!file.startsWith(dist)) { res.writeHead(400); return res.end() }
    try { if ((await stat(file)).isDirectory()) file = join(file, 'index.html') }
    catch { if (extname(url.pathname)) { res.writeHead(404, { 'content-type': 'text/plain' }); return res.end('Not found') } file = join(dist, 'index.html') } // unknown page -> the website; missing file -> 404
    const body = await readFile(file)
    res.writeHead(200, { 'content-type': TYPES[extname(file)] || 'application/octet-stream', 'x-content-type-options': 'nosniff', 'cache-control': file.includes('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache', 'permissions-policy': 'camera=(self)' })
    res.end(body)
  } catch (e) { console.error('[server]', e); if (!res.headersSent) res.writeHead(500); res.end() }
})

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  server.listen(port, host, () => console.log(`Glamify Mirror Me running on http://localhost:${port} (storage: ${app.storage.driver}, outfit AI: ${app.cfg.providers.fashn.key ? 'FASHN' : app.cfg.providers.freeEnabled ? 'free (Hugging Face)' : 'off'})`))
  const t = setInterval(() => app.cleanup().catch((e) => console.error('[cleanup]', e.message)), 30 * 60_000); t.unref()
}
export { server, app }
