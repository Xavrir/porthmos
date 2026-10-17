// Dev only. A stand-in for the AEGIS service (docs/MULTI-TENANT.md) over a local Anvil set up by chain.mjs.
// Operator roles (authorizer, exit key, executor, keeper, attacker, faucet) are Anvil's unlocked accounts and sign
// through JSON-RPC, so this file holds no private key. Run: node scripts/mock/api.mjs  (MOCK_PORT, MOCK_RPC).
import { createServer } from 'node:http'
import { randomBytes, randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import {
  BaseError, ContractFunctionRevertedError, encodeFunctionData, encodePacked, getAddress, getContractAddress, hexToBigInt,
  keccak256, recoverMessageAddress, recoverTypedDataAddress, toHex, zeroAddress,
} from 'viem'
import { parseSiweMessage, validateSiweMessage } from 'viem/siwe'
import { artifact, clients, MOCK_FILE, RPC } from './chain.mjs'

const PORT = Number(process.env.MOCK_PORT ?? 8790)
const CLOSED = process.env.MOCK_CLOSED === '1'
const FUND_LIMIT = Number(process.env.MOCK_FUND_LIMIT ?? 1000)
const m = JSON.parse(readFileSync(MOCK_FILE, 'utf8'))
const { pub, wallet } = clients()
const A = {
  module: artifact('AegisModule').abi, registry: artifact('PolicyRegistry').abi, usdc: artifact('MockUSDC').abi,
  vault: artifact('MockVault').abi, feed: artifact('MockPriceFeed').abi, safe: artifact('SafeL2').abi, factory: artifact('SafeProxyFactory').abi,
}
const R = m.roles
const VAULTS = [{ address: getAddress(m.vaultA), name: 'Vault A' }, { address: getAddress(m.vaultB), name: 'Vault B' }]
const PARAMS = { autoCap: '1000000000', dailyCap: '5000000000', bankLimit: '3000000000', maxBandWidth: '2000000', maxOracleAge: 180 }
const BOUNDS = { autoCapMax: '10000000000', dailyCapMax: '50000000000', bankLimitMax: '50000000000', maxBandWidthMax: '5000000', maxOracleAgeMax: 3600 }
const CONFIG = {
  chainId: 31337, rpcUrl: RPC, explorer: '',
  safeSingleton: getAddress(m.safeSingleton), safeProxyFactory: getAddress(m.safeProxyFactory), fallbackHandler: getAddress(m.fallbackHandler),
  registry: getAddress(m.registry), module: getAddress(m.module), usdc: getAddress(m.usdc), priceFeed: getAddress(m.priceFeed), vaults: VAULTS,
  operator: { authorizer: getAddress(R.authorizer), exitKey: getAddress(R.exitKey), executor: getAddress(R.executor), keeper: getAddress(R.keeper) },
  params: PARAMS, paramBounds: BOUNDS,
  // Anvil charges about 1 gwei, so the local drip is larger than the 84532 defaults.
  ethOwner: '20000000000000000', ethBank: '5000000000000000', testUsdc: '100000000000',
  referenceSafe: zeroAddress, onboardingOpen: !CLOSED,
}

const tenants = new Map()
const funded = new Set()
const sessions = new Map()
const nonces = new Map()
const requests = new Map()
const ledger = new Map()
const lastDar = new Map()
const obligations = new Map()
let fundCalls = 0
let market = { scenario: process.env.MOCK_MARKET ?? null }

const lc = (a) => String(a).toLowerCase()
const amount = (raw) => ({ raw: String(raw), display: (Number(raw) / 1e6).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) })
const now = () => Math.floor(Date.now() / 1000)
const read = (address, abi, functionName, args = []) => pub.readContract({ address, abi, functionName, args })
const reg = (fn, args) => read(CONFIG.registry, A.registry, fn, args)

class HttpError extends Error {
  constructor(status, code, detail) { super(detail ?? code); this.status = status; this.code = code; this.detail = detail ?? null }
}

function appendLedger(safe, row) {
  const rows = ledger.get(lc(safe)) ?? []
  const prevHash = rows.length ? rows[rows.length - 1].rowHash : `0x${'0'.repeat(64)}`
  const full = { seq: rows.length + 1, ts: now(), prevHash, ...row }
  full.rowHash = keccak256(toHex(JSON.stringify({ ...full, rowHash: undefined })))
  rows.push(full)
  ledger.set(lc(safe), rows)
}

async function send(from, address, abi, functionName, args, gas) {
  const hash = await wallet(from).writeContract({ address, abi, functionName, args, ...(gas ? { gas } : {}) })
  return { hash, receipt: await pub.waitForTransactionReceipt({ hash }) }
}

