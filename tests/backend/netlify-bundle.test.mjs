// Production-path check: bundles netlify/functions/api.mjs with esbuild (as Netlify does) and calls it with ONLY the
// environment Netlify provides (NETLIFY=true + NETLIFY_BLOBS_CONTEXT), against @netlify/blobs' local Blobs server.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { build } from 'esbuild'
import { BlobsServer } from '@netlify/blobs/server'
import { png } from './helpers.mjs'

test('bundled Netlify function: auto-selects Blobs, accounts + free try-on + private image work', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'glamify-fn-'))
  const blobs = new BlobsServer({ directory: join(dir, 'blobs'), token: 'ctx-token' }), { port } = await blobs.start()
  try {
    await build({ entryPoints: ['netlify/functions/api.mjs'], bundle: true, platform: 'node', format: 'esm', outfile: join(dir, 'api.mjs'), logLevel: 'silent', banner: { js: "import { createRequire } from 'module'; const require = createRequire(import.meta.url);" } })
    await build({ entryPoints: ['netlify/functions/cleanup.mjs'], bundle: true, platform: 'node', format: 'esm', outfile: join(dir, 'cleanup.mjs'), logLevel: 'silent', banner: { js: "import { createRequire } from 'module'; const require = createRequire(import.meta.url);" } })
    process.env.NETLIFY = 'true'
    process.env.NETLIFY_BLOBS_CONTEXT = Buffer.from(JSON.stringify({ edgeURL: `http://127.0.0.1:${port}`, uncachedEdgeURL: `http://127.0.0.1:${port}`, siteID: 'site-prod', token: 'ctx-token' })).toString('base64')
    const fn = (await import(pathToFileURL(join(dir, 'api.mjs')).href)).default
    const site = 'https://glamify-prod.netlify.app', h = { origin: site, 'x-requested-with': 'glamify', 'x-nf-client-connection-ip': '1.2.3.4' }
    const health = await (await fn(new Request(`${site}/api/health`))).json()
    assert.equal(health.storage, 'blobs'); assert.equal(health.database, 'ok')
    const reg = await fn(new Request(`${site}/api/auth/register`, { method: 'POST', headers: { ...h, 'content-type': 'application/json' }, body: JSON.stringify({ email: 'prod@glamify.test', password: 'velvet-mirror-42' }) }))
    assert.equal(reg.status, 201)
    const cookie = reg.headers.getSetCookie()[0].split(';')[0]
    assert.match(reg.headers.getSetCookie()[0], /Secure/) // production: Secure cookies
    const fd = new FormData(); fd.append('type', 'outfit'); fd.append('consent', 'true')
    const g = await (await fn(new Request(`${site}/api/tryon/generate`, { method: 'POST', headers: { ...h, cookie }, body: fd }))).json()
    const fd2 = new FormData(); fd2.append('result', new Blob([png(320, 480)]), 'r.png')
    const c = await (await fn(new Request(`${site}/api/tryon/${g.job.id}/complete`, { method: 'POST', headers: { ...h, cookie }, body: fd2 }))).json()
    assert.equal(c.job.status, 'succeeded')
    const img = await fn(new Request(`${site}${c.job.result.url}`, { headers: { cookie } }))
    assert.equal(img.status, 200); assert.equal(img.headers.get('content-type'), 'image/png')
    assert.equal((await fn(new Request(`${site}${c.job.result.url}`))).status, 404) // no cookie, no image
    const cleanup = (await import(pathToFileURL(join(dir, 'cleanup.mjs')).href)).default
    assert.equal((await cleanup(new Request(`${site}/.netlify/functions/cleanup`))).status, 204)
  } finally { delete process.env.NETLIFY; delete process.env.NETLIFY_BLOBS_CONTEXT; await blobs.stop(); await rm(dir, { recursive: true, force: true }) }
})
