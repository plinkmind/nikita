// Live studio: category switching. Checks that each category runs the right tracking models, that the guidance text belongs to
// the open category (no hand instructions on the makeup tab), that the 3D face mask is used, and that there are no console
// errors. Fake camera = the rendered 3D head video (tests/rig/make-video.mjs). Needs the dev server on :5199.
// usage: node tests/e2e/categories.e2e.mjs rig.y4m [out.json] [--mesh=0]
import { chromium } from 'playwright'
import fs from 'node:fs'
const [, , video, outFile] = process.argv
const meshOff = process.argv.includes('--mesh=0')
const browser = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-video-capture=${video}`, '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] })
const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 }, permissions: ['camera'] })
const page = await ctx.newPage()
const errors = []; page.on('pageerror', (e) => errors.push('pageerror: ' + e.message)); page.on('console', (m) => { if (m.type() === 'error' && !/XNNPACK|TensorFlow|fonts\.g/.test(m.text())) errors.push(m.text()) })
page.on('requestfailed', (r) => errors.push('request failed (no internet in a test sandbox is expected for outside sites): ' + r.url().slice(0, 90)))
await page.goto('http://localhost:5199/?debug=stats' + (meshOff ? '&mesh=0' : ''))
await page.waitForTimeout(1500)
await page.evaluate(() => document.querySelector('[data-tryon]').click())
await page.waitForFunction(() => window.__glamify && window.__glamify.frames > 3, null, { timeout: 180000 })
const tab = (t) => page.evaluate((t) => document.querySelector(`.ts-tabs [data-tab="${t}"]`).click(), t)
const add = (id) => page.evaluate((id) => document.querySelector(`[data-p="${id}"]`).click(), id)
const rm = (id) => page.evaluate((id) => document.querySelector(`.ts-applied [data-rm="${id}"]`)?.click(), id)
const g = async (label, wait = 4000) => { await page.waitForTimeout(wait); const s = await page.evaluate(() => { const g = window.__glamify; return { need: g.need, models: g.models, hint: g.hint, mesh: g.mesh, presence: g.presence, procMs: g.procMs, drawMs: g.drawMs } }); s.label = label; console.log(JSON.stringify(s)); return s }
const R = []
await tab('makeup'); await add('foundation'); await add('blush'); await add('lipstick'); R.push(await g('makeup: foundation+blush+lipstick', 6000))
await tab('nails'); await add('np-red'); R.push(await g('nails tab, nail polish on (no hand in view)', 8000))
await tab('makeup'); R.push(await g('back on makeup tab, nails still applied'))
await rm('np-red'); R.push(await g('nails removed'))
await tab('jewellery'); await add('jhumkas'); await add('necklace'); R.push(await g('jewellery: jhumkas+necklace', 8000))
await tab('hair'); await add('haircolor'); R.push(await g('hair colour', 8000))
await tab('outfits'); await add('o-custom'); await page.setInputFiles('[data-up]', 'tests/img/garment-tee.png'); R.push(await g('outfit: garment photo', 6000))
await page.locator('.ts-out').screenshot({ path: (outFile || 'categories').replace(/\.json$/, '') + '.png', timeout: 180000 })
await page.evaluate(() => document.querySelector('[data-a="reset"]').click()); R.push(await g('reset all, makeup tab'))
console.log(JSON.stringify({ errors }))
if (outFile) fs.writeFileSync(outFile, JSON.stringify({ R, errors }, null, 1))
await browser.close()
