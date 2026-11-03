// Full-stack browser test (headless Chromium): real website + real backend (tests/e2e/serve.mjs), AI provider mocked.
// usage: node tests/e2e/fullstack.e2e.mjs <site url> <screenshot dir> <person image> <garment image> [mode: fashn|free]
import { chromium } from 'playwright'
const [, , base = 'http://127.0.0.1:5300', out = '.', person, garment, mode = 'fashn'] = process.argv
const ctlUrl = base.replace(/:(\d+)$/, (_, p) => `:${+p + 1000}`)
const log = [], errors = []
const check = (n, ok, extra = '') => log.push(`${ok ? 'PASS' : 'FAIL'}  ${n}${ok ? '' : '  ' + extra}`)
const b = await chromium.launch()

async function openAi(p) {
  await p.evaluate(() => document.querySelector('[data-aitryon]').click())
  await p.waitForSelector('.at:not([hidden])'); await p.waitForFunction(() => !/Checking/.test(document.querySelector('.at-why').textContent))
}
async function generate(p) {
  await p.setInputFiles('[data-slot="person"] input', person); await p.setInputFiles('[data-slot="garment"] input', garment)
  await p.waitForSelector('[data-slot="garment"] img:not([hidden])')
  if (!(await p.isChecked('[data-at-consent]'))) await p.check('[data-at-consent]')
  await p.click('.at-gen')
}

