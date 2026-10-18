import { createRequire } from 'node:module'
import { readFileSync, mkdirSync, writeFileSync, appendFileSync, existsSync, rmSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const HERE = dirname(fileURLToPath(import.meta.url))
export const REPO = resolve(HERE, '../../..')
export const FOOTAGE = resolve(HERE, '..')
export const TAKES = join(FOOTAGE, 'takes')
export const STATE = join(HERE, 'state')
export const PROFILE = join(STATE, 'profile')

const webRequire = createRequire(join(REPO, 'web/package.json'))
const viem = webRequire('viem')
const { privateKeyToAccount } = webRequire('viem/accounts')
const { baseSepolia } = webRequire('viem/chains')

const PLAYWRIGHT = process.env.PLAYWRIGHT_PATH ?? join(process.env.HOME, '.local/share/mise/installs/npm-playwright/latest/node_modules/playwright')
const { chromium } = createRequire(import.meta.url)(PLAYWRIGHT)

export const APP = process.env.APP_URL ?? 'http://localhost:4173'
export const API = 'https://aegis-api.150-109-23-187.sslip.io'
export const RPC = 'https://base-sepolia-rpc.publicnode.com'
export const CHAIN_ID = 84532
export const ADDRESS = '0x7e578f5B1a72Ed35A88714c6EbBd578809381472'

// Headless screencast frames come at CSS pixel size whatever the device scale factor, so a 1.1x zoom would only
// be upscaled later. 1920x1080 at 1x gives native pixels.
export const VIEW = { width: 1920, height: 1080, scale: 1 }
export const OUT = { width: 1920, height: 1080 }

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const rand = (a, b) => a + Math.random() * (b - a)

function readKey() {
  const text = readFileSync(join(REPO, '.secrets/my-test-wallet.env'), 'utf8')
  const line = text.split(/\r?\n/).find((l) => /^\s*(export\s+)?PRIVATE_KEY\s*=/.test(l))
  if (!line) throw new Error('PRIVATE_KEY missing in my-test-wallet.env')
  let v = line.split('=').slice(1).join('=').trim().replace(/^['"]|['"]$/g, '')
  if (!v.startsWith('0x')) v = `0x${v}`
  return v
}

const TX_LOG = join(STATE, 'tx-log.jsonl')

// Only the contracts the app's own flows talk to. Anything else is refused before signing.
function allowedTargets() {
  const cfg = JSON.parse(readFileSync(join(STATE, 'onboard-config.json'), 'utf8'))
  const extra = existsSync(join(STATE, 'extra-targets.json')) ? JSON.parse(readFileSync(join(STATE, 'extra-targets.json'), 'utf8')) : []
  return new Set([cfg.safeProxyFactory, cfg.registry, ...extra].map((a) => a.toLowerCase()))
}

export function makeWallet({ maxTx = 20, clip = 'run', signDelay = 1400, allowSafe = null, authorized: preAuthorized = false } = {}) {
  const account = privateKeyToAccount(readKey())
  if (account.address.toLowerCase() !== ADDRESS.toLowerCase()) throw new Error('Key does not match the expected test address')
  const client = viem.createPublicClient({ chain: baseSepolia, transport: viem.http(RPC) })
  let sent = 0
  // Like a real extension, the site sees no account until it asks for one.
  let authorized = preAuthorized
  let nextNonce = null
  const events = []
  const rpc = async (method, params) => {
    const res = await fetch(RPC, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: Date.now(), method, params: params ?? [] }) })
    const j = await res.json()
    if (j.error) throw Object.assign(new Error(j.error.message), { code: j.error.code, data: j.error.data })
    return j.result
  }
  const err = (code, message) => Object.assign(new Error(message), { code })
  const hexToStr = (h) => (typeof h === 'string' && /^0x[0-9a-f]*$/i.test(h) ? { raw: h } : h)

  const handlers = {
    eth_chainId: async () => viem.numberToHex(CHAIN_ID),
    net_version: async () => String(CHAIN_ID),
    eth_accounts: async () => (authorized ? [account.address] : []),
    eth_requestAccounts: async () => { authorized = true; return [account.address] },
    eth_coinbase: async () => account.address,
    wallet_requestPermissions: async () => { authorized = true; return [{ parentCapability: 'eth_accounts' }] },
    wallet_getPermissions: async () => (authorized ? [{ parentCapability: 'eth_accounts' }] : []),
    wallet_revokePermissions: async () => { authorized = false; return null },
    wallet_switchEthereumChain: async ([p]) => {
      if (Number(p?.chainId) === CHAIN_ID) return null
      throw err(4902, 'Only Base Sepolia is available in this wallet')
    },
    wallet_addEthereumChain: async ([p]) => {
      if (Number(p?.chainId) === CHAIN_ID) return null
      throw err(4200, 'Only Base Sepolia is available in this wallet')
    },
    wallet_getCapabilities: async () => { throw err(4200, 'Method not supported') },
    wallet_sendCalls: async () => { throw err(4200, 'Method not supported') },
    eth_sign: async () => { throw err(4200, 'eth_sign is disabled') },
    personal_sign: async ([msg, addr]) => {
      if (addr && addr.toLowerCase() !== account.address.toLowerCase()) [msg, addr] = [addr, msg]
      events.push({ kind: 'sign', at: Date.now() })
      await sleep(signDelay)
      return account.signMessage({ message: hexToStr(msg) })
    },
    eth_signTypedData_v4: async ([, json]) => {
      const t = typeof json === 'string' ? JSON.parse(json) : json
      const types = { ...t.types }
      delete types.EIP712Domain
      events.push({ kind: 'typed', at: Date.now(), primaryType: t.primaryType })
      await sleep(signDelay)
      return account.signTypedData({ domain: t.domain, types, primaryType: t.primaryType, message: t.message })
    },
    eth_sendTransaction: async ([tx]) => {
      if (sent >= maxTx) throw err(4100, `Recording wallet cap of ${maxTx} transactions reached`)
      const to = tx.to?.toLowerCase()
      const ok = allowedTargets()
      if (allowSafe) ok.add(allowSafe.toLowerCase())
      if (!to || !ok.has(to)) throw err(4100, `Recording wallet refuses unknown target ${tx.to}`)
      if (tx.value && BigInt(tx.value) !== 0n) throw err(4100, 'Recording wallet refuses value transfers')
      events.push({ kind: 'tx', at: Date.now() })
      await sleep(signDelay)
      const pending = Number(await rpc('eth_getTransactionCount', [account.address, 'pending']))
      const nonce = nextNonce === null ? pending : Math.max(pending, nextNonce)
      const req = { from: account.address, to: tx.to, data: tx.data ?? '0x', value: '0x0' }
      const gas = tx.gas ? BigInt(tx.gas) : (BigInt(await rpc('eth_estimateGas', [req, 'pending'])) * 13n) / 10n
      const fees = await client.estimateFeesPerGas()
      const signed = await account.signTransaction({
        chainId: CHAIN_ID, type: 'eip1559', to: tx.to, data: tx.data ?? '0x', value: 0n, nonce, gas,
        maxFeePerGas: fees.maxFeePerGas * 2n, maxPriorityFeePerGas: fees.maxPriorityFeePerGas,
      })
      const hash = await rpc('eth_sendRawTransaction', [signed])
      nextNonce = nonce + 1
      sent++
      appendFileSync(TX_LOG, JSON.stringify({ clip, hash, to: tx.to, selector: (tx.data ?? '0x').slice(0, 10), nonce, at: new Date().toISOString() }) + '\n')
      console.log(`[wallet] sent tx ${hash} to ${tx.to} (${(tx.data ?? '0x').slice(0, 10)})`)
      return hash
    },
  }

  return {
    address: account.address,
    events,
    get sent() { return sent },
    async handle(method, params) {
      const h = handlers[method]
      if (h) return h(params ?? [])
      return rpc(method, params)
    },
  }
}