async function revertName(from, address, abi, functionName, args) {
  try {
    await pub.simulateContract({ account: from, address, abi, functionName, args })
    return null
  } catch (e) {
    const r = e instanceof BaseError ? e.walk((x) => x instanceof ContractFunctionRevertedError) : null
    return r?.data?.errorName ?? r?.reason ?? 'ExecutionFailed'
  }
}

function predictSafe(owner, code) {
  const init = encodeFunctionData({ abi: A.safe, functionName: 'setup', args: [[owner], 1n, zeroAddress, '0x', CONFIG.fallbackHandler, zeroAddress, 0n, zeroAddress] })
  const saltNonce = hexToBigInt(keccak256(encodePacked(['address', 'string'], [owner, 'aegis-v2'])))
  const salt = keccak256(encodePacked(['bytes32', 'uint256'], [keccak256(init), saltNonce]))
  return getContractAddress({ opcode: 'CREATE2', from: CONFIG.safeProxyFactory, salt, bytecode: encodePacked(['bytes', 'uint256'], [code, hexToBigInt(CONFIG.safeSingleton)]) })
}

let creationCode
async function safeFor(owner) {
  creationCode ??= await read(CONFIG.safeProxyFactory, A.factory, 'proxyCreationCode')
  return predictSafe(getAddress(owner), creationCode)
}

async function steps(owner) {
  const safe = await safeFor(owner)
  const code = await pub.getCode({ address: safe })
  const deployed = !!code && code !== '0x'
  const [mod, o, b, au, ek, va, vb, ac, dc, bw, oa, bl] = deployed ? await Promise.all([
    read(safe, A.safe, 'isModuleEnabled', [CONFIG.module]), reg('owner', [safe]), reg('bank', [safe]), reg('authorizer', [safe]), reg('exitKey', [safe]),
    reg('allowedVault', [safe, VAULTS[0].address]), reg('allowedVault', [safe, VAULTS[1].address]),
    reg('autoCap', [safe]), reg('dailyCap', [safe]), reg('maxBandWidth', [safe]), reg('maxOracleAge', [safe]), reg('bankLimit', [safe]),
  ]) : []
  return {
    safe,
    bank: b,
    steps: {
      funded: funded.has(lc(owner)), safeDeployed: deployed, moduleEnabled: !!mod, registered: !!o && o !== zeroAddress, vaults: !!va && !!vb,
      authorizer: lc(au ?? '') === lc(CONFIG.operator.authorizer), exitKey: lc(ek ?? '') === lc(CONFIG.operator.exitKey),
      caps: !!oa && ac > 0n && dc > 0n && bw > 0n, bankLimit: !!bl && bl > 0n, activated: tenants.has(lc(safe)),
    },
    raw: { ac, dc, bw, oa, bl, o },
  }
}

async function verifyPersonal(message, signature, expected) {
  let signer
  try { signer = await recoverMessageAddress({ message, signature }) } catch { throw new HttpError(401, 'BadSignature') }
  if (lc(signer) !== lc(expected)) throw new HttpError(401, 'BadSignature')
}

// Same rules as aegis/siwe.py, in short: allowed domain, its own URI, chain 31337, fresh, unexpired, single-use nonce.
async function verifySiwe(message, signature, purpose) {
  const f = parseSiweMessage(message ?? '')
  if (!f.address || !f.nonce || !f.domain) throw new HttpError(400, 'SiweMalformed')
  if (!/^(localhost|127\.0\.0\.1)(:\d+)?$/.test(f.domain) || !f.uri?.startsWith(`http://${f.domain}`)) throw new HttpError(401, 'WrongDomain')
  if (f.chainId !== 31337) throw new HttpError(401, 'WrongChain')
  if (!f.expirationTime || !validateSiweMessage({ message: f, time: new Date() })) throw new HttpError(401, 'MessageExpired')
  const n = nonces.get(f.nonce)
  if (!n) throw new HttpError(401, 'BadNonce')
  if (n.used) throw new HttpError(401, 'NonceUsed')
  const role = purpose === 'activate' ? 'owner' : /^Sign in to Porthmos as (owner|bank)\.$/.exec(f.statement ?? '')?.[1]
  if (!role || JSON.stringify(f.resources ?? []).indexOf(`urn:porthmos:role:${role}`) < 0) throw new HttpError(401, 'WrongRole')
  if (!(await pub.verifyMessage({ address: f.address, message, signature }).catch(() => false))) throw new HttpError(401, 'BadSignature')
  n.used = true
  return { address: getAddress(f.address), role }
}