for (const [vw, vh, name] of [[1440, 900, 'desktop'], [390, 844, 'phone']]) {
  const ctx = await b.newContext({ viewport: { width: vw, height: vh }, acceptDownloads: true, hasTouch: name === 'phone' }), p = await ctx.newPage()
  p.on('pageerror', (e) => errors.push(`${name}: ${e.message}`)); p.on('dialog', (d) => d.accept())
  await p.goto(base); await p.waitForTimeout(800)
  check(`${name}: header shows the account button (signed out)`, /Sign in/i.test(await p.getAttribute('[data-account]', 'aria-label')))
  await openAi(p)
  check(`${name}: backend reports the ${mode === 'free' ? 'free' : 'server'} AI as ready`, /Add your photo/.test(await p.textContent('.at-why')) && (mode === 'free') === (await p.isVisible('.at-mode')))
  check(`${name}: guest notice shown`, /guest/i.test(await p.textContent('.at-who')))
  // 1. guest generation (upload -> generate -> status polling -> private result image)
  await generate(p)
  await p.waitForSelector('.at-work:not([hidden])'); await p.waitForTimeout(700)
  check(`${name}: loading state with real stage + elapsed time`, /elapsed/.test(await p.textContent('.at-time')))
  if (name === 'phone') await p.screenshot({ path: `${out}/fs_${name}_loading.png` })
  await p.waitForSelector('.at-result:not([hidden])', { timeout: 90000 })
  check(`${name}: generated image shown (from the private image endpoint)`, await p.evaluate(() => document.querySelector('.at-after').src.startsWith('blob:')))
  check(`${name}: "saved to My looks" for a guest`, /24 hours/.test(await p.textContent('.at-saved')))
  await p.waitForSelector('.at-hist:not([hidden]) .at-look img', { timeout: 15000 })
  check(`${name}: My looks lists the new look with its image`, (await p.locator('.at-look').count()) === 1)
  const [dl] = await Promise.all([p.waitForEvent('download'), p.click('[data-at="download"]')])
  check(`${name}: download result`, /glamify-my-look\.(png|jpg)/.test(dl.suggestedFilename()))
  await p.screenshot({ path: `${out}/fs_${name}_result.png` })
  // 2. sign up from the guest notice: the guest look moves into the account
  await p.click('.at-who [data-at="signup"]'); await p.waitForSelector('.ac:not([hidden]) form')
  const email = `nikita.${name}.${Date.now()}@glamify.test`
  await p.fill('.ac [name="name"]', 'Nikita'); await p.fill('.ac [name="email"]', email); await p.fill('.ac [name="password"]', 'velvet-mirror-42')
  await p.click('.ac .ac-primary'); await p.waitForSelector('.ac-msg')
  check(`${name}: account created and the guest look claimed`, /1 look from this visit was saved/.test(await p.textContent('.ac-msg')), await p.textContent('.ac-msg'))
  await p.waitForFunction(() => /Saved AI looks\s*1/.test(document.querySelector('.ac-card')?.textContent || ''))
  if (name === 'phone') await p.screenshot({ path: `${out}/fs_${name}_account.png` })
  await p.click('.ac [data-ac="close"]')
  check(`${name}: header shows the signed-in name`, (await p.textContent('[data-account] .acct-t')) === 'Nikita' && (await p.getAttribute('[data-account]', 'class')).includes('in'))
  await p.waitForFunction(() => /Signed in as/.test(document.querySelector('.at-who').textContent))
  check(`${name}: AI page knows you are signed in, history kept`, (await p.locator('.at-look').count()) === 1)
  // 3. a second look as a signed-in user, then delete one
  await p.click('[data-at="another"]'); await generate(p)
  await p.waitForSelector('.at-result:not([hidden])', { timeout: 90000 })
  check(`${name}: "saved to your account"`, /account/.test(await p.textContent('.at-saved')))
  await p.waitForFunction(() => document.querySelectorAll('.at-look').length === 2)
  await p.click('.at-look [data-look-del]'); await p.waitForFunction(() => document.querySelectorAll('.at-look').length === 1)
  check(`${name}: delete a look`, (await p.locator('.at-look').count()) === 1)
  // 4. sign out, sign in again: history comes back; signed out it is hidden
  await p.click('[data-at="close"]'); await p.evaluate(() => document.querySelector('[data-account]').click()); await p.waitForSelector('.ac:not([hidden])'); await p.click('.ac [data-ac="logout"]'); await p.waitForSelector('.ac form')
  await p.fill('.ac [name="email"]', email); await p.fill('.ac [name="password"]', 'wrong-password-1'); await p.click('.ac .ac-primary'); await p.waitForSelector('.ac-msg.err')
  check(`${name}: wrong password -> clear message`, /Wrong e-mail or password/.test(await p.textContent('.ac-msg')))
  await p.fill('.ac [name="password"]', 'velvet-mirror-42'); await p.click('.ac .ac-primary'); await p.waitForSelector('.ac-msg:not(.err)')
  await p.waitForFunction(() => /Saved AI looks\s*1/.test(document.querySelector('.ac-card')?.textContent || ''))
  check(`${name}: sign in again, profile shows 1 saved look`, true)
  await p.click('.ac [data-ac="close"]'); await openAi(p)
  await p.waitForFunction(() => document.querySelectorAll('.at-look img').length === 1)
  check(`${name}: history after signing in again`, true)
  // 5. failure path (FASHN mode only): honest error, no result
  if (mode === 'fashn') {
    await fetch(`${ctlUrl}/?fashnMode=pose`)
    await p.click('[data-at="another"]'); await generate(p)
    await p.waitForSelector('.at-status.error:not([hidden])', { timeout: 60000 })
    check(`${name}: failed generation -> clear message, no image`, /body pose/.test(await p.textContent('.at-status')) && await p.isHidden('.at-result'))
    await fetch(`${ctlUrl}/?fashnMode=ok`)
  }
  check(`${name}: no horizontal overflow`, await p.evaluate(() => document.querySelector('.at').scrollWidth <= innerWidth + 1))
  if (name === 'desktop') { await p.evaluate(() => document.querySelector('.at-hist').scrollIntoView()); await p.waitForTimeout(400); await p.screenshot({ path: `${out}/fs_${name}_history.png` }) }
  await ctx.close()
}
console.log(log.join('\n')); if (errors.length) console.log('PAGE ERRORS', errors)
console.log(`\n${log.filter((l) => l.startsWith('PASS')).length}/${log.length} passed`); await b.close()
process.exit(log.every((l) => l.startsWith('PASS')) && !errors.length ? 0 : 1)
