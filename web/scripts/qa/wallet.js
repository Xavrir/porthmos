// Playwright CLI run-code snippet: the wallet picker and wallet account UX against a live local stack (Anvil 31337 +
// service + web dev). Mock EIP-1193 wallets announce themselves over EIP-6963 from an init script; their icons are
// neutral letter tiles, not brand logos. Covers: wallets listed (last used first), connecting, declined, wrong network
// with one-click switch, no wallet installed, SIWE sign-in with the exact text shown first, the account menu, the
// wrong-network banner on chainChanged, the re-auth prompt on accountsChanged, disconnect, and (with QA_FACTORY) a
// Coinbase-style smart contract wallet that creates an account: ERC-6492 faucet signature, one EIP-5792 atomic batch,
// ERC-1271 SIWE activation, then a fresh ERC-1271 sign-in. Screenshots at 1440 and 390, axe on every state.
// Public Anvil test keys only (accounts 1 and 2 through src/lib/demo/keys.ts, a fresh random key for the smart wallet).
async (page) => {
  const BASE = '__BASE__'
  const OUT = '__OUT__'
  const AXE = '__AXE__'
  const FACTORY = '__QA_FACTORY__'
  const WC_BASE = '__QA_WC_BASE__'
  const RPC = 'http://127.0.0.1:8645'
  const OWNER = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8'
  const BANK = '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC'
  const log = []
  const errors = []
  const axeOut = []
  const overflow = []
  const failed = []
  page.on('pageerror', (e) => errors.push(String(e.stack || e).split('\n').slice(0, 6).join(' <- ')))
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
  page.on('response', (r) => { if (r.status() >= 400) failed.push(`${r.status()} ${r.request().method()} ${r.url().replace(/^https?:\/\/[^/]+/, '')}`) })
  let stopped = false
  const step = async (name, fn) => {
    if (stopped) { log.push(`skip ${name}`); return }
    const t = Date.now()
    try { await fn(); log.push(`ok   ${name} (${Date.now() - t} ms)`) } catch (e) {
      log.push(`FAIL ${name}: ${String(e).split('\n').slice(0, 3).join(' | ')} @ ${page.url().replace(/^https?:\/\/[^/]+/, '')}`)
      stopped = true
      await page.screenshot({ path: `${OUT}/failure.png` }).catch(() => {})
    }
  }
  const VIEWS = [[1440, 900], [390, 844]]
  const axe = async (name) => {
    await page.addScriptTag({ path: AXE })
    const v = await page.evaluate(async () => {
      const r = await window.axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'] } })
      return r.violations.map((x) => ({ id: x.id, impact: x.impact, nodes: x.nodes.slice(0, 3).map((n) => n.target.join(' ') + ' :: ' + n.failureSummary.split('\n').slice(0, 2).join(' ')) }))
    })
    axeOut.push({ name, violations: v })
  }
  const shot = async (name, sizes = VIEWS) => {
    for (const [w, h] of sizes) {
      await page.setViewportSize({ width: w, height: h })
      await page.waitForTimeout(450)
      const r = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }))
      if (r.sw > r.cw + 1) overflow.push(`${name}-${w}: scrollWidth ${r.sw} > ${r.cw}`)
      await axe(`${name}-${w}`)
      await page.screenshot({ path: `${OUT}/${name}-${w}.png` })
    }
    await page.setViewportSize({ width: 1440, height: 900 })
  }
  const setMocks = async (wallets, extra = {}) => {
    await page.goto(BASE + '/')
    await page.evaluate(([w, x]) => {
      localStorage.clear()
      sessionStorage.clear()
      localStorage.setItem('qa.mock', JSON.stringify(w))
      for (const [k, v] of Object.entries(x)) localStorage.setItem(k, v)
    }, [wallets, extra])
  }
  const emit = (rdns, event, value) => page.evaluate(([r, e, v]) => window.__qaEmit(r, e, v), [rdns, event, value])
  const openPicker = async () => {
    await page.locator('#signin-wallet').click()
    await page.locator('dialog.dialog-wallet[open]').waitFor()
    await page.waitForTimeout(300)
  }

  await page.addInitScript(({ RPC, FACTORY }) => {
    let wallets = []
    try { wallets = JSON.parse(localStorage.getItem('qa.mock') || '[]') } catch { /* no mocks */ }
    const tile = (letter, bg) => 'data:image/svg+xml,' + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="8" fill="${bg}"/><text x="16" y="21" font-family="sans-serif" font-size="14" font-weight="700" text-anchor="middle" fill="#fff">${letter}</text></svg>`)
    const rpc = async (method, params = []) => {
      const r = await fetch(RPC, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) })
      const j = await r.json()
      if (j.error) throw Object.assign(new Error(j.error.message), { code: j.error.code, data: j.error.data })
      return j.result
    }
    const viem = () => import('/node_modules/.vite/deps/viem.js')
    const viemAccounts = () => import('/node_modules/.vite/deps/viem_accounts.js')
    window.__walletCalls = []
    window.__signed = []
    const providers = {}
    for (const [i, w] of wallets.entries()) {
      const listeners = {}
      const on = (e, f) => { (listeners[e] ||= []).push(f) }
      const emit = (e, v) => (listeners[e] || []).forEach((f) => f(v))
      let chainId = w.chainId || '0x7a69'
      let accountOverride = null
      let eoa = null
      const key = async () => {
        if (eoa && (!accountOverride || eoa.address.toLowerCase() === accountOverride.toLowerCase() || w.behavior === 'smart')) return eoa
        const { privateKeyToAccount, generatePrivateKey } = await viemAccounts()
        if (accountOverride && w.behavior !== 'smart') {
          const { ANVIL_DEMO_KEYS } = await import('/src/lib/demo/keys.ts')
          const hit = Object.values(ANVIL_DEMO_KEYS).map((k) => privateKeyToAccount(k)).find((a) => a.address.toLowerCase() === accountOverride.toLowerCase())
          if (hit) { eoa = hit; return eoa }
        }
        if (w.behavior === 'smart') {
          let pk = localStorage.getItem('qa.smart.pk')
          if (!pk) { pk = generatePrivateKey(); localStorage.setItem('qa.smart.pk', pk) }
          eoa = privateKeyToAccount(pk)
        } else {
          const { ANVIL_DEMO_KEYS } = await import('/src/lib/demo/keys.ts')
          eoa = privateKeyToAccount(ANVIL_DEMO_KEYS[w.key || 'owner'])
        }
        return eoa
      }
      let smartAddr = null
      const smart = async () => {
        if (smartAddr) return smartAddr
        const v = await viem()
        const e = await key()
        const out = await rpc('eth_call', [{ to: FACTORY, data: v.encodeFunctionData({ abi: v.parseAbi(['function getAddress(address,uint256) view returns (address)']), functionName: 'getAddress', args: [e.address, 0n] }) }, 'latest'])
        smartAddr = v.getAddress('0x' + out.slice(-40))
        return smartAddr
      }
      const address = async () => accountOverride || (w.behavior === 'smart' ? smart() : (await key()).address)
      const eoaSend = async (to, data, value = '0x0') => {
        const v = await viem()
        const e = await key()
        const client = v.createWalletClient({ account: e, transport: v.http(RPC) })
        const bal = BigInt(await rpc('eth_getBalance', [e.address, 'latest']))
        if (bal < 10n ** 17n) {
          const fund = await rpc('eth_sendTransaction', [{ from: '0xa0Ee7A142d267C1f36714E4a8F75612F20a79720', to: e.address, value: '0xde0b6b3a7640000' }])
          for (let n = 0; n < 60 && !(await rpc('eth_getTransactionReceipt', [fund])); n++) await new Promise((r) => setTimeout(r, 500))
        }
        const chain = { id: 31337, name: 'Anvil', nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 }, rpcUrls: { default: { http: [RPC] } } }
        const hash = await client.sendTransaction({ chain, to, data, value: BigInt(value) })
        return hash
      }
      const waitMined = async (hash) => { for (let n = 0; n < 120; n++) { const r = await rpc('eth_getTransactionReceipt', [hash]); if (r) return r; await new Promise((res) => setTimeout(res, 500)) } }
      const deployed = async () => (await rpc('eth_getCode', [await smart(), 'latest'])) !== '0x'
      const ensureDeployed = async () => {
        if (await deployed()) return
        const v = await viem()
        const e = await key()
        const h = await eoaSend(FACTORY, v.encodeFunctionData({ abi: v.parseAbi(['function createAccount(address,uint256)']), functionName: 'createAccount', args: [e.address, 0n] }))
        await waitMined(h)
      }
      const provider = {
        on, removeListener: (e, f) => { listeners[e] = (listeners[e] || []).filter((g) => g !== f) },
        request: async ({ method, params = [] }) => {
          window.__walletCalls.push(`${w.rdns}:${method}`)
          // A person reads and confirms each request; the pause keeps the app's prompt card on screen for the test.
          if (w.behavior === 'smart' && ['personal_sign', 'eth_sendTransaction', 'wallet_sendCalls'].includes(method)) await new Promise((r) => setTimeout(r, 1500))
          if (w.behavior === 'hang' && (method === 'eth_requestAccounts')) return new Promise(() => {})
          if (w.behavior === 'reject' && method === 'eth_requestAccounts') throw Object.assign(new Error('User rejected the request.'), { code: 4001 })
          switch (method) {
            // Like a real wallet, eth_accounts stays empty until this site was allowed with eth_requestAccounts.
            case 'eth_requestAccounts': localStorage.setItem(`qa.auth.${w.rdns}`, '1'); return [await address()]
            case 'eth_accounts': return localStorage.getItem(`qa.auth.${w.rdns}`) && w.behavior !== 'hang' && w.behavior !== 'reject' ? [await address()] : []
            case 'eth_chainId': return chainId
            case 'wallet_switchEthereumChain': chainId = params[0].chainId; emit('chainChanged', chainId); return null
            case 'wallet_requestPermissions': case 'wallet_getPermissions': return [{ parentCapability: 'eth_accounts' }]
            case 'wallet_revokePermissions': localStorage.removeItem(`qa.auth.${w.rdns}`); return null
            case 'personal_sign': {
              const v = await viem()
              const e = await key()
              window.__signed.push(params[0])
              if (w.behavior !== 'smart') return e.signMessage({ message: { raw: params[0] } })
              const wallet = await smart()
              const digest = v.hashMessage({ raw: params[0] })
              const safeHash = v.hashTypedData({ domain: { name: 'Mock Smart Wallet', version: '1', chainId: 31337, verifyingContract: wallet }, types: { MockSmartWalletMessage: [{ name: 'hash', type: 'bytes32' }] }, primaryType: 'MockSmartWalletMessage', message: { hash: digest } })
              const sig = await e.sign({ hash: safeHash })
              if (await deployed()) return sig
              const create = v.encodeFunctionData({ abi: v.parseAbi(['function createAccount(address,uint256)']), functionName: 'createAccount', args: [e.address, 0n] })
              return v.concat([v.encodeAbiParameters(v.parseAbiParameters('address, bytes, bytes'), [FACTORY, create, sig]), '0x6492649264926492649264926492649264926492649264926492649264926492'])
            }
            case 'eth_sendTransaction': {
              const tx = params[0]
              if (w.behavior !== 'smart') throw Object.assign(new Error('not used in QA'), { code: 4200 })
              const v = await viem()
              await ensureDeployed()
              return eoaSend(await smart(), v.encodeFunctionData({ abi: v.parseAbi(['function execute(address,uint256,bytes)']), functionName: 'execute', args: [tx.to, BigInt(tx.value || 0), tx.data || '0x'] }))
            }
            case 'wallet_getCapabilities': return w.behavior === 'smart' ? { '0x7a69': { atomic: { status: 'supported' } } } : {}
            case 'wallet_sendCalls': {
              if (w.behavior !== 'smart') throw Object.assign(new Error('Method not supported'), { code: 4200 })
              const v = await viem()
              await ensureDeployed()
              const calls = params[0].calls.map((c) => ({ target: c.to, value: BigInt(c.value || 0), data: c.data || '0x' }))
              const hash = await eoaSend(await smart(), v.encodeFunctionData({ abi: v.parseAbi(['struct Call { address target; uint256 value; bytes data; }', 'function executeBatch(Call[] calls)']), functionName: 'executeBatch', args: [calls] }))
              return { id: hash }
            }
            case 'wallet_getCallsStatus': {
              const r = await rpc('eth_getTransactionReceipt', [params[0]])
              if (!r) return { version: '2.0.0', id: params[0], chainId: '0x7a69', status: 100, atomic: true, receipts: [] }
              return { version: '2.0.0', id: params[0], chainId: '0x7a69', status: r.status === '0x1' ? 200 : 500, atomic: true, receipts: [r] }
            }
            default: return rpc(method, params)
          }
        },
      }
      providers[w.rdns] = { provider, emit, setAccount: (a) => { accountOverride = a } }
      const detail = Object.freeze({ info: { uuid: `6a1d1b3e-0000-4000-8000-00000000000${i}`, name: w.name, icon: tile(w.letter || w.name[0], w.color || '#3f4944'), rdns: w.rdns }, provider })
      const announce = () => window.dispatchEvent(new CustomEvent('eip6963:announceProvider', { detail }))
      window.addEventListener('eip6963:requestProvider', announce)
      announce()
    }
    window.__qaEmit = (rdns, event, value) => {
      const p = providers[rdns]
      if (event === 'accountsChanged') p.setAccount(value[0] ?? null)
      p.emit(event, value)
    }
  }, { RPC, FACTORY })

  const FIVE = [
    { name: 'MetaMask', rdns: 'io.metamask', letter: 'M', color: '#b45309' },
    { name: 'Rabby Wallet', rdns: 'io.rabby', letter: 'R', color: '#4f46e5' },
    { name: 'Coinbase Wallet', rdns: 'com.coinbase.wallet', letter: 'C', color: '#1d4ed8' },
    { name: 'Brave Wallet', rdns: 'com.brave.wallet', letter: 'B', color: '#c2410c' },
    { name: 'OKX Wallet', rdns: 'com.okex.wallet', letter: 'O', color: '#111827' },
  ]

  await step('picker lists every EIP-6963 wallet by name and icon, last used first; no WalletConnect without a project id', async () => {
    await setMocks(FIVE, { 'porthmos.last-wallet': 'io.rabby' })
    await page.goto(BASE + '/signin')
    await openPicker()
    const names = await page.locator('dialog.dialog-wallet .wp-item .wp-name').allInnerTexts()
    const flat = names.map((n) => n.split('\n')[0])
    const want = ['Rabby Wallet', 'MetaMask', 'Coinbase Wallet', 'Brave Wallet', 'OKX Wallet', 'Coinbase Smart Wallet']
    if (JSON.stringify(flat) !== JSON.stringify(want)) throw new Error('listed ' + JSON.stringify(flat))
    if (!(await page.locator('.wp-item[data-wallet="io.rabby"] .wp-badge', { hasText: 'Last used' }).count())) throw new Error('no last-used badge')
    if (await page.locator('.wp-none').count()) throw new Error('"no wallet" shown with wallets installed')
    if (await page.locator('dialog.dialog-wallet', { hasText: 'WalletConnect' }).count()) throw new Error('WalletConnect shown without a project id')
    await shot('picker-wallets')
  })

  if (WC_BASE) await step('with VITE_WALLETCONNECT_PROJECT_ID set, WalletConnect is listed', async () => {
    await page.goto(WC_BASE + '/')
    await page.evaluate((w) => { localStorage.setItem('qa.mock', JSON.stringify(w)) }, FIVE.slice(0, 2))
    await page.goto(WC_BASE + '/signin')
    await page.locator('#signin-wallet').click()
    await page.locator('dialog.dialog-wallet[open] .wp-item[data-wallet="walletConnect"]', { hasText: 'WalletConnect' }).waitFor({ timeout: 10000 })
    await page.waitForTimeout(400)
    await axe('picker-walletconnect-1440')
    await page.screenshot({ path: `${OUT}/picker-walletconnect-1440.png` })
    await page.keyboard.press('Escape')
  })

  await step('connecting: spinner and "Open <wallet>" until the wallet answers; Cancel returns to the list', async () => {
    await setMocks([{ name: 'MetaMask', rdns: 'io.metamask', letter: 'M', color: '#b45309', behavior: 'hang' }])
    await page.goto(BASE + '/signin')
    await openPicker()
    await page.locator('.wp-item[data-wallet="io.metamask"]').click()
    await page.locator('.wp-state[role="status"]', { hasText: 'Open MetaMask' }).waitFor()
    if (!(await page.locator('.wp-state .wp-spinner').count())) throw new Error('no spinner')
    await shot('picker-connecting')
    await page.getByRole('button', { name: 'Cancel' }).click()
    await page.locator('.wp-list').waitFor()
  })

  await step('declined: says nothing was shared, offers Try again and another wallet', async () => {
    await setMocks([{ name: 'Rabby Wallet', rdns: 'io.rabby', letter: 'R', color: '#4f46e5', behavior: 'reject' }])
    await page.goto(BASE + '/signin')
    await openPicker()
    await page.locator('.wp-item[data-wallet="io.rabby"]').click()
    await page.locator('.wp-state[role="alert"]', { hasText: 'You declined in Rabby Wallet. Nothing was shared.' }).waitFor()
    await shot('picker-rejected', [[1440, 900]])
    await page.keyboard.press('Escape')
  })

  await step('no wallet installed: install links for MetaMask and Coinbase Wallet, Smart Wallet still offered', async () => {
    await setMocks([])
    await page.goto(BASE + '/signin')
    await openPicker()
    await page.locator('.wp-none', { hasText: 'No wallet found in this browser.' }).waitFor()
    const links = await page.locator('.wp-install a').evaluateAll((as) => as.map((a) => [a.textContent, a.getAttribute('href'), a.getAttribute('rel')]))
    if (!links.some(([t, h]) => /MetaMask/.test(t) && h === 'https://metamask.io/download/') || !links.some(([t, h]) => /Coinbase Wallet/.test(t) && h === 'https://www.coinbase.com/wallet/downloads')) throw new Error('install links ' + JSON.stringify(links))
    if (!links.every(([, , rel]) => /noopener/.test(rel))) throw new Error('install links without noopener')
    await shot('picker-no-wallet')
    await page.keyboard.press('Escape')
  })

  let preview = ''
  await step('wrong network: one-click switch, then connected; SIWE shown in full before the wallet signs', async () => {
    await setMocks([{ name: 'MetaMask', rdns: 'io.metamask', letter: 'M', color: '#b45309', behavior: 'eoa', key: 'owner', chainId: '0x1' }])
    await page.goto(BASE + '/signin')
    await openPicker()
    await page.locator('.wp-item[data-wallet="io.metamask"]').click()
    await page.locator('.wp-state', { hasText: 'Your wallet is on Ethereum' }).waitFor()
    await shot('picker-wrong-network')
    await page.locator('#wp-switch').click()
    await page.locator('#wp-continue').waitFor()
    await shot('picker-connected', [[1440, 900]])
    await page.locator('#wp-continue').click()
    await page.locator('#signin-siwe').waitFor({ timeout: 20000 })
    preview = await page.locator('#signin-siwe').innerText()
    const host = BASE.replace(/^https?:\/\//, '')
    const lines = preview.split('\n')
    const okShape = lines[0] === `${host} wants you to sign in with your Ethereum account:` && lines[1] === OWNER && lines[3] === 'Sign in to Porthmos as owner.' &&
      lines[5] === `URI: ${BASE}` && lines[6] === 'Version: 1' && lines[7] === 'Chain ID: 31337' && /^Nonce: [0-9a-f]{32}$/.test(lines[8]) &&
      /^Issued At: /.test(lines[9]) && /^Expiration Time: /.test(lines[10]) && lines[11] === 'Resources:' && lines[12] === '- urn:porthmos:role:owner'
    if (!okShape) throw new Error('SIWE preview ' + JSON.stringify(lines))
    if ((await page.evaluate(() => window.__signed.length)) !== 0) throw new Error('signed before the confirmation')
    await shot('signin-siwe')
  })

  await step('sign in: the wallet signs exactly the text shown; the account menu shows avatar, address, network, copy and disconnect', async () => {
    await page.locator('#signin-wallet-panel').getByRole('button', { name: 'Sign in as owner' }).click()
    await page.waitForURL('**/treasury', { timeout: 20000 })
    const signed = await page.evaluate(() => window.__signed[0])
    const text = await page.evaluate((h) => new TextDecoder().decode(new Uint8Array(h.slice(2).match(/../g).map((b) => parseInt(b, 16)))), signed)
    if (text !== preview) throw new Error('signed text differs from the preview')
    await page.waitForSelector('main#main h1')
    // Treasury cards fade in on load; axe reads mid-fade colours as low contrast.
    await page.waitForTimeout(1500)
    await page.locator('#account-menu').click()
    await page.locator('.acct-panel', { hasText: OWNER }).waitFor()
    for (const want of ['Your wallet', 'signed in as owner', 'Local Anvil']) if (!(await page.locator('.acct-panel', { hasText: want }).count())) throw new Error('account menu lacks ' + want)
    await page.locator('#account-copy').waitFor()
    await page.locator('#account-disconnect').waitFor()
    await shot('account-menu', [[1440, 900]])
    // The top bar moves into the header below 1024 px, which remounts the menu, so it is opened again there.
    await page.setViewportSize({ width: 390, height: 844 })
    await page.waitForTimeout(300)
    if ((await page.locator('#account-menu').getAttribute('aria-expanded')) !== 'true') await page.locator('#account-menu').click()
    await page.locator('.acct-panel').waitFor()
    await shot('account-menu', [[390, 844]])
    await page.keyboard.press('Escape')
    await page.goto(BASE + '/audit')
    await page.waitForSelector('main#main h1')
    await page.waitForTimeout(1200)
    if (!page.url().endsWith('/audit')) throw new Error('reload lost the wallet session: ' + page.url())
  })

  await step('chainChanged: a wrong-network banner with one-click switch; switching back clears it', async () => {
    await emit('io.metamask', 'chainChanged', '0x1')
    await page.locator('.net-banner', { hasText: 'Your wallet is on Ethereum.' }).waitFor()
    await shot('network-banner')
    await page.locator('#banner-switch').click()
    await page.locator('.net-banner').waitFor({ state: 'detached', timeout: 10000 })
  })

  await step('accountsChanged: the session ends at once and /signin asks to sign in again with the new account', async () => {
    await emit('io.metamask', 'accountsChanged', [BANK])
    await page.waitForURL('**/signin', { timeout: 15000 })
    await page.locator('#signin-lost', { hasText: 'Your wallet switched to' }).waitFor({ timeout: 15000 })
    await page.locator('#signin-siwe', { hasText: 'Sign in to Porthmos as bank.' }).waitFor({ timeout: 20000 })
    if ((await page.locator('#signin-siwe').innerText()).split('\n')[1] !== BANK) throw new Error('re-auth message is not for the new account')
    await shot('reauth')
  })

  await step('disconnect from the account menu signs out and returns to /signin', async () => {
    await page.locator('#signin-wallet-panel').getByRole('button', { name: 'Sign in as bank' }).click()
    // The guard kept the page the visitor was on (/audit), so sign-in returns there.
    await page.waitForURL('**/audit', { timeout: 20000 })
    await page.locator('#account-menu').click()
    await page.locator('#account-disconnect').click()
    await page.waitForURL('**/signin', { timeout: 15000 })
    await page.locator('#signin-wallet', { hasText: 'Connect wallet' }).waitFor({ timeout: 15000 })
    await page.goto(BASE + '/treasury')
    await page.waitForURL('**/signin')
  })

  if (FACTORY) {
    let wallet = ''
    await step('smart wallet: Create account with a Coinbase-style wallet; plan of every prompt shown first', async () => {
      await setMocks([{ name: 'QA Smart Wallet', rdns: 'dev.porthmos.smart', letter: 'S', color: '#0052ff', behavior: 'smart' }])
      await page.goto(BASE + '/signup')
      await page.locator('#signup-wallet').click()
      await page.locator('dialog.dialog-wallet[open] .wp-item[data-wallet="dev.porthmos.smart"]').click()
      await page.locator('#wp-continue').click()
      await page.locator('#signup-plan').waitFor({ timeout: 15000 })
      wallet = await page.locator('.auth-keys .facts dd code').first().innerText()
      await shot('signup-wallet-plan')
    })
    await step('smart wallet: ERC-6492 faucet signature, Safe, one atomic EIP-5792 batch, ERC-1271 SIWE activation', async () => {
      await page.locator('#signup-create').click()
      await page.locator('#signup-prompt', { hasText: 'AEGIS onboarding' }).waitFor({ timeout: 30000 })
      await shot('signup-prompt-sign', [[1440, 900]])
      await page.locator('#signup-prompt', { hasText: 'setup calls in one confirmation' }).waitFor({ timeout: 90000 })
      await shot('signup-prompt-batch', [[1440, 900]])
      await page.locator('#signup-recovery').waitFor({ timeout: 240000 })
      const calls = await page.evaluate(() => window.__walletCalls.map((c) => c.split(':')[1]))
      const sends = calls.filter((c) => c === 'eth_sendTransaction').length
      if (!calls.includes('wallet_sendCalls')) throw new Error('no EIP-5792 batch: ' + calls.join(','))
      if (sends !== 1) throw new Error(`expected one eth_sendTransaction (the Safe), got ${sends}`)
      const signed = await page.evaluate(() => window.__signed.map((h) => new TextDecoder().decode(new Uint8Array(h.slice(2).match(/../g).map((b) => parseInt(b, 16))))))
      if (!signed[0].startsWith('AEGIS onboarding\nowner: ' + wallet) || !signed[1].includes('Activate my Porthmos treasury and sign in as owner.')) throw new Error('signed ' + JSON.stringify(signed))
      const dl = page.waitForEvent('download')
      await page.locator('#signup-download').click()
      await dl
      await page.locator('#signup-recovery input[type=checkbox]').check()
      await page.locator('#signup-open').click()
      await page.waitForURL('**/treasury', { timeout: 20000 })
      const roles = await page.evaluate(async (a) => (await fetch(`/api/auth/roles?address=${a}`)).json(), wallet)
      if (!roles.contract || !roles.owner?.safe) throw new Error('roles ' + JSON.stringify(roles))
    })
    await step('smart wallet: sign out, then sign in again with an ERC-1271 SIWE signature', async () => {
      await page.locator('#account-menu').click()
      await page.locator('#account-disconnect').click()
      await page.waitForURL('**/signin', { timeout: 15000 })
      await openPicker()
      await page.locator('.wp-item[data-wallet="dev.porthmos.smart"]').click()
      await page.locator('#wp-continue').click()
      await page.locator('#signin-siwe', { hasText: wallet }).waitFor({ timeout: 20000 })
      await page.locator('#signin-wallet-panel').getByRole('button', { name: 'Sign in as owner' }).click()
      await page.waitForURL('**/treasury', { timeout: 20000 })
    })
  }

  const bad = axeOut.filter((a) => a.violations.length)
  return [
    ...log,
    `axe runs: ${axeOut.length}, with violations: ${bad.length}${bad.length ? '\n' + JSON.stringify(bad, null, 1) : ''}`,
    `horizontal overflow: ${overflow.length ? overflow.join('; ') : 'none'}`,
    `failed requests: ${failed.length}${failed.length ? '\n' + failed.join('\n') : ''}`,
    `console errors: ${errors.length}${errors.length ? '\n' + errors.join('\n') : ''}`,
  ].join('\n')
}