function openSession(role, address) {
  const list = [...tenants.values()]
  const t = role === 'owner' ? list.find((x) => lc(x.owner) === lc(address)) : list.find((x) => lc(x.bank) === lc(address))
  if (!t) throw new HttpError(403, role === 'owner' ? 'NotAnOwner' : 'NotABank')
  const token = randomBytes(24).toString('hex')
  sessions.set(token, { role, address: getAddress(address), safe: role === 'owner' ? t.safe : null })
  return { token, role, address: getAddress(address), safe: role === 'owner' ? t.safe : null, expiresAt: Math.floor(Date.now() / 1000) + 12 * 3600 }
}

function checkAge(issuedAt) {
  const t = Date.parse(issuedAt)
  if (!Number.isFinite(t) || Math.abs(Date.now() - t) > 5 * 60 * 1000) throw new HttpError(401, 'StaleSignature')
}

async function snapshot(safe) {
  const [usdc, frozenO, frozenB, ver, ac, dc, bl, floor, bw, oa, au] = await Promise.all([
    read(CONFIG.usdc, A.usdc, 'balanceOf', [safe]), reg('ownerFrozen', [safe]), reg('bankFrozen', [safe]), reg('policyVersion', [safe]),
    reg('autoCap', [safe]), reg('dailyCap', [safe]), reg('bankLimit', [safe]), reg('reserveFloor', [safe]), reg('maxBandWidth', [safe]), reg('maxOracleAge', [safe]), reg('authorizer', [safe]),
  ])
  const vaults = await Promise.all(VAULTS.map(async (v) => {
    const shares = await read(v.address, A.vault, 'balanceOf', [safe])
    const assets = shares > 0n ? await read(v.address, A.vault, 'convertToAssets', [shares]) : 0n
    return { ...v, shares: String(shares), assets: amount(assets), allowed: await reg('allowedVault', [safe, v.address]), quarantined: await reg('quarantined', [safe, v.address]), everDeposited: await read(CONFIG.module, A.module, 'everDeposited', [safe, v.address]) }
  }))
  const total = usdc + vaults.reduce((a, v) => a + BigInt(v.assets.raw), 0n)
  const obs = (obligations.get(lc(safe)) ?? []).filter((o) => !o.settled)
  const required = 500_000_000n + obs.filter((o) => !o.confirmedInflow).reduce((a, o) => a + BigInt(o.amount.raw), 0n)
  const deployable = usdc > (required > floor ? required : floor) ? usdc - (required > floor ? required : floor) : 0n
  return {
    safe, balances: { safeUsdc: amount(usdc), vaults, total: amount(total) },
    reserve: { required: amount(required), onchainFloor: amount(floor), inSync: floor >= required, scheduleHash: keccak256(toHex(JSON.stringify(obs.map((o) => o.id)))) },
    deployable: amount(deployable),
    depositedToday: amount(await read(CONFIG.module, A.module, 'depositedToday', [safe])),
    policy: { autoCap: amount(ac), dailyCap: amount(dc), bankLimit: amount(bl), frozen: { owner: frozenO, bank: frozenB }, version: Number(ver), maxBandWidth: String(bw), maxOracleAge: Number(oa), authorizerRevoked: au === zeroAddress },
  }
}

function session(req) {
  const s = sessions.get(req.headers['x-aegis-session'])
  if (!s) throw new HttpError(401, 'SessionRequired', 'POST /api/session first and send X-Aegis-Session')
  return s
}

function safeOf(s, url) {
  if (s.role === 'owner') return s.safe
  const want = url.searchParams.get('safe')
  const mine = [...tenants.values()].filter((t) => lc(t.bank) === lc(s.address))
  const hit = want ? mine.find((t) => lc(t.safe) === lc(want)) : mine[0]
  if (!hit) throw new HttpError(404, 'UnknownSafe')
  return hit.safe
}

function record(safe, message, extra = {}) {
  const id = `r-${randomUUID().slice(0, 8)}`
  const r = { id, safe, createdAt: now(), message, origin: 'owner', state: 'REQUEST_RECEIVED', history: [{ state: 'REQUEST_RECEIVED', at: now() }], ...extra }
  requests.set(id, r)
  return r
}

function move(r, state, patch = {}) {
  Object.assign(r, patch, { state })
  r.history.push({ state, at: now(), ...(patch.note ? { note: patch.note } : {}) })
}

