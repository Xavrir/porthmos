import { join } from 'node:path'
import { APP, STATE, Human, Recorder, launch, makeWallet, prepState, sleep } from './lib.mjs'

// Pipeline check on a throwaway profile: opens /signup and the wallet picker, then closes it. Nothing is signed or sent.
await prepState()
const wallet = makeWallet({ maxTx: 0, clip: 'smoke' })
const { ctx, page } = await launch({ wallet, profile: join(STATE, 'smoke-profile'), fresh: true })
await page.goto(`${APP}/signup`, { waitUntil: 'networkidle' })
await sleep(1500)
const h = new Human(page)
await h.place(1100, 600)
const rec = new Recorder(page, 'smoke')
await rec.start()
await h.drift(1500)
await h.click(page.locator('#signup-wallet'))
rec.mark('walletPicker')
await sleep(1500)
console.log(await page.locator('.wp-list').innerText())
await page.screenshot({ path: join(rec.dir, 'picker.png') })
await h.click(page.locator('.wp-close'))
await sleep(1000)
await rec.stop()
await ctx.close()
