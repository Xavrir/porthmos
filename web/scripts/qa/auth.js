// Playwright CLI run-code snippet: Log in and Create account against a live local stack (Anvil 31337 + service + web dev).
// Route guard, /start redirect, Help dialog, create an account (mid-onboarding and recovery screenshots), sign out,
// sign in on this device as bank, forget this device, restore from the recovery file, View the demo.
// Screenshots at 1440 and 390 plus reduced motion, axe on every state, overflow, console errors, and the ASCII sea's
// frame cost and CPU. AXE_PATH must point at axe.min.js.
async (page) => {
  const BASE = '__BASE__'
  const OUT = '__OUT__'
  const AXE = '__AXE__'
  const log = []
  const errors = []
  const axeOut = []
  const overflow = []
  const failed = []
  // On a fresh chain order 1 does not exist, so the public supplier view check expects its 404.
  let allow404 = false
  page.on('pageerror', (e) => errors.push(String(e)))
  page.on('console', (m) => { if (m.type() === 'error' && !(allow404 && /status of 404/.test(m.text()))) errors.push(m.text()) })
  page.on('response', (r) => { if (r.status() >= 400 && !(allow404 && r.status() === 404)) failed.push(`${r.status()} ${r.request().method()} ${r.url().replace(/^https?:\/\/[^/]+/, '')} @ ${page.url().replace(/^https?:\/\/[^/]+/, '')}`) })
  let stopped = false
  const step = async (name, fn) => {
    if (stopped) { log.push(`skip ${name}`); return }
    const t = Date.now()
    try { await fn(); log.push(`ok   ${name} (${Date.now() - t} ms)`) } catch (e) { log.push(`FAIL ${name}: ${String(e).split('\n')[0]} @ ${path()}`); stopped = true }
  }
  const path = () => page.url().replace(/^https?:\/\/[^/]+/, '')
  const VIEWS = [[1440, 900], [390, 844]]

  const checkOverflow = async (name) => {
    const r = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }))
    if (r.sw > r.cw + 1) overflow.push(`${name}: scrollWidth ${r.sw} > ${r.cw}`)
  }
  const axe = async (name) => {
    await page.addScriptTag({ path: AXE })
    const v = await page.evaluate(async () => {
      const r = await window.axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'] } })
      return r.violations.map((x) => ({ id: x.id, impact: x.impact, nodes: x.nodes.slice(0, 3).map((n) => n.target.join(' ') + ' :: ' + n.failureSummary.split('\n').slice(0, 2).join(' ')) }))
    })
    axeOut.push({ name, violations: v })
  }
  const capture = async (name, opts = {}) => {
    for (const [w, h] of VIEWS) {
      await page.setViewportSize({ width: w, height: h })
      if (opts.focus) await page.evaluate((sel) => document.querySelector(sel)?.scrollIntoView({ block: 'start' }), opts.focus)
      await page.waitForTimeout(400)
      await checkOverflow(`${name}-${w}`)
      await axe(`${name}-${w}`)
      await page.screenshot({ path: `${OUT}/${name}-${w}.png`, fullPage: !!opts.fullPage })
    }
    await page.setViewportSize({ width: 1440, height: 900 })
  }

  await page.addInitScript(() => {
    const raf = window.requestAnimationFrame.bind(window)
    window.__frames = []
    window.requestAnimationFrame = (cb) => raf((ts) => { const s = performance.now(); cb(ts); window.__frames.push([s, performance.now() - s]) })
  })
  await page.setViewportSize({ width: 1440, height: 900 })

  await step('app routes redirect to /signin without a session and keep the target', async () => {
    for (const p of ['/treasury', '/copilot', '/risk', '/audit', '/bank', '/orders', '/orders/1']) {
      await page.goto(BASE + p)
      await page.waitForURL('**/signin')
      await page.locator('h1', { hasText: 'Log in to Porthmos' }).waitFor()
    }
  })

  await step('the supplier view /o/:id stays public', async () => {
    allow404 = true
    await page.goto(BASE + '/o/1')
    await page.waitForSelector('main#main')
    await page.waitForTimeout(800)
    allow404 = false
    if (path() !== '/o/1') throw new Error('redirected to ' + path())
  })

  await step('/start redirects to /signup', async () => {
    await page.goto(BASE + '/start')
    await page.waitForURL('**/signup')
    await page.locator('h1', { hasText: 'Create your Porthmos account' }).waitFor()
  })

  await step('landing: Launch app opens /signin, Create account opens /signup', async () => {
    await page.goto(BASE + '/')
    await page.locator('.pm-nav-cta').click()
    await page.waitForURL('**/signin')
    await page.goto(BASE + '/')
    await page.locator('.pm-nav-signup').click()
    await page.waitForURL('**/signup')
  })

  await step('signin: no account yet, Continue disabled; screenshots and axe', async () => {
    await page.goto(BASE + '/signin')
    await page.locator('#signin-device', { hasText: 'No account in this browser yet.' }).waitFor({ timeout: 15000 })
    if (!(await page.locator('#signin-continue').isDisabled())) throw new Error('Continue is enabled without keys')
    await page.waitForTimeout(800)
    await capture('signin-initial')
  })

  await step('signin: Help opens the explainer in a dialog and Escape closes it', async () => {
    await page.locator('#signin-help').click()
    await page.locator('dialog.dialog-auth-help[open]').waitFor()
    await page.waitForTimeout(400)
    const text = await page.locator('dialog.dialog-auth-help').innerText()
    for (const want of ['No password', 'recovery file', 'Test network only']) if (!text.includes(want)) throw new Error('help lacks ' + want)
    await axe('signin-help-1440')
    await page.screenshot({ path: `${OUT}/signin-help-1440.png` })
    await page.keyboard.press('Escape')
    await page.waitForFunction(() => !document.querySelector('dialog.dialog-auth-help[open]'))
    const focused = await page.evaluate(() => document.activeElement?.id)
    if (focused !== 'signin-help') throw new Error('focus did not return to Help: ' + focused)
  })

  await step('signin: keyboard order reaches every control', async () => {
    await page.goto(BASE + '/signin')
    await page.locator('#signin-device').waitFor()
    const ids = []
    for (let i = 0; i < 16; i++) { await page.keyboard.press('Tab'); ids.push(await page.evaluate(() => document.activeElement?.id || document.activeElement?.className || document.activeElement?.tagName)) }
    for (const want of ['signin-seat-owner', 'signin-help', 'signin-wallet', 'signin-restore', 'signin-demo', 'signin-to-signup']) if (!ids.includes(want)) throw new Error(`${want} not reached by Tab: ${ids.join(', ')}`)
  })

  await step('signup: initial screenshots and axe', async () => {
    await page.goto(BASE + '/signup')
    await page.locator('#signup-create').waitFor({ timeout: 15000 })
    await page.waitForTimeout(600)
    await capture('signup-initial')
  })

  await step('signup: mid-onboarding screenshots and axe', async () => {
    await page.locator('#signup-create').click()
    await page.locator('.step.s-running').first().waitFor({ timeout: 30000 })
    await page.locator('.step.s-done').nth(2).waitFor({ timeout: 60000 })
    await capture('signup-mid', { focus: '.step.s-running' })
  })

  let recovery = ''
  await step('signup: recovery step blocks entry until downloaded and acknowledged', async () => {
    await page.locator('#signup-recovery').waitFor({ timeout: 180000 })
    await capture('signup-recovery', { focus: '#signup-recovery' })
    if (!(await page.locator('#signup-open').isDisabled())) throw new Error('Open my treasury is enabled before the download')
    if (!(await page.locator('#signup-recovery input[type=checkbox]').isDisabled())) throw new Error('acknowledgement is enabled before the download')
    const dl = page.waitForEvent('download')
    await page.locator('#signup-download').click()
    // Playwright's own download path lives until the browser context closes, so no key file lands in the screenshots folder.
    recovery = await (await dl).path()
    if (!(await page.locator('#signup-open').isDisabled())) throw new Error('Open my treasury is enabled before the acknowledgement')
    await page.locator('#signup-recovery input[type=checkbox]').check()
    await page.locator('#signup-open').click()
    const preview = await page.locator('.sign-confirm .sign-preview').innerText()
    if (!/^AEGIS session\nrole: owner\naddress: 0x[0-9a-fA-F]{40}\nchainId: 31337\nissuedAt: the time you press Sign in$/.test(preview)) throw new Error('unexpected preview: ' + preview)
    await page.getByRole('button', { name: 'Sign in as owner' }).click()
    await page.waitForURL('**/treasury', { timeout: 20000 })
    await page.locator('.sw-sub', { hasText: /Signed in as Owner/ }).waitFor({ timeout: 20000 })
  })

  await step('reload keeps the session (sessionStorage) and stays in the app', async () => {
    await page.goto(BASE + '/audit')
    await page.waitForSelector('main#main h1')
    await page.waitForTimeout(1500)
    if (path() !== '/audit') throw new Error('left the app: ' + path())
  })

  await step('account menu: Sign out returns to /signin and the guard holds', async () => {
    await page.locator('.switcher-button').click()
    await page.locator('#account-signout').click()
    await page.waitForURL('**/signin')
    await page.goto(BASE + '/orders')
    await page.waitForURL('**/signin')
  })

  await step('signin: Continue on this device as bank, with the exact message shown first', async () => {
    // A same-URL goto keeps history.state (the guard's return path), so leave the page first.
    await page.goto(BASE + '/')
    await page.goto(BASE + '/signin')
    await page.locator('#signin-device', { hasText: 'Safe' }).waitFor({ timeout: 15000 })
    await page.locator('label[for="signin-seat-bank"]').click()
    await page.locator('#signin-continue').click()
    const preview = await page.locator('.sign-confirm .sign-preview').innerText()
    if (!preview.includes('role: bank')) throw new Error('preview is not for the bank: ' + preview)
    await axe('signin-confirm-1440')
    await page.screenshot({ path: `${OUT}/signin-confirm-1440.png` })
    await page.getByRole('button', { name: 'Sign in as bank' }).click()
    await page.waitForURL('**/bank', { timeout: 20000 })
    await page.locator('.sw-sub', { hasText: /Signed in as Bank/ }).waitFor({ timeout: 20000 })
  })

  await step('account menu: Forget this device needs the typed word, then clears the keys', async () => {
    await page.locator('.switcher-button').click()
    await page.locator('#account-forget').click()
    await page.locator('dialog.dialog-forget[open]').waitFor()
    await page.waitForTimeout(400)
    if (!(await page.locator('#forget-confirm').isDisabled())) throw new Error('forget is enabled before typing')
    await page.fill('#forget-typed', 'FORG')
    if (!(await page.locator('#forget-confirm').isDisabled())) throw new Error('forget is enabled for a partial word')
    await page.fill('#forget-typed', 'FORGET')
    await axe('forget-dialog-1440')
    await page.screenshot({ path: `${OUT}/forget-dialog-1440.png` })
    await page.locator('#forget-confirm').click()
    await page.waitForURL('**/signin')
    await page.locator('#signin-device', { hasText: 'No account in this browser yet.' }).waitFor({ timeout: 15000 })
    if (await page.evaluate(() => localStorage.getItem('aegis.wallet.v1'))) throw new Error('keys still stored')
  })

  await step('signin: Restore from recovery file, sign in as owner, return to the page asked for', async () => {
    await page.goto(BASE + '/audit')
    await page.waitForURL('**/signin')
    await page.locator('label[for="signin-seat-owner"]').click()
    await page.setInputFiles('#signin-restore-file', recovery)
    await page.locator('.sign-confirm .sign-preview').waitFor({ timeout: 20000 })
    await page.getByRole('button', { name: 'Sign in as owner' }).click()
    await page.waitForURL('**/audit', { timeout: 20000 })
    await page.locator('.sw-sub', { hasText: /Signed in as Owner/ }).waitFor({ timeout: 20000 })
    await page.locator('.switcher-button').click()
    await page.locator('#account-signout').click()
    await page.waitForURL('**/signin')
  })

  await step('signin: View the demo opens the replay without signing, and survives a reload', async () => {
    await page.locator('label[for="signin-seat-owner"]').click()
    await page.locator('#signin-demo').click()
    await page.waitForURL('**/treasury')
    await page.locator('.mode-replay').first().waitFor({ timeout: 15000 })
    await page.goto(BASE + '/risk')
    await page.waitForSelector('main#main h1')
    await page.waitForTimeout(800)
    if (path() !== '/risk') throw new Error('demo did not survive a reload: ' + path())
    await page.locator('.switcher-button').click()
    await page.locator('#account-signout').click()
    await page.waitForURL('**/signin')
    await page.goto(BASE + '/treasury')
    await page.waitForURL('**/signin')
  })

  await step('reduced motion: one still frame, no animation loop', async () => {
    await page.emulateMedia({ reducedMotion: 'reduce' })
    for (const p of ['signin', 'signup']) {
      await page.goto(BASE + '/' + p)
      await page.locator('main#main h1').waitFor()
      await page.waitForTimeout(800)
      const before = await page.evaluate(() => window.__frames.length)
      await page.waitForTimeout(1500)
      const after = await page.evaluate(() => window.__frames.length)
      if (after - before > 2) throw new Error(`${p}: ${after - before} animation frames under reduced motion`)
      for (const [w, h] of VIEWS) {
        await page.setViewportSize({ width: w, height: h })
        await page.waitForTimeout(300)
        await page.screenshot({ path: `${OUT}/${p}-reduced-motion-${w}.png` })
      }
      await page.setViewportSize({ width: 1440, height: 900 })
    }
    await page.emulateMedia({ reducedMotion: 'no-preference' })
  })

  let perf = null
  await step('ASCII sea: frame cost and main-thread CPU at 1440', async () => {
    await page.goto(BASE + '/signin')
    await page.locator('main#main h1').waitFor()
    await page.waitForTimeout(1500)
    const cdp = await page.context().newCDPSession(page)
    await cdp.send('Performance.enable')
    const metric = async () => Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map((m) => [m.name, m.value]))
    const m0 = await metric()
    const f0 = await page.evaluate(() => performance.now())
    await page.waitForTimeout(5000)
    const m1 = await metric()
    const frames = await page.evaluate((from) => window.__frames.filter(([s]) => s >= from).map(([, d]) => d), f0)
    const drawn = frames.filter((d) => d > 0.15).sort((a, b) => a - b)
    const wall = m1.Timestamp - m0.Timestamp
    const q = (p) => drawn.length ? drawn[Math.min(drawn.length - 1, Math.floor(p * drawn.length))] : 0
    perf = {
      seconds: +wall.toFixed(2),
      rafPerSec: +(frames.length / wall).toFixed(1),
      drawsPerSec: +(drawn.length / wall).toFixed(1),
      drawMs: { mean: +(drawn.reduce((a, b) => a + b, 0) / Math.max(1, drawn.length)).toFixed(2), p50: +q(0.5).toFixed(2), p95: +q(0.95).toFixed(2), max: +q(1).toFixed(2) },
      mainThreadBusyPct: +(((m1.TaskDuration - m0.TaskDuration) / wall) * 100).toFixed(1),
      scriptPct: +(((m1.ScriptDuration - m0.ScriptDuration) / wall) * 100).toFixed(1),
    }
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto(BASE + '/signup')
    await page.locator('main#main h1').waitFor()
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight))
    await page.waitForTimeout(600)
    const g0 = await page.evaluate(() => window.__frames.length)
    await page.waitForTimeout(1500)
    const g1 = await page.evaluate(() => window.__frames.length)
    perf.offscreenFramesIn1500ms = g1 - g0
    if (g1 - g0 > 2) throw new Error(`the band kept animating off screen (${g1 - g0} frames)`)
    await page.setViewportSize({ width: 1440, height: 900 })
  })

  await step('signin: Connect wallet (mock injected wallet on Anvil, starts on the wrong chain) signs in as owner', async () => {
    // Local chain only: the mock signs with public Anvil test account 1, which the dev server exposes in src/lib/demo/keys.ts.
    await page.addInitScript(() => {
      const listeners = {}
      let chainId = '0x14a34'
      let account = null
      const emit = (e, v) => (listeners[e] || []).forEach((f) => f(v))
      const signer = async () => {
        if (!account) {
          const { ANVIL_DEMO_KEYS } = await import('/src/lib/demo/keys.ts')
          const { privateKeyToAccount } = await import('/node_modules/.vite/deps/viem_accounts.js')
          account = privateKeyToAccount(ANVIL_DEMO_KEYS.owner)
        }
        return account
      }
      window.__walletCalls = []
      window.ethereum = {
        isMetaMask: false,
        on: (e, f) => { (listeners[e] ||= []).push(f) },
        removeListener: (e, f) => { listeners[e] = (listeners[e] || []).filter((g) => g !== f) },
        request: async ({ method, params }) => {
          window.__walletCalls.push(method)
          const a = await signer()
          if (method === 'eth_requestAccounts' || method === 'eth_accounts') return [a.address]
          if (method === 'eth_chainId') return chainId
          if (method === 'wallet_switchEthereumChain') { chainId = params[0].chainId; emit('chainChanged', chainId); return null }
          if (method === 'personal_sign') { window.__signed = params[0]; return a.signMessage({ message: { raw: params[0] } }) }
          if (method === 'wallet_requestPermissions' || method === 'wallet_getPermissions') return [{ parentCapability: 'eth_accounts' }]
          throw Object.assign(new Error(`mock wallet: ${method} not supported`), { code: 4200 })
        },
      }
    })
    await page.goto(BASE + '/')
    await page.evaluate(() => { localStorage.removeItem('aegis.wallet.v1') })
    await page.goto(BASE + '/signin')
    await page.locator('#signin-device', { hasText: 'No account in this browser yet.' }).waitFor({ timeout: 15000 })
    await page.locator('#signin-wallet').click()
    await page.locator('.auth-panel .sign-preview').waitFor({ timeout: 20000 })
    const preview = await page.locator('.auth-panel .sign-preview').innerText()
    if (!/^AEGIS session\nrole: owner\naddress: 0x[0-9a-fA-F]{40}\nchainId: 31337\nissuedAt: the time you press Sign in$/.test(preview)) throw new Error('unexpected wallet preview: ' + preview)
    const calls = await page.evaluate(() => window.__walletCalls)
    if (!calls.includes('wallet_switchEthereumChain')) throw new Error('no chain switch: ' + calls.join(','))
    if (calls.includes('personal_sign')) throw new Error('signed before the confirmation')
    await axe('signin-wallet-confirm-1440')
    await page.screenshot({ path: `${OUT}/signin-wallet-confirm-1440.png` })
    await page.locator('.auth-panel').getByRole('button', { name: 'Sign in as owner' }).click()
    await page.waitForURL('**/treasury', { timeout: 20000 })
    await page.locator('.sw-sub', { hasText: /Signed in as Owner/ }).waitFor({ timeout: 20000 })
    const signed = await page.evaluate(() => window.__signed)
    const text = await page.evaluate((h) => new TextDecoder().decode(new Uint8Array(h.slice(2).match(/../g).map((b) => parseInt(b, 16)))), signed)
    if (!text.startsWith(preview.split('\nissuedAt:')[0] + '\nissuedAt: 20')) throw new Error('signed text differs from the preview: ' + text)
  })

  const bad = axeOut.filter((a) => a.violations.length)
  return [
    ...log,
    `axe runs: ${axeOut.length}, with violations: ${bad.length}${bad.length ? '\n' + JSON.stringify(bad, null, 1) : ''}`,
    `horizontal overflow: ${overflow.length ? overflow.join('; ') : 'none'}`,
    `sea perf: ${JSON.stringify(perf)}`,
    `failed requests: ${failed.length}${failed.length ? '\n' + failed.join('\n') : ''}`,
    `console errors: ${errors.length}${errors.length ? '\n' + errors.join('\n') : ''}`,
  ].join('\n')
}