const APPROVAL_TYPES = { Approval: [
  { name: 'safe', type: 'address' }, { name: 'op', type: 'uint8' }, { name: 'vault', type: 'address' }, { name: 'maxAmount', type: 'uint256' },
  { name: 'policyVersion', type: 'uint64' }, { name: 'approvalExpiry', type: 'uint64' }, { name: 'approvalNonce', type: 'uint256' },
] }
const DAR_TYPES = { DAR: [
  { name: 'safe', type: 'address' }, { name: 'op', type: 'uint8' }, { name: 'vault', type: 'address' }, { name: 'amount', type: 'uint256' },
  { name: 'minOut', type: 'uint256' }, { name: 'policyVersion', type: 'uint64' }, { name: 'priceLow', type: 'int256' }, { name: 'priceHigh', type: 'int256' },
  { name: 'tier', type: 'uint8' }, { name: 'approvalHash', type: 'bytes32' }, { name: 'nonce', type: 'uint256' }, { name: 'expiry', type: 'uint64' }, { name: 'evidenceHash', type: 'bytes32' },
] }
const DOMAIN = { name: 'AegisModule', version: '1', chainId: 31337, verifyingContract: CONFIG.module }
const rand = () => hexToBigInt(toHex(randomBytes(32)))

async function signDar(signer, dar) {
  return wallet(signer).signTypedData({ account: signer, domain: DOMAIN, types: DAR_TYPES, primaryType: 'DAR', message: dar })
}

async function freshDar(safe, op, vault, amt, tier, approvalHash) {
  await send(R.keeper, CONFIG.priceFeed, A.feed, 'poke', [])
  const block = await pub.getBlock()
  return {
    safe, op, vault, amount: amt, minOut: 0n, policyVersion: await reg('policyVersion', [safe]), priceLow: 99000000n, priceHigh: 101000000n, tier,
    approvalHash: approvalHash ?? `0x${'0'.repeat(64)}`, nonce: rand(), expiry: block.timestamp + 120n, evidenceHash: keccak256(toHex('mock-evidence')),
  }
}

async function submit(r, functionName, args, from = R.executor) {
  const error = await revertName(from, CONFIG.module, A.module, functionName, args)
  const { hash, receipt } = await send(from, CONFIG.module, A.module, functionName, args, 1_500_000n)
  const ok = receipt.status === 'success'
  return { hash, ok, error: ok ? null : error ?? 'ExecutionFailed', block: Number(receipt.blockNumber) }
}

async function executeDeposit(r, approval, ownerSig) {
  try {
    move(r, 'APPROVED')
    const approvalHash = await read(CONFIG.module, A.module, 'approvalStructHash', [approval])
    const dar = await freshDar(r.safe, 0, approval.vault, approval.maxAmount, 3, approvalHash)
    const sig = await signDar(R.authorizer, dar)
    move(r, 'DAR_SIGNED')
    const out = await submit(r, 'deposit', [dar, sig, ownerSig, '0x', approval])
    move(r, 'SUBMITTED', { txHash: out.hash })
    if (out.ok) {
      lastDar.set(lc(r.safe), { dar, sig, ownerSig, approval })
      move(r, 'CONFIRMED', { explanation: `Deposited ${amount(approval.maxAmount).display} into ${r.actionCard.vault.name}.` })
      appendLedger(r.safe, { requestId: r.id, kind: 'execution', state: 'CONFIRMED', summary: r.explanation, op: 'DEPOSIT', amount: amount(approval.maxAmount), tier: 3, txHash: out.hash })
    } else {
      move(r, 'REVERTED', { revertReason: out.error, explanation: `The contract refused the deposit with ${out.error}. Nothing moved.` })
      appendLedger(r.safe, { requestId: r.id, kind: 'rejection', state: 'REVERTED', summary: 'Deposit refused on-chain', revertReason: out.error, txHash: out.hash, tier: 3 })
    }
  } catch (e) {
    move(r, 'REVERTED', { revertReason: 'ExecutionFailed', explanation: String(e.shortMessage ?? e.message).split('\n')[0] })
  }
}

