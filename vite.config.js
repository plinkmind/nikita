import { loadEnv } from 'vite'

// Runs the real backend (backend/src/app.js) inside the Vite dev server, so `npm run dev` gives you the website AND the API
// on the same address (http://localhost:5173/api/...). Data is stored in the .data/ folder. Server-side settings (API keys)
// are read from .env but are NOT put into the website code: only variables starting with VITE_ ever reach the browser.
function glamifyApi() {
  let appP = null
  const mount = (server, mode) => {
    server.middlewares.use(async (req, res, next) => {
      if (!req.url.startsWith('/api/')) return next()
      try {
        const env = { ...loadEnv(mode, process.cwd(), ''), ...process.env }
        appP ||= import('./backend/src/app.js').then((m) => m.createApp({ env: { STORAGE_DRIVER: 'fs', ...env } }))
        const app = await appP, { toWebRequest, sendWebResponse } = await import('./backend/src/node-adapter.js')
        await sendWebResponse(res, await app.handle(await toWebRequest(req, `http://${req.headers.host || 'localhost'}`)))
      } catch (e) { console.error('[api]', e); res.statusCode = 500; res.end('{"error":{"code":"server_error","message":"Backend failed to start. See the terminal."}}') }
    })
  }
  return { name: 'glamify-api', configureServer: (s) => mount(s, s.config.mode), configurePreviewServer: (s) => mount(s, s.config.mode) }
}

export default {
  plugins: [glamifyApi()],
  server: { host: true }, // lets you open the dev site from your phone on the same Wi-Fi
  preview: { host: true },
  build: {
    chunkSizeWarningLimit: 800,
    rollupOptions: {
      output: { manualChunks: { three: ['three'] } }, // three.js in its own file, cached separately
    },
  },
}
