import { describe, expect, it } from 'vitest'
import { decodeFunctionData, recoverMessageAddress, zeroAddress, type Address, type Hex, type PublicClient } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { REGISTRY_ABI } from '../deployment'
import { FACTORY_ABI, SAFE_ABI } from './safe'
import { parseSiweMessage } from 'viem/siwe'
import { OnboardRunner, type Call, type OwnerSigner, type Sender, type WalletPrompt } from './runner'
import { ACTIVATION_STATEMENT } from '../siwe'
import type { OnboardConfig, OnboardSteps } from './types'

const config: OnboardConfig = {
  chainId: 84532, rpcUrl: 'http://rpc', explorer: 'https://sepolia.basescan.org',
  safeSingleton: '0x8A791620dd6260079BF849Dc5567aDC3F2FdC318', safeProxyFactory: '0x610178dA211FEF7D417bC0e6FeD39F05609AD788',
  fallbackHandler: '0xB7f8BC63BbcaD18155201308C8f3540b07f84F5e', registry: '0xa513E6E4b8f2a923D98304ec87F64353C4D5C853',
  module: '0x2279B7A0a67DB372996a5FaB50D91eAA73d2eBe6', usdc: '0x5FbDB2315678afecb367f032d93F642f64180aa3', priceFeed: '0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512',
  vaults: [{ address: '0xCf7Ed3AccA5a467e9e704C703E8D87F634fB0Fc9', name: 'Vault A' }, { address: '0xDc64a140Aa3E981100a9becA4E685f962f0cF6C9', name: 'Vault B' }],
  operator: { authorizer: '0x90F79bf6EB2c4f870365E785982E1f101E93b906', exitKey: '0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65', executor: '0x9965507D1a55bcC2695C58ba16FB37d819B0A4dc', keeper: '0x976EA74026E726554dB657fA54763abd0C3a0aa9' },
  params: { autoCap: '1000000000', dailyCap: '5000000000', bankLimit: '3000000000', maxBandWidth: '2000000', maxOracleAge: 180, reserveFloor: '500000000', scheduleHash: `0x${'5c'.repeat(32)}` },
  paramBounds: {}, ethOwner: '50000000000000', ethBank: '20000000000000', testUsdc: '100000000000',
  referenceSafe: '0x2E1c2be3dD6BAa59344EdC6ee6A93D68e2295a0F', onboardingOpen: true,
}

const CODE = '0x6080' as Hex