async function chat(s, message) {
  const safe = s.safe
  const text = message.toLowerCase()
  const vault = /vault b/.test(text) ? VAULTS[1] : VAULTS[0]
  const dep = text.match(/deposit\s+([\d.]+)/)
  if (dep) {
    const raw = BigInt(Math.round(Number(dep[1]) * 1e6))
    const ver = await reg('policyVersion', [safe])
    const approval = { safe, op: 0, vault: vault.address, maxAmount: String(raw), policyVersion: Number(ver), approvalExpiry: now() + 86400, approvalNonce: rand().toString() }
    const r = record(safe, message, {
      actionCard: {
        requestId: '', op: 'DEPOSIT', vault, amount: amount(raw), tier: 3, requiredSigners: ['authorizer', 'owner'], reason: `A first deposit into ${vault.name} needs your approval (tier 3).`,
        reserveAfter: amount(0), simulation: { ok: true, sharesOut: amount(raw) },
        policyChecks: [{ name: 'notFrozen', ok: !(await reg('bankFrozen', [safe])), detail: 'Owner and bank freezes' }, { name: 'vaultAllowed', ok: await reg('allowedVault', [safe, vault.address]), detail: vault.name }],
        approvalTypedData: { domain: DOMAIN, types: APPROVAL_TYPES, primaryType: 'Approval', message: approval },
      },
    })
    r.actionCard.requestId = r.id
    move(r, 'INTENT_PARSED'); move(r, 'POLICY_CHECKED'); move(r, 'SIMULATED'); move(r, 'AWAITING_APPROVAL')
    return { reply: `I can deposit ${amount(raw).display} into ${vault.name}. It is a first deposit, so it waits for your approval.`, requestId: r.id, state: r.state, actionCard: r.actionCard }
  }
  if (/exit|redeem|withdraw/.test(text)) {
    const shares = await read(vault.address, A.vault, 'balanceOf', [safe])
    const r = record(safe, message)
    if (shares === 0n) {
      move(r, 'EXPLAINED', { explanation: `There is nothing in ${vault.name} to exit.` })
      return { reply: r.explanation, requestId: r.id, state: r.state }
    }
    const dar = await freshDar(safe, 1, vault.address, shares, 1)
    const sig = await signDar(R.exitKey, dar)
    move(r, 'DAR_SIGNED')
    const out = await submit(r, 'redeem', [dar, sig])
    move(r, 'SUBMITTED', { txHash: out.hash })
    if (out.ok) move(r, 'CONFIRMED', { explanation: `Redeemed all shares of ${vault.name} back to the Safe.` })
    else move(r, 'REVERTED', { revertReason: out.error, explanation: `The contract refused the exit with ${out.error}.` })
    appendLedger(safe, { requestId: r.id, kind: out.ok ? 'execution' : 'rejection', state: r.state, summary: r.explanation, op: 'REDEEM', tier: 1, txHash: out.hash, revertReason: out.ok ? undefined : out.error })
    return { reply: r.explanation, requestId: r.id, state: r.state }
  }
  const r = record(safe, message)
  const t = await snapshot(safe)
  move(r, 'EXPLAINED', { explanation: `The Safe holds ${t.balances.safeUsdc.display} USDC. The reserve floor on-chain is ${t.reserve.onchainFloor.display}.` })
  return { reply: r.explanation, requestId: r.id, state: r.state }
}

async function attack(s, kind) {
  const safe = s.safe
  if (kind === 'replay') {
    const last = lastDar.get(lc(safe))
    if (!last) throw new HttpError(409, 'NothingToReplay', 'no executed record to replay')
    const out = await submit(null, 'deposit', [last.dar, last.sig, last.ownerSig, '0x', last.approval], R.attacker)
    appendLedger(safe, { kind: 'rejection', state: 'REVERTED', summary: 'Replayed record refused', revertReason: out.error, txHash: out.hash })
    return { kind, txHash: out.hash, reverted: !out.ok, error: out.error ?? 'none', blockNumber: out.block }
  }
  const dar = await freshDar(safe, 0, VAULTS[0].address, 1_000_000n, 2)
  const sig = await signDar(R.authorizer, dar)
  const tampered = { ...dar, amount: 2_000_000n }
  const approval = { safe, op: 0, vault: VAULTS[0].address, maxAmount: 0n, policyVersion: 0n, approvalExpiry: 0n, approvalNonce: 0n }
  const out = await submit(null, 'deposit', [tampered, sig, '0x', '0x', approval], R.attacker)
  appendLedger(safe, { kind: 'rejection', state: 'REVERTED', summary: 'Tampered record refused', revertReason: out.error, txHash: out.hash })
  return { kind, txHash: out.hash, reverted: !out.ok, error: out.error ?? 'none', blockNumber: out.block }
}

