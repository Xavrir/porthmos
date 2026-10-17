// Playwright CLI run-code snippet: TradeFlow Orders end to end against a live local stack (Anvil 31337 + service + web dev).
// Creates a treasury in this browser, funds an order, then valid -> released, out of range -> held, waive, last -> completed.
// Screenshots of the list, the held detail, the create drawer and the supplier view at 1440 and 390, light and dark,
// axe on list and detail, and checks for horizontal overflow and console errors. AXE_PATH must point at axe.min.js.
async (page) => {
  const BASE = '__BASE__'
  const OUT = '__OUT__'
  const AXE = '__AXE__'
  const log = []
  const errors = []
  const axeOut = []
  const overflow = []
  page.on('pageerror', (e) => errors.push(String(e)))
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
  const failed = []
  page.on('response', (r) => { if (r.status() >= 400) failed.push(`${r.status()} ${r.request().method()} ${r.url().replace(/^https?:\/\/[^/]+/, '')} @ ${page.url().replace(/^https?:\/\/[^/]+/, '')}`) })
  const step = async (name, fn) => { const t = Date.now(); try { await fn(); log.push(`ok   ${name} (${Date.now() - t} ms)`) } catch (e) { log.push(`FAIL ${name}: ${String(e).split('\n')[0]}`); throw e } }
  const msHead = (i) => page.locator('.ms-step').nth(i).locator('.ms-head')
  const theme = async (t) => { await page.evaluate((x) => localStorage.setItem('porthmos.theme', x), t) }
  const VIEWS = [[1440, 900], [390, 844]]

  const checkOverflow = async (name) => {
    const r = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }))
    if (r.sw > r.cw + 1) overflow.push(`${name}: scrollWidth ${r.sw} > ${r.cw}`)
  }
  const axe = async (name) => {
    await page.addScriptTag({ path: AXE })
    const v = await page.evaluate(async () => {
      const r = await window.axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice'] } })
      return r.violations.map((x) => ({ id: x.id, impact: x.impact, nodes: x.nodes.slice(0, 3).map((n) => n.target.join(' ')) }))
    })
    axeOut.push({ name, violations: v })
  }
  const shoot = async (name, path, ready, opts = {}) => {
    for (const [w, h] of VIEWS) {
      for (const t of ['light', 'dark']) {
        await page.setViewportSize({ width: w, height: h })
        await theme(t)
        await page.goto(BASE + path)
        await ready()
        await page.waitForTimeout(600)
        await checkOverflow(`${name}-${w}-${t}`)
        if (opts.axe) await axe(`${name}-${w}-${t}`)
        await page.screenshot({ path: `${OUT}/${name}-${w}-${t}.png`, fullPage: !opts.viewportOnly })
      }
    }
    await page.setViewportSize({ width: 1440, height: 900 })
    await theme('light')
  }

  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto(BASE + '/')
  // The faucet allows one onboarding per address per window, so a treasury already in this browser session is reused.
  const reuse = await page.evaluate(() => { localStorage.setItem('porthmos.theme', 'light'); return !!localStorage.getItem('aegis.wallet.v1') })

  if (reuse) await step('log in with the treasury already in this browser (/signin, Continue on this device)', async () => {
    await page.goto(BASE + '/signin')
    if (await page.locator('#signin-test[aria-expanded="false"]').count()) await page.locator('#signin-test').click()
    await page.locator('#signin-device', { hasText: 'Safe' }).waitFor({ timeout: 20000 })
    await page.locator('label[for="signin-seat-owner"]').click()
    await page.locator('#signin-continue').click()
    await page.locator('.sign-confirm .sign-preview', { hasText: 'Sign in to Porthmos as owner.' }).waitFor({ timeout: 15000 })
    await page.getByRole('button', { name: 'Sign in as owner' }).click()
    await page.waitForURL('**/treasury', { timeout: 20000 })
    await page.locator('.sw-sub', { hasText: /Signed in as Owner/ }).waitFor({ timeout: 20000 })
  })

  if (!reuse) await step('create an account in this browser (/signup, recovery file, sign in)', async () => {
    await page.goto(BASE + '/signup')
    await page.locator('#signup-test').click()
    await page.locator('#signup-recovery').waitFor({ timeout: 180000 })
    const download = page.waitForEvent('download')
    await page.locator('#signup-download').click()
    await download
    await page.locator('#signup-recovery input[type=checkbox]').check()
    // Activation already signed the SIWE message and opened the owner session, so opening asks for nothing more.
    await page.locator('#signup-open').click()
    await page.waitForURL('**/treasury', { timeout: 20000 })
    await page.locator('.sw-sub', { hasText: /Signed in as Owner/ }).waitFor({ timeout: 20000 })
  })

  await step('g o opens Orders (empty state on a new treasury)', async () => {
    await page.locator('body').click({ position: { x: 700, y: 300 } }).catch(() => {})
    await page.keyboard.press('g'); await page.keyboard.press('o')
    await page.waitForURL('**/orders')
    await page.locator('main h1', { hasText: 'Orders' }).waitFor({ timeout: 15000 })
    if (!reuse) await page.getByText('No orders yet.').waitFor({ timeout: 15000 })
  })

  await step('create drawer: form, split preview, confirm screen', async () => {
    await page.getByRole('button', { name: 'Create order' }).first().click()
    await page.locator('dialog.drawer[open] input[name="supplier-mode"]').first().check()
    await page.waitForSelector('dialog.drawer[open] #order-terms')
    await page.fill('#order-total', '1000')
    await page.fill('#order-terms', 'PO-2026-200, reefer container')
    const plan = await page.locator('dialog.drawer .ms-plan').innerText()
    if (!/200\.00[\s\S]*400\.00[\s\S]*400\.00/.test(plan)) throw new Error('split preview is not 200/400/400: ' + plan)
    for (const [w, h] of VIEWS) for (const t of ['light', 'dark']) {
      await page.setViewportSize({ width: w, height: h })
      await page.evaluate((x) => { document.documentElement.dataset.theme = x }, t)
      await page.waitForTimeout(300)
      await page.screenshot({ path: `${OUT}/create-drawer-${w}-${t}.png` })
    }
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.evaluate(() => { document.documentElement.dataset.theme = 'light' })
    await page.getByRole('button', { name: 'Review' }).click()
    await page.getByRole('button', { name: 'Sign and fund' }).waitFor({ timeout: 20000 })
    const body = await page.locator('dialog.drawer .drawer-body').innerText()
    for (const want of ['MultiSendCallOnly', 'USDC approve', 'createOrder', '1,000.00 USDC (1000000000 units)', 'PO-2026-200']) if (!body.includes(want)) throw new Error(`confirm screen lacks "${want}"`)
    await page.screenshot({ path: `${OUT}/create-confirm-1440-light.png` })
    await page.setViewportSize({ width: 390, height: 844 })
    await page.screenshot({ path: `${OUT}/create-confirm-390-light.png` })
    await page.setViewportSize({ width: 1440, height: 900 })
  })

  let orderPath = ''
  await step('sign and fund: one Safe transaction, then the order page', async () => {
    await page.getByRole('button', { name: 'Sign and fund' }).click()
    await page.waitForURL(/\/orders\/\d+$/, { timeout: 60000 })
    orderPath = page.url().replace(/^https?:\/\/[^/]+/, '').replace(/[?#].*$/, '')
    await msHead(0).getByText('Pending').waitFor({ timeout: 20000 })
  })

  const proof = async (index, label) => {
    for (let i = 0; ; i++) {
      try {
        await page.locator('.ms-step').nth(index).getByRole('button', { name: 'Request demo proof' }).click({ timeout: 15000 })
        await page.getByRole('menuitem', { name: new RegExp(label) }).click({ timeout: 4000 })
        return
      } catch (e) {
        if (i >= 3) throw e
        await page.keyboard.press('Escape').catch(() => {})
      }
    }
  }

  await step('valid proof on milestone 1 releases it', async () => {
    await proof(0, 'Valid proof')
    await msHead(0).getByText('Released').waitFor({ timeout: 60000 })
    await page.locator('.ms-step').nth(0).getByText('Release tx').waitFor()
  })

  await step('out-of-range proof on milestone 2 holds it with the agent explanation', async () => {
    await proof(1, 'Out of range')
    await msHead(1).getByText('Held').waitFor({ timeout: 30000 })
    await page.locator('.ms-step').nth(1).locator('.ms-checks li.bad').getByText('Temperature').waitFor()
    await page.locator('.ms-step').nth(1).getByText('Verification Agent').waitFor()
    await page.locator('.ms-step').nth(1).getByRole('button', { name: 'Waive and pay' }).waitFor()
  })

  await step('screenshots and axe while held', async () => {
    await shoot('orders-list', '/orders', async () => { await page.waitForSelector('.dt-open'); await page.locator('.chip', { hasText: 'Held' }).first().waitFor() }, { axe: true })
    await shoot('order-detail-held', orderPath, async () => { await msHead(1).getByText('Held').waitFor({ timeout: 15000 }) }, { axe: true })
    await shoot('supplier-view', orderPath.replace('/orders/', '/o/'), async () => { await page.getByText('Supplier view: on-chain fields only.').waitFor({ timeout: 15000 }) }, { axe: true })
  })

  await step('the supplier view carries no proofs or hold reasons (C9)', async () => {
    await page.goto(BASE + orderPath.replace('/orders/', '/o/'))
    await page.getByText('Supplier view: on-chain fields only.').waitFor()
    const text = await page.locator('main').innerText()
    if (/Verification Agent|ConditionNotMet|Demo issuer proof|Waive and pay/.test(text)) throw new Error('supplier view shows off-chain data')
  })

  await step('owner waives milestone 2 with a Safe transaction', async () => {
    await page.goto(BASE + orderPath)
    await page.locator('.ms-step').nth(1).getByRole('button', { name: 'Waive and pay' }).click()
    const confirm = await page.locator('.sign-confirm').innerText()
    if (!/waive\(\d+, 1\)/.test(confirm)) throw new Error('waive confirm does not name waive(id, 1): ' + confirm)
    await page.getByRole('button', { name: 'Sign and waive' }).click()
    await msHead(1).getByText('Waived').waitFor({ timeout: 60000 })
  })

  await step('valid proof on the last milestone completes the order', async () => {
    await proof(2, 'Valid proof')
    await msHead(2).getByText('Released').waitFor({ timeout: 60000 })
    await page.locator('.page-head').getByText('Completed').waitFor({ timeout: 20000 })
  })

  await step('treasury links committed funds to Orders', async () => {
    await page.goto(BASE + '/treasury')
    await page.locator('section[aria-label="Trade position"]').waitFor({ timeout: 15000 })
    await page.locator('section[aria-label="Trade position"]').getByRole('link', { name: /active order|View orders/ }).click()
    await page.waitForURL('**/orders')
  })

  await step('palette finds the order row', async () => {
    await page.keyboard.press('Control+k')
    await page.waitForSelector('dialog.palette[open]')
    const id = orderPath.split('/').pop()
    await page.keyboard.type(`Order ${id}`)
    await page.waitForSelector('.palette-option[aria-selected="true"]')
    await page.keyboard.press('Enter')
    await page.waitForURL(`**${orderPath}`)
  })

  const bad = axeOut.filter((a) => a.violations.length)
  return [
    ...log,
    `order: ${orderPath}`,
    `axe runs: ${axeOut.length}, with violations: ${bad.length}${bad.length ? '\n' + JSON.stringify(bad, null, 1) : ''}`,
    `horizontal overflow: ${overflow.length ? overflow.join('; ') : 'none'}`,
    `failed requests: ${failed.length}${failed.length ? '\n' + failed.join('\n') : ''}`,
    `console errors: ${errors.length}${errors.length ? '\n' + errors.join('\n') : ''}`,
  ].join('\n')
}