function world() {
  const ownerAcct = privateKeyToAccount('0x0123456789012345678901234567890123456789012345678901234567890123')
  const bankAcct = privateKeyToAccount('0x3210987654321098765432109876543210987654321098765432109876543210')
  const s = {
    balance: new Map<string, bigint>(), code: false, module: false, owner: zeroAddress as Address, bank: zeroAddress as Address,
    allowed: new Set<string>(), authorizer: zeroAddress as Address, exitKey: zeroAddress as Address,
    autoCap: 0n, dailyCap: 0n, maxBandWidth: 0n, maxOracleAge: 0n, bankLimit: 0n, reserveFloor: 0n, scheduleHash: '0x' as Hex, activated: false, funded: false,
  }
  const log: string[] = []
  let n = 0
  const apply = (from: Address, call: Call): Hex => {
    if (call.to === config.safeProxyFactory) {
      decodeFunctionData({ abi: FACTORY_ABI, data: call.data })
      s.code = true
      log.push('createProxyWithNonce')
    } else if (call.to === config.registry) {
      const { functionName, args } = decodeFunctionData({ abi: REGISTRY_ABI, data: call.data })
      const a = args as readonly unknown[]
      log.push(`${from === bankAcct.address ? 'bank:' : ''}${functionName}`)
      if (functionName === 'register') { s.owner = a[1] as Address; s.bank = a[2] as Address }
      if (functionName === 'addVault') s.allowed.add(String(a[1]))
      if (functionName === 'setAuthorizer') s.authorizer = a[1] as Address
      if (functionName === 'setExitKey') s.exitKey = a[1] as Address
      if (functionName === 'setAutoCap') s.autoCap = a[1] as bigint
      if (functionName === 'setDailyCap') s.dailyCap = a[1] as bigint
      if (functionName === 'setMaxBandWidth') s.maxBandWidth = a[1] as bigint
      if (functionName === 'setMaxOracleAge') s.maxOracleAge = a[1] as bigint
      if (functionName === 'setBankLimit') s.bankLimit = a[1] as bigint
      if (functionName === 'setReserveFloor') { s.reserveFloor = a[1] as bigint; s.scheduleHash = a[2] as Hex }
    } else {
      const { functionName } = decodeFunctionData({ abi: SAFE_ABI, data: call.data })
      log.push(functionName)
      s.module = true
    }
    return `0x${(++n).toString(16).padStart(64, '0')}` as Hex
  }
  const reads: Record<string, (args: readonly unknown[]) => unknown> = {
    proxyCreationCode: () => CODE,
    isModuleEnabled: () => s.module,
    owner: () => s.owner,
    allowedVault: (a) => s.allowed.has(String(a[1])),
    authorizer: () => s.authorizer,
    exitKey: () => s.exitKey,
    autoCap: () => s.autoCap, dailyCap: () => s.dailyCap, maxBandWidth: () => s.maxBandWidth, maxOracleAge: () => s.maxOracleAge,
    bankLimit: () => s.bankLimit,
    reserveFloor: () => s.reserveFloor,
  }
  const client = {
    readContract: async ({ functionName, args }: { functionName: string; args?: readonly unknown[] }) => reads[functionName](args ?? []),
    getCode: async () => (s.code ? CODE : '0x'),
    getBalance: async ({ address }: { address: Address }) => s.balance.get(address) ?? 0n,
    getTransactionReceipt: async () => ({ status: 'success' }),
  } as unknown as PublicClient
  const owner: OwnerSigner = { kind: 'burner', address: ownerAcct.address, signMessage: (m) => ownerAcct.signMessage({ message: m }), send: async (c) => apply(ownerAcct.address, c) }
  const bank: Sender = { address: bankAcct.address, send: async (c) => apply(bankAcct.address, c) }
  const steps = (): OnboardSteps => ({
    funded: s.funded, safeDeployed: s.code, moduleEnabled: s.module, registered: s.owner !== zeroAddress, vaults: s.allowed.size === 2,
    authorizer: s.authorizer !== zeroAddress, exitKey: s.exitKey !== zeroAddress, caps: s.maxOracleAge > 0n, reserveFloor: s.reserveFloor >= 500_000000n, bankLimit: s.bankLimit > 0n, activated: s.activated,
  })
  const calls = { fund: [] as string[], activate: [] as string[] }
  const api = {
    onboardStatus: async () => ({ safe: null, steps: steps() }),
    onboardFund: async (b: { owner: Address; bank: Address; issuedAt: string; signature: Hex }) => {
      const signer = await recoverMessageAddress({ message: `AEGIS onboarding\nowner: ${b.owner}\nbank: ${b.bank}\nchainId: 84532\nissuedAt: ${b.issuedAt}`, signature: b.signature })
      calls.fund.push(signer)
      s.balance.set(b.owner, 10n ** 15n); s.balance.set(b.bank, 10n ** 15n); s.funded = true
      return { txs: [{ address: b.owner, hash: `0x${'aa'.repeat(32)}` as Hex, amountWei: '1' }] }
    },
    authNonce: async () => ({ nonce: `n0nce${++nonces}abcdef` }),
    onboardActivate: async (b: { safe: Address; owner: Address; message: string; signature: Hex }) => {
      const m = parseSiweMessage(b.message)
      expect(m.statement).toBe(ACTIVATION_STATEMENT)
      expect(m.resources).toEqual(['urn:porthmos:role:owner', `urn:porthmos:safe:${b.safe}`])
      expect([m.domain, m.uri, m.chainId, m.address]).toEqual(['porthmos.vercel.app', 'https://porthmos.vercel.app', 84532, b.owner])
      calls.activate.push(await recoverMessageAddress({ message: b.message, signature: b.signature }))
      s.activated = true
      return { safe: b.safe, mintTx: `0x${'bb'.repeat(32)}` as Hex, session: { token: 'tok', role: 'owner' as const, address: b.owner, safe: b.safe, expiresAt: 1 } }
    },
  }
  let nonces = 0
  let saved: Address | null = null
  const sessions: string[] = []
  const prompts: (WalletPrompt | null)[] = []
  const origin = { domain: 'porthmos.vercel.app', uri: 'https://porthmos.vercel.app' }
  const runner = (seed?: OnboardRunner['state'], o: OwnerSigner = owner) => new OnboardRunner({
    config, api, client, owner: o, bank, origin, onSafe: (a) => { saved = a }, onUpdate: () => undefined,
    onSession: (x) => sessions.push(x.token), onPrompt: (p) => prompts.push(p),
  }, seed)
  return { s, log, calls, runner, owner, saved: () => saved, sessions, prompts, apply, ownerAcct }
}