const ICON = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="#1d2a24"/><rect x="14" y="20" width="36" height="26" rx="5" fill="none" stroke="#4EC397" stroke-width="4"/><circle cx="41" cy="33" r="3.5" fill="#4EC397"/></svg>')

const INIT = `(() => {
  const listeners = {}
  const emit = (ev, ...a) => (listeners[ev] || []).slice().forEach((f) => { try { f(...a) } catch {} })
  const provider = {
    isPorthmosTestWallet: true,
    request: async ({ method, params }) => {
      const r = await window.__ptw(method, params ?? [])
      if (r && r.__error) { const e = new Error(r.message); e.code = r.code; throw e }
      if (method === 'eth_requestAccounts') setTimeout(() => emit('connect', { chainId: '0x14a34' }), 0)
      return r ? r.value : r
    },
    on: (ev, f) => { (listeners[ev] = listeners[ev] || []).push(f); return provider },
    removeListener: (ev, f) => { listeners[ev] = (listeners[ev] || []).filter((x) => x !== f); return provider },
  }
  const info = Object.freeze({ uuid: '8f1c2a3e-5b7d-4c11-9e0f-6a7e2b9c4d10', name: 'Porthmos Test Wallet', icon: ${JSON.stringify(ICON)}, rdns: 'app.porthmos.testwallet' })
  const announce = () => window.dispatchEvent(new CustomEvent('eip6963:announceProvider', { detail: Object.freeze({ info, provider }) }))
  window.addEventListener('eip6963:requestProvider', announce)
  announce()
})()`