const routes = [
  ['GET', '/api/health', async () => ({ ok: true, chainId: 31337, llm: 'deterministic', tenants: tenants.size, onboardingOpen: !CLOSED, block: Number(await pub.getBlockNumber()) })],
  ['GET', '/api/onboard/config', async () => CONFIG],
  ['GET', '/api/market', async () => {
    const on = market.scenario && market.scenario !== 'restore'
    return { price: on && market.scenario === 'depeg' ? '98500000' : '100000000', stale: market.scenario === 'stale', pegDeviationPct: on && market.scenario === 'depeg' ? -1.5 : 0, maxOracleAge: 180, vaults: VAULTS.map((v) => ({ ...v, liquidityCapped: market.scenario === 'liquidity' })), active: on ? [market.scenario] : [], scenario: on ? { name: market.scenario, at: now(), by: 'admin' } : null, time: now() }
  }],
  ['POST', '/mock/market', async ({ body }) => { market = { scenario: body.scenario ?? null }; return market }],
  ['GET', '/api/onboard/status', async ({ url }) => {
    const owner = url.searchParams.get('owner')
    if (!owner) throw new HttpError(400, 'BadAddress')
    const st = await steps(owner)
      const t = tenants.get(lc(st.safe))
    return { safe: st.safe, owner: getAddress(owner), bank: st.steps.registered ? st.bank : null, steps: st.steps, tenant: t ?? null }
  }],
  ['POST', '/api/onboard/fund', async ({ body }) => {
    if (CLOSED) throw new HttpError(403, 'OnboardingClosed')
    if (++fundCalls > FUND_LIMIT) throw new HttpError(429, 'RateLimited', 'onboarding limit for this address')
    if (process.env.MOCK_FAUCET_EMPTY === '1') throw new HttpError(503, 'FaucetEmpty')
    checkAge(body.issuedAt)
    await verifyPersonal(`AEGIS onboarding\nowner: ${getAddress(body.owner)}\nbank: ${getAddress(body.bank)}\nchainId: 31337\nissuedAt: ${body.issuedAt}`, body.signature, body.owner)
    const txs = []
    for (const [address, target] of [[body.owner, CONFIG.ethOwner], [body.bank, CONFIG.ethBank]]) {
      const bal = await pub.getBalance({ address })
      if (!funded.has(lc(address)) && bal * 2n < BigInt(target)) {
        const hash = await wallet(R.deployer).sendTransaction({ account: R.deployer, to: address, value: BigInt(target) - bal })
        await pub.waitForTransactionReceipt({ hash })
        txs.push({ address, hash, amountWei: String(BigInt(target) - bal) })
      }
      funded.add(lc(address))
    }
    return { txs }
  }],
  ['POST', '/api/onboard/activate', async ({ body }) => {
    const v = await verifySiwe(body.message, body.signature, 'activate')
    if (lc(v.address) !== lc(body.owner)) throw new HttpError(401, 'BadSignature')
    const st = await steps(body.owner)
    if (lc(st.safe) !== lc(body.safe)) throw new HttpError(409, 'BadOnboardingState', 'safe is not the predicted address for this owner')
    const CODES = { safeDeployed: 'SafeNotDeployed', moduleEnabled: 'ModuleNotEnabled', registered: 'RegistryOwnerMismatch', vaults: 'VaultMissing:Vault B', authorizer: 'WrongAuthorizer', exitKey: 'WrongExitKey', caps: 'AutoCapOutOfBounds', bankLimit: 'BankLimitOutOfBounds' }
    const failed = Object.entries(st.steps).filter(([k, v]) => !v && CODES[k]).map(([k]) => CODES[k])
    if (failed.length) { const e = new HttpError(409, 'BadOnboardingState', 'activation checks failed'); e.failed = failed; throw e }
    if (lc(st.bank) === lc(body.owner) || st.bank === zeroAddress) throw new HttpError(409, 'BadOnboardingState', 'bank must differ from owner')
    const existing = tenants.get(lc(st.safe))
    if (existing) return { safe: existing.safe, mintTx: existing.mintTx, tenant: existing, session: openSession('owner', body.owner) }
    const { hash } = await send(R.deployer, CONFIG.usdc, A.usdc, 'mint', [st.safe, BigInt(CONFIG.testUsdc)])
    const t = { safe: getAddress(st.safe), owner: getAddress(body.owner), bank: getAddress(st.bank), mintTx: hash, activatedAt: now() }
    tenants.set(lc(st.safe), t)
    appendLedger(t.safe, { kind: 'policy', state: 'POLICY_CHANGED', summary: `Treasury activated, ${amount(CONFIG.testUsdc).display} test USDC minted`, txHash: hash })
    return { safe: t.safe, mintTx: hash, tenant: t, session: openSession('owner', body.owner) }
  }],
  ['GET', '/api/auth/nonce', async () => {
    const nonce = randomBytes(16).toString('hex')
    nonces.set(nonce, { at: Date.now(), used: false })
    return { nonce }
  }],
  ['GET', '/api/auth/roles', async ({ url }) => {
    const a = getAddress(url.searchParams.get('address') ?? zeroAddress)
    const list = [...tenants.values()]
    const own = list.find((x) => lc(x.owner) === lc(a))
    return { address: a, owner: own ? { safe: own.safe, bank: own.bank } : null, bank: list.filter((x) => lc(x.bank) === lc(a)).map((x) => ({ safe: x.safe, owner: x.owner })), pendingOwner: null, contract: false }
  }],
  ['POST', '/api/session', async ({ body }) => {
    const v = await verifySiwe(body.message, body.signature, 'session')
    return openSession(v.role, v.address)
  }],
  ['GET', '/api/treasury', async ({ s, url }) => snapshot(safeOf(s, url))],
  ['GET', '/api/obligations', async ({ s, url }) => {
    const safe = safeOf(s, url)
    const list = obligations.get(lc(safe)) ?? []
    const required = 500_000_000n + list.filter((o) => !o.settled && !o.confirmedInflow).reduce((a, o) => a + BigInt(o.amount.raw), 0n)
    const scheduleHash = keccak256(toHex(JSON.stringify(list.map((o) => o.id))))
    return { obligations: list, floorUpdate: s.role === 'owner' ? { to: CONFIG.registry, data: encodeFunctionData({ abi: A.registry, functionName: 'setReserveFloor', args: [safe, required, scheduleHash] }), value: '0', floor: String(required), scheduleHash } : null }
  }],
  ['POST', '/api/obligations', async ({ s, body }) => {
    if (s.role !== 'owner') throw new HttpError(403, 'OwnerOnly')
    const raw = BigInt(Math.round(Number(body.amount) * 1e6))
    const ob = { id: `o-${randomUUID().slice(0, 6)}`, label: body.label, amount: amount(raw), dueDate: body.dueDate, confirmedInflow: !!body.confirmedInflow }
    const list = [...(obligations.get(lc(s.safe)) ?? []), ob]
    obligations.set(lc(s.safe), list)
    const required = 500_000_000n + list.filter((o) => !o.settled && !o.confirmedInflow).reduce((a, o) => a + BigInt(o.amount.raw), 0n)
    const scheduleHash = keccak256(toHex(JSON.stringify(list.map((o) => o.id))))
    appendLedger(s.safe, { kind: 'obligation', state: 'POLICY_CHANGED', summary: `Obligation added: ${ob.label}`, amount: ob.amount })
    return { obligation: ob, floorUpdate: { to: CONFIG.registry, data: encodeFunctionData({ abi: A.registry, functionName: 'setReserveFloor', args: [s.safe, required, scheduleHash] }), value: '0' } }
  }],
  ['POST', /^\/api\/obligations\/([^/]+)\/settle$/, async ({ s, match }) => {
    const ob = (obligations.get(lc(s.safe)) ?? []).find((o) => o.id === match[1])
    if (ob) ob.settled = true
    return { ok: true }
  }],
  ['GET', '/api/risk', async ({ s, url }) => {
    const safe = safeOf(s, url)
    return { vaults: await Promise.all(VAULTS.map(async (v) => {
      const shares = await read(v.address, A.vault, 'balanceOf', [safe])
      const assets = shares > 0n ? await read(v.address, A.vault, 'convertToAssets', [shares]) : 0n
      return { ...v, score: 0.12, components: { peg: 0.01, liquidity: 0.1, utilisation: 0.2, concentration: assets > 0n ? 0.4 : 0 }, triggers: [], quarantined: await reg('quarantined', [safe, v.address]), maxRedeem: amount(assets), position: amount(assets) }
    })) }
  }],
  ['GET', '/api/oracle', async () => {
    const [, answer, , updatedAt] = await read(CONFIG.priceFeed, A.feed, 'latestRoundData')
    const block = await pub.getBlock()
    const age = Number(block.timestamp - updatedAt)
    return { price: { raw: String(answer), display: (Number(answer) / 1e8).toFixed(4) }, updatedAt: Number(updatedAt), ageSeconds: age, stale: age > 180, maxOracleAge: 180 }
  }],
  ['POST', '/api/agent/chat', async ({ s, body }) => { if (s.role !== 'owner') throw new HttpError(403, 'OwnerOnly'); return chat(s, String(body.message ?? '')) }],
  ['GET', /^\/api\/requests\/([^/]+)$/, async ({ s, match }) => {
    const r = requests.get(match[1])
    if (!r || (s.role === 'owner' && lc(r.safe) !== lc(s.safe))) throw new HttpError(404, 'UnknownRequest')
    return r
  }],
  ['POST', /^\/api\/requests\/([^/]+)\/approval$/, async ({ s, match, body }) => {
    const r = requests.get(match[1])
    if (!r || r.state !== 'AWAITING_APPROVAL' || lc(r.safe) !== lc(s.safe ?? '')) throw new HttpError(409, 'NotAwaitingApproval')
    const typed = r.actionCard.approvalTypedData
    const msg = { ...typed.message, maxAmount: BigInt(typed.message.maxAmount), policyVersion: BigInt(typed.message.policyVersion), approvalExpiry: BigInt(typed.message.approvalExpiry), approvalNonce: BigInt(typed.message.approvalNonce) }
    const signer = await recoverTypedDataAddress({ domain: typed.domain, types: typed.types, primaryType: 'Approval', message: msg, signature: body.signature })
    if (lc(signer) !== lc(tenants.get(lc(r.safe)).owner)) throw new HttpError(401, 'BadSignature', 'approval is not signed by the owner')
    void executeDeposit(r, msg, body.signature)
    return { ok: true, signer }
  }],
  ['POST', /^\/api\/requests\/([^/]+)\/deny$/, async ({ match, body }) => { const r = requests.get(match[1]); if (r) move(r, 'APPROVAL_DENIED', { explanation: body.reason || 'Denied by the owner.' }); return { ok: true } }],
  ['POST', /^\/api\/requests\/([^/]+)\/correct$/, async ({ match }) => { const r = requests.get(match[1]); if (r) move(r, 'CORRECTION_REQUESTED'); return { ok: true } }],
  ['GET', '/api/approvals/pending', async ({ s }) => [...requests.values()].filter((r) => r.state === 'AWAITING_APPROVAL' && s.role === 'owner' && lc(r.safe) === lc(s.safe)).map((r) => ({ requestId: r.id, role: 'owner', safe: r.safe, actionCard: r.actionCard, createdAt: r.createdAt, expiresAt: r.createdAt + 86400 }))],
  ['GET', '/api/ledger', async ({ s, url }) => ({ rows: ledger.get(lc(safeOf(s, url))) ?? [] })],
  ['GET', '/api/events', async ({ s, url }) => {
    const safe = safeOf(s, url)
    const logs = await pub.getContractEvents({ address: [CONFIG.module, CONFIG.registry], abi: [...A.module, ...A.registry].filter((x) => x.type === 'event'), fromBlock: 0n, args: { safe } }).catch(() => [])
    return { events: logs.filter((l) => l.eventName === 'AegisExecuted' || l.eventName === 'PolicyChanged').map((l) => ({ name: l.eventName, blockNumber: Number(l.blockNumber), txHash: l.transactionHash, logIndex: l.logIndex, timestamp: now(), args: Object.fromEntries(Object.entries(l.args).map(([k, v]) => [k, typeof v === 'bigint' ? String(v) : v])) })) }
  }],
  ['GET', '/api/bank/clients', async ({ s }) => {
    if (s.role !== 'bank') throw new HttpError(403, 'BankOnly')
    return { clients: await Promise.all([...tenants.values()].filter((t) => lc(t.bank) === lc(s.address)).map(async (t) => {
      const snap = await snapshot(t.safe)
      return { safe: t.safe, name: `Treasury ${t.safe.slice(0, 6)}`, riskScore: 0.12, frozen: snap.policy.frozen, authorizerRevoked: snap.policy.authorizerRevoked, pendingEscalations: 0, mismatches: 0, total: snap.balances.total, policyVersion: snap.policy.version }
    })) }
  }],
  ['POST', '/api/tenant/attack', async ({ s, body }) => { if (s.role !== 'owner') throw new HttpError(403, 'OwnerOnly'); return attack(s, body.kind) }],
]

