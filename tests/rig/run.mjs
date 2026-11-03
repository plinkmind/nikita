// Runs a harness test in headless Chromium against the Vite dev server (start it with VITE_MODEL_BASE=/models/ npx vite --port 5199).
// usage: node tests/rig/run.mjs "test=explore" out.png
import { chromium } from 'playwright'
const [, , query = 'test=anchors', shot] = process.argv
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] })
const page = await browser.newPage({ viewport: { width: 1000, height: 800 } })
const errors = []; page.on('pageerror', (e) => errors.push(String(e))); page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
await page.goto(`http://localhost:5199/tests/rig/rig.html?${query}`)
await page.waitForFunction(() => window.__result, null, { timeout: 600000 })
const r = await page.evaluate(() => window.__result)
if (shot) await page.locator('#c').screenshot({ path: shot })
if (process.env.OUT) { (await import('node:fs')).writeFileSync(process.env.OUT, JSON.stringify(r)); console.log('saved', process.env.OUT, r.frames ? r.frames.length + ' frames' : '', r.detMs ? 'det ' + r.detMs.toFixed(0) + ' ms' : '') } else console.log(JSON.stringify(r, null, 1))
if (errors.length) console.log('PAGE ERRORS:', errors.slice(0, 5).join('\n'))
await browser.close()
