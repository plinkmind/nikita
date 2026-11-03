// Free-mode edge cases: (1) static hosting with NO backend: free mode still works, nothing saved, clear note;
// (2) the free service is down: clear message, the job is recorded as failed (no fake result).
import { chromium } from 'playwright'
const [, , staticUrl, downUrl, person, garment] = process.argv
const b = await chromium.launch(), log = []; const check = (n, ok, x = '') => log.push(`${ok ? 'PASS' : 'FAIL'}  ${n}${ok ? '' : '  ' + x}`)
const run = async (url) => {
  const p = await b.newPage({ viewport: { width: 1280, height: 860 } }); await p.goto(url); await p.waitForTimeout(600)
  await p.evaluate(() => document.querySelector('[data-aitryon]').click()); await p.waitForSelector('.at:not([hidden])'); await p.waitForFunction(() => !/Checking/.test(document.querySelector('.at-why').textContent))
  await p.setInputFiles('[data-slot="person"] input', person); await p.setInputFiles('[data-slot="garment"] input', garment); await p.waitForSelector('[data-slot="garment"] img:not([hidden])')
  await p.check('[data-at-consent]'); return p
}
let p = await run(staticUrl)
check('no backend: free mode offered, with a "will not be saved" note', /will not be saved/.test(await p.textContent('.at-mode')) && await p.isHidden('.at-who'))
await p.click('.at-gen'); await p.waitForSelector('.at-result:not([hidden])', { timeout: 60000 })
check('no backend: result shown from the free service, marked as not saved', /Not saved/.test(await p.textContent('.at-saved')))
await p.close()
p = await run(downUrl)
await p.click('.at-gen'); await p.waitForSelector('.at-status.error:not([hidden])', { timeout: 60000 })
check('free service down: clear message, no result', /not reachable/.test(await p.textContent('.at-status')) && await p.isHidden('.at-result'))
await p.waitForSelector('.at-look', { timeout: 10000 })
check('free service down: the attempt is recorded as failed in My looks', /Not generated/.test(await p.textContent('.at-look')))
console.log(log.join('\n')); console.log(`\n${log.filter((l) => l.startsWith('PASS')).length}/${log.length} passed`); await b.close()
