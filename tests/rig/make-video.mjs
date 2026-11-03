// Renders the head-rig fake-camera video: node tests/rig/make-video.mjs out.y4m   (needs the dev server on :5199 and ffmpeg)
import { chromium } from 'playwright'
import fs from 'node:fs'
import { execFileSync } from 'node:child_process'
const out = process.argv[2] || 'rig.y4m', dir = fs.mkdtempSync('/tmp/rigframes-')
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] })
const page = await browser.newPage()
await page.exposeFunction('__saveFrame', (i, url) => fs.writeFileSync(`${dir}/f${String(i).padStart(4, '0')}.png`, Buffer.from(url.split(',')[1], 'base64')))
await page.goto('http://localhost:5199/tests/rig/rig.html?test=video')
await page.waitForFunction(() => window.__result, null, { timeout: 900000 })
const r = await page.evaluate(() => window.__result); await browser.close()
execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-framerate', String(r.fps), '-i', `${dir}/f%04d.png`, '-pix_fmt', 'yuv420p', out])
fs.writeFileSync(out.replace(/\.y4m$/, '.plan.json'), JSON.stringify(r))
fs.rmSync(dir, { recursive: true })
console.log('video', out, r.frames, 'frames at', r.fps, 'fps')