const PUBLIC = new Set(['/api/health', '/api/onboard/config', '/api/onboard/status', '/api/onboard/fund', '/api/onboard/activate', '/api/session', '/api/auth/nonce', '/api/auth/roles', '/api/market', '/mock/market'])

createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Aegis-Session, X-Aegis-Admin')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  if (req.method === 'OPTIONS') { res.writeHead(204).end(); return }
  const url = new URL(req.url, `http://localhost:${PORT}`)
  if (url.pathname === '/api/stream') {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' })
    const t = setInterval(() => res.write(': keep-alive\n\n'), 15000)
    req.on('close', () => clearInterval(t))
    return
  }
  const chunks = []
  for await (const c of req) chunks.push(c)
  let body = {}
  try { body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {} } catch { body = {} }
  const route = routes.find(([method, path]) => method === req.method && (typeof path === 'string' ? path === url.pathname : path.test(url.pathname)))
  try {
    if (!route) throw new HttpError(404, 'NotFound')
    const s = PUBLIC.has(url.pathname) ? null : session(req)
    const match = typeof route[1] === 'string' ? null : url.pathname.match(route[1])
    const out = await route[2]({ req, url, body, s, match })
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify(out, (_k, v) => (typeof v === 'bigint' ? v.toString() : v)))
  } catch (e) {
    const status = e instanceof HttpError ? e.status : 500
    if (!(e instanceof HttpError)) console.error(e)
    res.writeHead(status, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: e instanceof HttpError ? e.code : 'Internal', detail: e instanceof HttpError ? e.detail : String(e.shortMessage ?? e.message).split('\n')[0], ...(e.failed ? { failed: e.failed } : {}) }))
  }
}).listen(PORT, () => console.log(`[mock-api] http://localhost:${PORT} over ${RPC}`))
