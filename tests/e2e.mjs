// End-to-end test of the real studio in headless Chromium with a FAKE CAMERA fed from a video file.
// usage: node tests/e2e.mjs <video.y4m> <outPrefix> <product ids comma separated> [garment image]
import { chromium } from 'playwright'
const [, , video, outp, ids, garment] = process.argv
const browser = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-video-capture=${video}`, '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] })
const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 }, permissions: ['camera'] })
const page = await ctx.newPage()
const errors = []; page.on('pageerror', (e) => errors.push('pageerror: ' + e.message)); page.on('console', (m) => { if (m.type() === 'error' && !/XNNPACK|TensorFlow/.test(m.text())) errors.push(m.text()) })
await page.goto('http://localhost:5199/' + (process.env.NODEBUG ? '' : '?debug'))
await page.waitForTimeout(1500)
await page.evaluate(() => document.querySelector('[data-tryon]').click())
await page.waitForFunction(() => window.__glamify && window.__glamify.frames > 5, null, { timeout: process.env.NODEBUG ? 15000 : 120000 }).catch(() => {})
const tabOf = { np: 'nails', o: 'outfits', haircolor: 'hair' }
for (const id of ids.split(',')) {
  const tab = Object.entries(tabOf).find(([k]) => id.startsWith(k))?.[1] || (['lipstick', 'eyeliner', 'eyeshadow', 'blush', 'brows', 'mascara', 'highlighter', 'foundation', 'gloss', 'concealer', 'primer'].includes(id) ? 'makeup' : 'jewellery')
  await page.click(`.ts-tabs [data-tab="${tab}"]`); await page.click(`[data-p="${id}"]`)
}
if (garment) { await page.setInputFiles('[data-up]', garment) }
if (process.env.SHADE) await page.click(`.ts-sw [data-s="${process.env.SHADE}"]`)
const shots = [], stats = []
for (const [i, t] of [1.2, 3.0, 4.6, 6.2, 7.5, 9.4].entries()) {
  await page.waitForTimeout(i === 0 ? 6000 : 1600)
  await page.locator('.ts-out').screenshot({ path: `${outp}_${i}.png`, timeout: 120000 }); shots.push(`${outp}_${i}.png`)
  stats.push(await page.evaluate(() => window.__glamify))
}
console.log(JSON.stringify({ stats, errors: errors.slice(0, 8) }, null, 0))
await browser.close()
