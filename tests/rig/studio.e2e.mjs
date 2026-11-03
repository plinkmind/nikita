// Full live studio, fake camera = the rendered 3D head video (tests/rig/make-video.mjs). Screenshots at each held pose.
// usage: node tests/rig/studio.e2e.mjs rig.y4m outPrefix "lipstick,blush,jhumkas" [phone]
import { chromium } from 'playwright'
import fs from 'node:fs'
const [, , video, outp, ids, phone] = process.argv
const plan = JSON.parse(fs.readFileSync(video.replace(/\.y4m$/, '.plan.json'), 'utf8'))
const len = plan.frames / plan.fps, holds = []
plan.plan.forEach((n, i) => { if (n === 'move') return; const h = holds[holds.length - 1]; if (h && h.name === n) h.end = (i + 1) / plan.fps; else holds.push({ name: n, start: i / plan.fps, end: (i + 1) / plan.fps }) })
const browser = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-video-capture=${video}`, '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] })
const ctx = await browser.newContext(phone ? { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, permissions: ['camera'] } : { viewport: { width: 1400, height: 900 }, permissions: ['camera'] })
const page = await ctx.newPage()
const errors = []; page.on('pageerror', (e) => errors.push('pageerror: ' + e.message)); page.on('console', (m) => { if (m.type() === 'error' && !/XNNPACK|TensorFlow|fonts\.g/.test(m.text())) errors.push(m.text()) })
await page.goto('http://localhost:5199/' + (process.env.Q || '?debug=stats'))
await page.waitForTimeout(1500)
await page.evaluate(() => document.querySelector('[data-tryon]').click())
await page.waitForFunction(() => window.__glamify && window.__glamify.frames > 3, null, { timeout: 180000 })
const tabOf = (id) => (id.startsWith('np') ? 'nails' : id.startsWith('o-') ? 'outfits' : id === 'haircolor' ? 'hair' : ['lipstick', 'eyeliner', 'eyeshadow', 'blush', 'brows', 'mascara', 'highlighter', 'foundation', 'gloss', 'concealer', 'primer'].includes(id) ? 'makeup' : 'jewellery')
for (const id of ids.split(',')) { await page.evaluate((t) => document.querySelector(`.ts-tabs [data-tab="${t}"]`).click(), tabOf(id)); await page.evaluate((p) => document.querySelector(`[data-p="${p}"]`).click(), id) }
// which video frame is in the camera right now (read from the stamp in the top-left corner)
const vt = () => page.evaluate(`(() => { const v = document.querySelector('.ts-vid'), c = (window.__stampC ||= document.createElement('canvas')); c.width = 120; c.height = 10; const x = c.getContext('2d', { willReadFrequently: true }); x.drawImage(v, 0, 0, 120, 10, 0, 0, 120, 10); const d = x.getImageData(0, 0, 120, 10).data; let n = 0; for (let b = 0; b < 12; b++) if (d[(5 * 120 + b * 10 + 5) * 4] > 128) n |= 1 << b; return n / ${plan.fps} })()`)
const res = []
for (const h of holds) {
  const target = h.start + (h.end - h.start) * 0.7 // late in the hold: filters settled, frame being shown is from this hold
  for (;;) { const p = (await vt()) % len; const d = (target - p + len) % len; if (d < 0.25) break; await page.waitForTimeout(Math.min(800, d * 1000 - 150)) }
  const shot = `${outp}_${String(res.length).padStart(2, '0')}.png`
  await page.locator('.ts-out').screenshot({ path: shot, timeout: 120000 })
  res.push({ hold: h.name, shot, s: await page.evaluate(() => { const g = window.__glamify; return { yaw: g.yawDeg, presence: g.presence, models: g.models, hint: g.hint, ears: g.ears, neck: g.neck, procMs: g.procMs, faceMs: g.faceMs } }) })
}
console.log(JSON.stringify({ res, errors: errors.slice(0, 8) }))
await browser.close()
