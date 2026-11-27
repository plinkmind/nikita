// REAL AI Photo Makeover test, from the command line, with YOUR key from .env. No mocks: this calls Replicate (and FASHN /
// Anthropic if their keys are set), exactly like the website does, and costs a few cents per run.
//
//   npm run makeover:check                                   free: checks the key and the models, generates nothing
//   npm run makeover:live -- <your-photo.jpg> "<outfit description>" [occasion] ["your instructions"] [--garment=<outfit.jpg>]
//   e.g. npm run makeover:live -- me.jpg "Red bridal lehenga with golden embroidery" bridal "golden eyes, deep red lips"
//
// The generated photo is saved to test-results/ and the AI's makeup plan is printed. Data goes to .data-live/ (git-ignored).
import { readFileSync, mkdirSync, writeFileSync, existsSync } from 'node:fs'
import { join, dirname, resolve, extname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadDotEnv } from '../backend/src/dotenv.js'
import { createApp } from '../backend/src/app.js'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
loadDotEnv(join(root, '.env'))
const args = process.argv.slice(2), flags = Object.fromEntries(args.filter((a) => a.startsWith('--')).map((a) => { const [k, ...v] = a.slice(2).split('='); return [k, v.join('=') || true] }))
const [photo, outfitText = '', occasion = '', instructions = ''] = args.filter((a) => !a.startsWith('--'))
const ORIGIN = 'http://localhost'
const app = await createApp({ env: { ...process.env, STORAGE_DRIVER: 'fs', DATA_DIR: join(root, '.data-live') }, logger: { error: (...a) => console.error('[backend]', ...a) } })
const tok = app.cfg.providers.replicate.token
console.log(`REPLICATE_API_TOKEN: ${tok ? `found (${tok.slice(0, 3)}...${tok.length} characters)` : 'NOT FOUND in .env'}`)
console.log(`Models: stylist ${app.cfg.makeover.anthropic.key && app.cfg.makeover.stylist !== 'replicate' ? app.cfg.makeover.anthropic.model + ' (Anthropic)' : app.cfg.makeover.stylistModel}, image editor ${app.cfg.makeover.editModel}${app.cfg.providers.fashn.key ? ', outfit photos: FASHN' : ''}`)
if (!tok) { console.error('\nAdd REPLICATE_API_TOKEN=r8_... to the .env file next to package.json, then run again.'); process.exit(1) }

let jar = ''
async function call(method, path, form) {
  const h = { origin: ORIGIN, ...(method !== 'GET' ? { 'x-requested-with': 'glamify' } : {}), ...(jar ? { cookie: jar } : {}) }
  const res = await app.handle(new Request(ORIGIN + path, { method, headers: h, body: form }))
  const c = res.headers.getSetCookie().map((x) => x.split(';')[0]).filter((x) => !x.endsWith('=')); if (c.length) jar = c.join('; ')
  const ct = res.headers.get('content-type') || ''
  return { status: res.status, data: ct.includes('json') ? await res.json() : new Uint8Array(await res.arrayBuffer()), type: ct }
}

// 1. live setup check (free)
console.log('\n1. Checking the key and models on Replicate...')
const chk = (await call('GET', '/api/makeover/check')).data.check
const line = (n, x) => console.log(`   ${n.padEnd(9)} ${x?.ok ? 'OK' : 'PROBLEM'}${x?.model ? ' ' + x.model : ''}${x?.ok ? '' : ` -> ${x?.code}${x?.status ? ' HTTP ' + x.status : ''}${x?.detail ? ': ' + x.detail : ''}${x?.missing ? ' missing inputs: ' + x.missing.join(', ') : ''}`}`)
line('token', chk.token); if (chk.editor) line('editor', chk.editor); if (chk.stylist) line('stylist', chk.stylist)
if (!chk.ready) { console.error('\nNot ready: fix the problem above (README section S), then run again.'); process.exit(1) }
if (flags.check || !photo) { console.log(photo ? '' : '\nSetup OK. To create a real makeover: npm run makeover:live -- <photo.jpg> "<outfit description>" [occasion] ["instructions"]'); process.exit(0) }

// 2. a real makeover
const file = (p) => { const f = resolve(p); if (!existsSync(f)) { console.error(`File not found: ${f}`); process.exit(1) } return new Blob([readFileSync(f)], { type: { '.png': 'image/png', '.webp': 'image/webp' }[extname(f).toLowerCase()] || 'image/jpeg' }) }
const form = new FormData()
form.append('person', file(photo), 'person' + extname(photo))
if (flags.garment) form.append('garment', file(flags.garment), 'garment' + extname(flags.garment))
for (const [k, v] of Object.entries({ outfitText, occasion, instructions, hair: flags['no-hair'] ? 'false' : 'true', jewellery: flags['no-jewellery'] ? 'false' : 'true', consent: 'true' })) form.append(k, v)
console.log(`\n2. Creating a REAL makeover (this costs a few cents)\n   photo: ${photo}${flags.garment ? `\n   outfit photo: ${flags.garment}` : ''}\n   outfit: ${outfitText || '-'}  occasion: ${occasion || '-'}  instructions: ${instructions || '-'}`)
let r = await call('POST', '/api/makeover/generate', form)
if (r.status !== 202) { console.error(`   Refused (${r.status}): ${r.data?.error?.message || ''} ${r.data?.error?.missing ? r.data.error.missing.join(', ') : ''}`); process.exit(1) }
let job = r.data.job; const t0 = Date.now(); let last = ''
while (!['succeeded', 'failed'].includes(job.status) && Date.now() - t0 < 8 * 60_000) {
  if (job.stage !== last) { console.log(`   ${((Date.now() - t0) / 1000).toFixed(0).padStart(3)} s  ${job.stage}`); last = job.stage }
  await new Promise((ok) => setTimeout(ok, 2500))
  job = (await call('GET', `/api/makeover/status/${job.id}`)).data.job
}
if (job.status !== 'succeeded') { console.error(`\n   FAILED after ${Math.round((Date.now() - t0) / 1000)} s: ${job.error?.code} - ${job.error?.message || 'timed out'}${job.error?.detail ? `\n   Reason from the AI service: ${job.error.detail}` : ''}`); process.exit(1) }
const img = await call('GET', job.result.url)
mkdirSync(join(root, 'test-results'), { recursive: true })
const out = join(root, 'test-results', `makeover-live-${new Date().toISOString().replace(/[:.]/g, '-')}.${img.type.includes('png') ? 'png' : img.type.includes('webp') ? 'webp' : 'jpg'}`)
writeFileSync(out, img.data)
const p = job.plan
console.log(`\n   DONE in ${Math.round((Date.now() - t0) / 1000)} s: ${job.result.width} x ${job.result.height}, ${(img.data.length / 1024).toFixed(0)} KB\n   saved to ${out}`)
console.log(`\n3. The AI's plan: ${p.lookName}${p.why ? ' - ' + p.why : ''}\n   outfit seen: ${p.outfit?.summary || '-'} [${(p.outfit?.colours || []).join(', ')}]\n   skin as seen: ${p.skin?.tone || '-'}`)
for (const [k, v] of Object.entries(p.makeup || {})) console.log(`   ${k.padEnd(12)} ${v}`)
console.log(`   ${'hair'.padEnd(12)} ${p.hair}\n   ${'jewellery'.padEnd(12)} ${p.jewellery}${job.notes?.length ? `\n   notes: ${job.notes.join(', ')}` : ''}`)
console.log('\nOpen the saved photo and compare it with yours: same person? natural skin? makeup as in the plan?')