describe('OnboardRunner', () => {
  it('sends every step once, in the spec order, then activates', async () => {
    const w = world()
    const r = w.runner()
    await r.run()
    expect(w.log).toEqual([
      'createProxyWithNonce', 'execTransaction', 'register', 'addVault', 'addVault', 'setAuthorizer', 'setExitKey',
      'setAutoCap', 'setDailyCap', 'setMaxBandWidth', 'setMaxOracleAge', 'setReserveFloor', 'bank:setBankLimit',
    ])
    expect([w.s.reserveFloor, w.s.scheduleHash]).toEqual([500_000000n, config.params.scheduleHash])
    expect(w.calls.fund).toEqual([w.owner.address])
    expect(w.calls.activate).toEqual([w.owner.address])
    expect(w.saved()).toMatch(/^0x[0-9a-fA-F]{40}$/)
    expect(r.state.every((x) => x.status === 'done')).toBe(true)
    expect(r.state.find((x) => x.id === 'activate')!.hashes).toEqual([`0x${'bb'.repeat(32)}`])
    expect(w.sessions).toEqual(['tok'])
    expect(w.prompts).toEqual([])
  })

  it('explains every wallet request in plain words and batches the eleven setup calls when the wallet can', async () => {
    const w = world()
    const batches: Call[][] = []
    const wallet: OwnerSigner = {
      ...w.owner, kind: 'injected',
      sendBatch: async (calls) => { batches.push(calls); return calls.map((c) => w.apply(w.ownerAcct.address, c)) },
    }
    await w.runner(undefined, wallet).run()
    const shown = w.prompts.filter((p): p is WalletPrompt => p !== null)
    expect(shown.map((p) => p.kind)).toEqual(['sign', 'tx', 'batch', 'sign'])
    expect(w.prompts.filter((p) => p === null).length).toBe(shown.length)
    const fund = shown[0] as Extract<WalletPrompt, { kind: 'sign' }>
    expect(fund.text.startsWith('AEGIS onboarding\n')).toBe(true)
    const batch = shown[2] as Extract<WalletPrompt, { kind: 'batch' }>
    expect(batch.calls.map((c) => c.step)).toEqual(['module', 'register', 'vaultA', 'vaultB', 'authorizer', 'exitKey', 'autoCap', 'dailyCap', 'maxBandWidth', 'maxOracleAge', 'reserveFloor'])
    expect(batches.length).toBe(1)
    const act = shown[3] as Extract<WalletPrompt, { kind: 'sign' }>
    expect(act.text).toContain('wants you to sign in with your Ethereum account')
  })

  it('without batching, asks for each transaction with its number', async () => {
    const w = world()
    await w.runner(undefined, { ...w.owner, kind: 'injected' }).run()
    const txs = w.prompts.filter((p): p is Extract<WalletPrompt, { kind: 'tx' }> => p?.kind === 'tx')
    expect(txs.map((p) => p.index)).toEqual([undefined, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11])
    expect(txs.every((p) => p.why.length > 10)).toBe(true)
  })

  it('resumes: steps already on-chain are skipped, not sent again', async () => {
    const w = world()
    w.s.funded = true
    w.s.code = true
    w.s.module = true
    w.s.owner = w.owner.address
    w.s.allowed.add(config.vaults[0].address)
    await w.runner().run()
    expect(w.log).toEqual(['addVault', 'setAuthorizer', 'setExitKey', 'setAutoCap', 'setDailyCap', 'setMaxBandWidth', 'setMaxOracleAge', 'setReserveFloor', 'bank:setBankLimit'])
    expect(w.calls.fund).toEqual([])
  })

  it('does nothing when the treasury is already active', async () => {
    const w = world()
    await w.runner().run()
    w.log.length = 0
    const again = w.runner()
    await again.run()
    expect(w.log).toEqual([])
    expect(w.calls.activate.length).toBe(1)
    expect(again.state.every((x) => x.status === 'skipped')).toBe(true)
  })

  it('stops with a plain message when onboarding is closed', async () => {
    const w = world()
    const r = new OnboardRunner({ config: { ...config, onboardingOpen: false }, api: { onboardStatus: async () => ({ safe: null, steps: { funded: false, safeDeployed: false, moduleEnabled: false, registered: false, vaults: false, authorizer: false, exitKey: false, caps: false, reserveFloor: false, bankLimit: false, activated: false } }), onboardFund: async () => ({ txs: [] }), onboardActivate: async () => ({ safe: zeroAddress, mintTx: null }), authNonce: async () => ({ nonce: 'abcdefgh1' }) }, client: { readContract: async () => CODE } as unknown as PublicClient, owner: w.owner, bank: { address: zeroAddress, send: async () => '0x' }, onSafe: () => undefined, onUpdate: () => undefined })
    await expect(r.run()).rejects.toThrow(/closed/)
    expect(w.log).toEqual([])
  })
})
