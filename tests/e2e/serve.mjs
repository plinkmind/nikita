// End-to-end test server: the REAL backend (backend/server.js) serving the BUILT website (dist/), with the paid AI provider
// replaced by local mocks of its documented API (no keys needed, nothing leaves this computer).
//   MODE=fashn  -> FASHN mock answers (tests the server-side AI path)
//   MODE=free   -> no paid key: the free IDM-VTON mode; set FREE_TRYON_SPACE to a local copy of the Space (tests/standin)
// usage: npm run build && MODE=fashn node tests/e2e/serve.mjs 5300
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { startMockProviders } from '../backend/helpers.mjs'

const port = Number(process.argv[2] || 5300), mode = process.env.MODE || 'fashn'
const mocks = await startMockProviders()
Object.assign(process.env, mocks.env, { STORAGE_DRIVER: 'fs', DATA_DIR: await mkdtemp(join(tmpdir(), 'glamify-e2e-')), PROVIDER_CHECK_MS: '500', SECURE_COOKIES: 'false' })
if (mode === 'fashn') process.env.FASHN_API_KEY = 'fa-e2e'
// lets the browser test switch the mock's behaviour (e.g. a failed generation)
const http = await import('node:http')
http.createServer((req, res) => { const m = /fashnMode=(\w+)/.exec(req.url); if (m) mocks.st.fashnMode = m[1]; res.end(JSON.stringify({ fashnMode: mocks.st.fashnMode, runs: mocks.st.fashnRuns })) }).listen(port + 1000)
const { server } = await import('../../backend/server.js')
server.listen(port, '127.0.0.1', () => console.log(`e2e site + backend on http://127.0.0.1:${port} (mode ${mode})`))