// Headless screencasts carry no OS pointer, so a cursor is drawn in the page. It lives in the top layer as a
// manual popover and is re-shown after any modal opens, or a <dialog> would paint over it.
const CURSOR = `(() => {
  const mk = () => {
    if (document.getElementById('__cur')) return
    const st = document.createElement('style')
    st.textContent = '#__cur{position:fixed;inset:auto;left:0;top:0;margin:0;padding:0;border:0;background:transparent;width:26px;height:30px;overflow:visible;pointer-events:none;z-index:2147483647;transform:translate(-100px,-100px);will-change:transform}#__cur svg{display:block;filter:drop-shadow(0 1px 2px rgba(0,0,0,.55))}#__cur .rip{position:absolute;left:-14px;top:-14px;width:28px;height:28px;border-radius:50%;border:2px solid rgba(78,195,151,.9);opacity:0;transform:scale(.4)}#__cur .rip.on{animation:__rip .45s ease-out}@keyframes __rip{0%{opacity:.95;transform:scale(.4)}100%{opacity:0;transform:scale(1.5)}}'
    document.documentElement.appendChild(st)
    const c = document.createElement('div')
    c.id = '__cur'
    c.setAttribute('popover', 'manual')
    c.innerHTML = '<span class="rip"></span><svg width="22" height="28" viewBox="0 0 22 28"><path d="M2 2 L2 22 L7.2 17.4 L10.6 25.4 L14 24 L10.7 16.2 L17.6 16.2 Z" fill="#fff" stroke="#111" stroke-width="1.6" stroke-linejoin="round"/></svg>'
    document.documentElement.appendChild(c)
    try { c.showPopover() } catch {}
    let x = -100, y = -100
    addEventListener('mousemove', (e) => { x = e.clientX; y = e.clientY; c.style.transform = 'translate(' + x + 'px,' + y + 'px)' }, true)
    addEventListener('mousedown', () => { const r = c.querySelector('.rip'); r.classList.remove('on'); void r.offsetWidth; r.classList.add('on') }, true)
    let n = 0
    setInterval(() => {
      const open = document.querySelectorAll('dialog[open], [popover]:popover-open').length
      if (open !== n) { n = open; try { c.hidePopover(); c.showPopover() } catch {} }
    }, 60)
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mk); else mk()
})()`

export async function launch({ wallet, profile = PROFILE, fresh = false } = {}) {
  if (fresh && existsSync(profile)) rmSync(profile, { recursive: true, force: true })
  mkdirSync(profile, { recursive: true })
  const ctx = await chromium.launchPersistentContext(profile, {
    executablePath: process.env.CHROME_PATH ?? '/usr/bin/chromium',
    headless: true,
    viewport: { width: VIEW.width, height: VIEW.height },
    deviceScaleFactor: VIEW.scale,
    colorScheme: 'dark',
    acceptDownloads: true,
    locale: 'en-US',
    timezoneId: 'Asia/Jakarta',
    args: ['--hide-scrollbars', '--disable-notifications', '--force-color-profile=srgb', '--font-render-hinting=none'],
  })
  if (wallet) {
    await ctx.exposeBinding('__ptw', async (_src, method, params) => {
      try {
        return { value: await wallet.handle(method, params) }
      } catch (e) {
        console.log(`[wallet] ${method} -> error ${e.code ?? ''} ${e.message}`)
        return { __error: true, code: e.code ?? -32603, message: e.message }
      }
    })
    await ctx.addInitScript(INIT)
  }
  await ctx.addInitScript(() => { try { localStorage.setItem('porthmos.theme', 'dark') } catch {} })
  await ctx.addInitScript(CURSOR)
  const page = ctx.pages()[0] ?? (await ctx.newPage())
  page.on('pageerror', (e) => console.log(`[page error] ${e.message}`))
  page.on('console', (m) => { if (m.type() === 'error') console.log(`[console] ${m.text().slice(0, 300)}`) })
  return { ctx, page }
}

