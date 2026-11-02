// End-to-end test of "See It On You" in headless Chromium against tests/serve.mjs (site + real function + mock provider).
import { chromium } from 'playwright'
const [, , base = 'http://localhost:5300', out = '.', person, dress, tiny, txt, nokey = 'http://localhost:5301'] = process.argv
const b = await chromium.launch(), log = [], errors = []
const check = (n, ok) => { log.push(`${ok ? 'PASS' : 'FAIL'}  ${n}`) }
for (const [vw, vh, name] of [[1440, 900, 'desktop'], [820, 1180, 'tablet'], [390, 844, 'phone']]) {
  const ctx = await b.newContext({ viewport: { width: vw, height: vh }, acceptDownloads: true, hasTouch: name !== 'desktop' }), p = await ctx.newPage()
  p.on('pageerror', (e) => errors.push(`${name}: ${e.message}`))
  await p.goto(base); await p.waitForTimeout(800)
  await p.evaluate(() => document.querySelector('[data-aitryon]').click())
  await p.waitForSelector('.at:not([hidden])'); await p.waitForFunction(() => !document.querySelector('.at-why').textContent.includes('Checking'))
  check(`${name}: opens, AI service reported ready${process.env.FREE ? ' (free mode)' : ''}`, /Add your photo/.test(await p.textContent('.at-why')) && (!process.env.FREE || await p.isVisible('.at-mode')))
  // validation
  await p.setInputFiles('[data-slot="person"] input', txt); await p.waitForTimeout(200)
  check(`${name}: non-image rejected with a message`, /JPG, PNG or WebP/.test(await p.textContent('[data-slot="person"] .at-warn')))
  await p.setInputFiles('[data-slot="person"] input', tiny); await p.waitForTimeout(300)
  check(`${name}: too-small image rejected`, /too small/.test(await p.textContent('[data-slot="person"] .at-warn')))
  // uploads + previews
  await p.setInputFiles('[data-slot="person"] input', person); await p.setInputFiles('[data-slot="garment"] input', dress); await p.waitForTimeout(600)
  check(`${name}: both previews shown`, await p.isVisible('[data-slot="person"] img') && await p.isVisible('[data-slot="garment"] img'))
  check(`${name}: generate disabled until consent`, await p.isDisabled('.at-gen'))
  await p.selectOption('[data-at-cat]', 'one-pieces'); await p.check('[data-at-consent]')
  check(`${name}: generate enabled`, !(await p.isDisabled('.at-gen')))
  if (name === 'desktop' || name === 'phone') await p.screenshot({ path: `${out}/at_${name}_ready.png`, fullPage: false })
  await p.click('.at-gen'); await p.waitForSelector('.at-work:not([hidden])'); await p.waitForTimeout(2300)
  check(`${name}: loading shows real stage + elapsed time`, /Waiting|Generating|Preparing|Connecting|Sending/.test(await p.textContent('.at-stage')) && /s elapsed/.test(await p.textContent('.at-time')))
  if (name !== 'tablet') await p.screenshot({ path: `${out}/at_${name}_loading.png` })
  await p.waitForSelector('.at-result:not([hidden])', { timeout: 60000 })
  check(`${name}: result shown (image returned by the provider)`, await p.evaluate(() => /^data:image\/(jpeg|png|webp);base64,/.test(document.querySelector('.at-after').src)))
  await p.locator('.at-cmp').scrollIntoViewIfNeeded(); await p.waitForTimeout(900)
  const box = await p.locator('.at-cmp').boundingBox(); await p.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.5); await p.mouse.down(); await p.mouse.move(box.x + box.width * 0.8, box.y + box.height * 0.5); await p.mouse.up()
  check(`${name}: before/after divider drags`, Math.abs(parseFloat(await p.evaluate(() => getComputedStyle(document.querySelector('.at-cmp')).getPropertyValue('--split'))) - 80) < 3)
  await p.screenshot({ path: `${out}/at_${name}_result.png` })
  const [dl] = await Promise.all([p.waitForEvent('download'), p.click('[data-at="download"]')])
  check(`${name}: download gives an image file`, /glamify-my-look\.(jpg|png)/.test(dl.suggestedFilename()))
  await p.click('[data-at="another"]'); await p.waitForTimeout(300)
  check(`${name}: try another outfit keeps your photo, clears outfit + result`, await p.isVisible('[data-slot="person"] img') && !(await p.isVisible('[data-slot="garment"] img')) && await p.isHidden('.at-result'))
  check(`${name}: no horizontal overflow`, await p.evaluate(() => document.querySelector('.at').scrollWidth <= innerWidth + 1))
  await ctx.close()
}
// service not configured: honest message, no result possible
if (process.env.FREE_OFF) { // only in a build with VITE_FREE_TRYON=off: otherwise free mode takes over when no key is set
  const p = await b.newPage(); await p.goto(nokey); await p.waitForTimeout(500); await p.evaluate(() => document.querySelector('[data-aitryon]').click())
  await p.waitForSelector('.at:not([hidden])'); await p.waitForFunction(() => !document.querySelector('.at-status').textContent.includes('Checking'))
  check('no API key: clear "not switched on" message', /not switched on yet/.test(await p.textContent('.at-status')))
  await p.setInputFiles('[data-slot="person"] input', person); await p.setInputFiles('[data-slot="garment"] input', dress); await p.check('[data-at-consent]')
  check('no API key: generate stays disabled', await p.isDisabled('.at-gen'))
  await p.screenshot({ path: `${out}/at_nokey.png` }) }
console.log(log.join('\n')); if (errors.length) console.log('PAGE ERRORS', errors)
console.log(`\n${log.filter((l) => l.startsWith('PASS')).length}/${log.length} passed`); await b.close()
