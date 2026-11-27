import { loadEnv } from 'vite'
import { existsSync, statSync } from 'node:fs'

// Runs the real backend (backend/src/app.js) inside the Vite dev server, so `npm run dev` gives you the website AND the API
// on the same address (http://localhost:5173/api/...). Data is stored in the .data/ folder. Server-side settings (API keys)
// are read from .env but are NOT put into the website code: only variables starting with VITE_ ever reach the browser.
// The .env files are re-read when they change, so a key added while `npm run dev` is running works at once ("Check again" on
// the page): no restart needed.
const ENV_FILES = (mode) => ['.env', '.env.local', `.env.${mode}`, `.env.${mode}.local`]
const envStamp = (mode) => ENV_FILES(mode).map((f) => { try { return statSync(f).mtimeMs } catch { return 0 } }).join(',')
function glamifyApi() {
  let appP = null, stamp = ''
  const mount = (server, mode) => {
    server.middlewares.use(async (req, res, next) => {
      if (!req.url.startsWith('/api/')) return next()
      try {
        const now = envStamp(mode)
        if (appP && now !== stamp) { appP = null; console.log('[api] .env changed: backend reloaded with the new settings') }
        stamp = now
        const env = { ...loadEnv(mode, process.cwd(), ''), ...process.env }
        appP ||= import('./backend/src/app.js').then((m) => m.createApp({ env: { STORAGE_DRIVER: 'fs', ...env } }))
          .then((app) => { const r = app.cfg.providers.replicate.token; console.log(`[api] backend ready. REPLICATE_API_TOKEN: ${r ? `set (${r.slice(0, 3)}...${r.length} characters)` : 'NOT SET (add it to .env next to package.json)'}`); return app })
        const app = await appP, { toWebRequest, sendWebResponse } = await import('./backend/src/node-adapter.js')
        await sendWebResponse(res, await app.handle(await toWebRequest(req, `http://${req.headers.host || 'localhost'}`)))
      } catch (e) { console.error('[api]', e); res.statusCode = 500; res.end('{"error":{"code":"server_error","message":"Backend failed to start. See the terminal."}}') }
    })
  }
  return { name: 'glamify-api', configureServer: (s) => mount(s, s.config.mode), configurePreviewServer: (s) => mount(s, s.config.mode) }
}

// Link previews need the full site address. Netlify sets URL during every build (your custom domain once you add one);
// elsewhere set SITE_URL in .env, e.g. SITE_URL=https://www.example.com
function siteUrl() {
  let url = ''
  return {
    name: 'glamify-site-url',
    configResolved(c) { const env = { ...loadEnv(c.mode, process.cwd(), ''), ...process.env }; url = (env.SITE_URL || env.URL || '').replace(/\/+$/, '') },
    transformIndexHtml: (html) => html.replaceAll('%SITE_URL%', url),
  }
}

export default {
  plugins: [glamifyApi(), siteUrl()],
  // true when the MediaPipe models were downloaded into public/models (npm run fetch-models, also run before every build):
  // the site then serves them itself (src/tryon/track/mediapipe.js)
  define: { __LOCAL_MODELS__: JSON.stringify(existsSync('public/models/face_landmarker/face_landmarker/float16/1/face_landmarker.task')) },
  server: { host: true }, // lets you open the dev site from your phone on the same Wi-Fi
  preview: { host: true },
  build: {
    chunkSizeWarningLimit: 800,
    rollupOptions: {
      output: { manualChunks: { three: ['three'] } }, // three.js in its own file, cached separately
    },
  },
}