export class Recorder {
  constructor(page, name) {
    this.page = page
    this.name = name
    this.dir = join(TAKES, `${name}-${new Date().toISOString().replace(/[:.]/g, '-')}`)
    this.frames = []
    this.marks = {}
    this.t0 = null
  }
  async start() {
    mkdirSync(join(this.dir, 'frames'), { recursive: true })
    this.cdp = await this.page.context().newCDPSession(this.page)
    this.cdp.on('Page.screencastFrame', async (f) => {
      const ts = f.metadata.timestamp
      if (this.t0 === null) this.t0 = ts
      const file = join(this.dir, 'frames', `${String(this.frames.length).padStart(6, '0')}.jpg`)
      writeFileSync(file, Buffer.from(f.data, 'base64'))
      this.frames.push({ file, ts })
      try { await this.cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId }) } catch {}
    })
    this.wall0 = Date.now() / 1000
    await this.cdp.send('Page.startScreencast', { format: 'jpeg', quality: 96, maxWidth: OUT.width + 4, maxHeight: OUT.height + 4, everyNthFrame: 1 })
    // Nudge a repaint so the first frame arrives at t=0 even on a still page.
    await this.page.evaluate(() => { document.documentElement.style.outline = '0 solid transparent'; requestAnimationFrame(() => { document.documentElement.style.outline = '' }) })
    await sleep(300)
  }
  now() {
    return this.t0 === null ? 0 : Date.now() / 1000 - this.t0
  }
  mark(name) {
    const t = +this.now().toFixed(2)
    this.marks[name] = t
    console.log(`[mark] ${this.name} ${name} @ ${t}s`)
    return t
  }
  async stop(tailMs = 600) {
    await sleep(tailMs)
    const end = Date.now() / 1000
    await this.cdp.send('Page.stopScreencast')
    await sleep(200)
    const list = []
    for (let i = 0; i < this.frames.length; i++) {
      const cur = this.frames[i]
      const next = this.frames[i + 1]?.ts ?? (this.t0 + (end - this.wall0))
      const d = Math.max(0.001, next - cur.ts)
      list.push(`file '${cur.file}'`, `duration ${d.toFixed(4)}`)
    }
    list.push(`file '${this.frames[this.frames.length - 1].file}'`)
    writeFileSync(join(this.dir, 'frames.txt'), list.join('\n'))
    const out = join(this.dir, `${this.name}.mp4`)
    const run = execFileSync
    run('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', join(this.dir, 'frames.txt'),
      '-vf', `crop=${OUT.width}:${OUT.height}:0:0,fps=30,format=yuv420p`, '-fps_mode', 'cfr',
      '-c:v', 'libx264', '-preset', 'slow', '-crf', '16', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', out])
    const duration = Number(run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', out]).toString().trim())
    const meta = { name: this.name, file: out, duration: +duration.toFixed(2), fps: 30, frames: this.frames.length, marks: this.marks }
    writeFileSync(join(this.dir, 'take.json'), JSON.stringify(meta, null, 2))
    rmSync(join(this.dir, 'frames'), { recursive: true, force: true })
    rmSync(join(this.dir, 'frames.txt'), { force: true })
    console.log(`[take] ${out} ${meta.duration}s, ${meta.frames} source frames`)
    return meta
  }
}

export class Human {
  constructor(page) {
    this.page = page
    this.x = VIEW.width * 0.62
    this.y = VIEW.height * 0.55
  }
  async place(x, y) {
    this.x = x; this.y = y
    await this.page.mouse.move(x, y)
  }
  async moveTo(x, y, ms = 600) {
    const sx = this.x, sy = this.y
    const dx = x - sx, dy = y - sy
    const dist = Math.hypot(dx, dy)
    if (dist < 2) return
    const dur = Math.max(260, Math.min(ms * (0.6 + dist / 1400), ms * 1.4))
    const bend = rand(-0.12, 0.12) * dist
    const nx = -dy / (dist || 1), ny = dx / (dist || 1)
    const cx = sx + dx / 2 + nx * bend, cy = sy + dy / 2 + ny * bend
    const start = Date.now()
    for (;;) {
      const t = Math.min(1, (Date.now() - start) / dur)
      const e = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2
      const px = (1 - e) * (1 - e) * sx + 2 * (1 - e) * e * cx + e * e * x
      const py = (1 - e) * (1 - e) * sy + 2 * (1 - e) * e * cy + e * e * y
      await this.page.mouse.move(px, py)
      if (t >= 1) break
      await sleep(14)
    }
    this.x = x; this.y = y
  }
  async target(locator, { dx = 0, dy = 0 } = {}) {
    await locator.waitFor({ state: 'visible', timeout: 60000 })
    await locator.scrollIntoViewIfNeeded()
    const b = await locator.boundingBox()
    if (!b) throw new Error('No box for target')
    return { x: b.x + b.width / 2 + dx + rand(-b.width * 0.08, b.width * 0.08), y: b.y + b.height / 2 + dy + rand(-b.height * 0.12, b.height * 0.12) }
  }
  async hover(locator, opts = {}) {
    const p = await this.target(locator, opts)
    await this.moveTo(p.x, p.y, opts.ms ?? 600)
  }
  async click(locator, opts = {}) {
    await this.hover(locator, opts)
    await sleep(opts.pause ?? rand(140, 260))
    await this.page.mouse.down()
    await sleep(rand(60, 110))
    await this.page.mouse.up()
    await sleep(120)
  }
  async type(text, { min = 40, max = 70 } = {}) {
    for (const ch of text) {
      await this.page.keyboard.type(ch)
      let d = rand(min, max)
      if (ch === ' ') d += rand(10, 40)
      if (/[.,?]/.test(ch)) d += rand(60, 140)
      if (Math.random() < 0.04) d += rand(120, 260)
      await sleep(d)
    }
  }
  async drift(ms, { radius = 60, cx = this.x, cy = this.y } = {}) {
    const end = Date.now() + ms
    while (Date.now() < end) {
      const left = end - Date.now()
      const step = Math.min(left, rand(1400, 2400))
      await this.moveTo(cx + rand(-radius, radius), cy + rand(-radius * 0.6, radius * 0.6), step)
      if (end - Date.now() > 300) await sleep(rand(150, 400))
    }
  }
  async wander(points, totalMs) {
    const each = totalMs / points.length
    for (const [x, y] of points) {
      await this.moveTo(x, y, each * 0.75)
      await sleep(each * 0.25)
    }
  }
}

export async function waitFor(fn, { timeout = 60000, every = 250, what = 'condition' } = {}) {
  const end = Date.now() + timeout
  for (;;) {
    const v = await fn()
    if (v) return v
    if (Date.now() > end) throw new Error(`Timed out waiting for ${what}`)
    await sleep(every)
  }
}

export async function prepState() {
  mkdirSync(STATE, { recursive: true })
  if (!existsSync(join(STATE, 'onboard-config.json'))) {
    const cfg = await (await fetch(`${API}/api/onboard/config`)).json()
    writeFileSync(join(STATE, 'onboard-config.json'), JSON.stringify(cfg, null, 2))
  }
}

export async function signInOwner(page, human) {
  await page.goto(`${APP}/signin`, { waitUntil: 'load' })
  await sleep(1200)
  if (/\/(treasury|copilot)/.test(page.url())) return
  await page.locator('#signin-wallet').click()
  const pick = page.locator('button.wp-item', { hasText: 'Porthmos Test Wallet' })
  await pick.waitFor({ timeout: 20000 })
  await pick.click()
  await page.locator('#wp-continue').click({ timeout: 20000 })
  const btn = page.getByRole('button', { name: /^Sign in as owner/ })
  await btn.waitFor({ timeout: 30000 })
  await waitFor(async () => btn.isEnabled(), { what: 'sign-in button enabled' })
  await btn.click()
  await page.waitForURL(/\/(treasury|copilot|bank|orders)/, { timeout: 60000 })
  await sleep(1500)
}

export function saveTake(meta) {
  const p = join(FOOTAGE, 'takes', 'index.jsonl')
  appendFileSync(p, JSON.stringify({ ...meta, at: new Date().toISOString() }) + '\n')
}
