import { encodeFunctionData, getAddress, zeroAddress, type Address, type Hex, type PublicClient } from 'viem'
import { ApiError } from '../api/contract'
import { REGISTRY_ABI } from '../deployment'
import { buildSiwe, pageOrigin, type AuthNonce, type SiweOrigin } from '../siwe'
import { pollUntil, sleep, waitForReceipt } from './chain'
import { plainError, type Plain } from './errors'
import { onboardingMessage } from './messages'
import { createProxyCall, enableModuleCall, FACTORY_ABI, predictSafeAddress, SAFE_ABI, safeInitializer, saltNonceFor } from './safe'
import type { ActivateResult, FundResult, OnboardConfig, OnboardStatus, OnboardSteps } from './types'

export type OwnerSession = NonNullable<ActivateResult['session']>

export type Call = { to: Address; data: Hex }

export type Sender = {
  address: Address
  send(call: Call): Promise<Hex>
}

export type OwnerSigner = Sender & {
  kind: 'burner' | 'injected'
  signMessage(message: string): Promise<Hex>
  // Atomic EIP-5792 batch; resolves to the mined transaction hashes. Absent when the wallet cannot batch atomically.
  sendBatch?(calls: Call[]): Promise<Hex[]>
}

export type StepId =
  | 'fund' | 'safe' | 'module'
  | 'register' | 'vaultA' | 'vaultB' | 'authorizer' | 'exitKey' | 'autoCap' | 'dailyCap' | 'maxBandWidth' | 'maxOracleAge'
  | 'bankLimit' | 'activate'

export type StepGroup = 'fund' | 'safe' | 'module' | 'policy' | 'bank' | 'activate'

export type StepStatus = 'idle' | 'running' | 'done' | 'skipped' | 'failed'

export type StepState = { id: StepId; group: StepGroup; label: string; status: StepStatus; hashes: Hex[]; error?: Plain; txIndex?: number }

export type OnboardApi = {
  onboardFund(body: { owner: Address; bank: Address; issuedAt: string; signature: Hex }): Promise<FundResult>
  onboardStatus(owner: Address): Promise<OnboardStatus>
  onboardActivate(body: { safe: Address; owner: Address; message: string; signature: Hex }): Promise<ActivateResult>
  authNonce(): Promise<AuthNonce>
}

// What the owner's wallet is about to ask, in plain words, shown while the wallet window is open.
export type WalletPrompt =
  | { kind: 'sign'; step: StepId; title: string; why: string; text: string }
  | { kind: 'tx'; step: StepId; title: string; why: string; to: Address; index?: number; total?: number }
  | { kind: 'batch'; title: string; why: string; calls: { step: StepId; title: string; to: Address }[] }

export type RunnerDeps = {
  config: OnboardConfig
  api: OnboardApi
  client: PublicClient
  owner: OwnerSigner
  bank: Sender
  safe?: Address | null
  onSafe(safe: Address): void
  onUpdate(steps: StepState[]): void
  onPrompt?(prompt: WalletPrompt | null): void
  onSession?(session: OwnerSession): void
  origin?: SiweOrigin
  now?: () => Date
}

export const STEP_WHY: Record<StepId, string> = {
  fund: 'Asks the Porthmos faucet for a little test ETH for gas. A signature only: it costs nothing and moves nothing.',
  safe: 'Creates your Safe smart account. You are its only owner. Test ETH pays the gas.',
  module: 'Lets the Porthmos module deposit into your allowed vaults and redeem back. It can do nothing else.',
  register: 'Writes your wallet as the owner and the browser bank key as the bank in the PolicyRegistry.',
  vaultA: 'Allows Vault A, so the agent may deposit there.',
  vaultB: 'Allows Vault B, so the agent may deposit there.',
  authorizer: 'Names the Porthmos Authorizer key that co-signs every agent action.',
  exitKey: 'Names the Porthmos exit key, which may only redeem back to your Safe.',
  autoCap: 'Sets the largest deposit the agent may make without asking you.',
  dailyCap: 'Sets the most the agent may deposit in one day.',
  maxBandWidth: 'Sets how far the price may move before deposits stop.',
  maxOracleAge: 'Sets how old the price may be before deposits stop.',
  bankLimit: 'The bank key in this browser sets the amount above which the bank must also sign.',
  activate: 'Signs you in with Ethereum (SIWE). The server checks every rule on-chain, then sends test USDC to your Safe. A signature only.',
}

export const TX_STEPS: StepId[] = ['module', 'register', 'vaultA', 'vaultB', 'authorizer', 'exitKey', 'autoCap', 'dailyCap', 'maxBandWidth', 'maxOracleAge']

export const STEP_LABELS: Record<StepId, string> = {
  fund: 'Test ETH for gas',
  safe: 'Create your Safe',
  module: 'Turn on the Porthmos module',
  register: 'Register owner and bank',
  vaultA: 'Allow Vault A',
  vaultB: 'Allow Vault B',
  authorizer: 'Set the authorizer',
  exitKey: 'Set the exit key',
  autoCap: 'Set the auto cap',
  dailyCap: 'Set the daily cap',
  maxBandWidth: 'Set the price band',
  maxOracleAge: 'Set the price age limit',
  bankLimit: 'Bank sets its limit',
  activate: 'Activate and receive test USDC',
}

const GROUP: Record<StepId, StepGroup> = {
  fund: 'fund', safe: 'safe', module: 'module',
  register: 'policy', vaultA: 'policy', vaultB: 'policy', authorizer: 'policy', exitKey: 'policy',
  autoCap: 'policy', dailyCap: 'policy', maxBandWidth: 'policy', maxOracleAge: 'policy',
  bankLimit: 'bank', activate: 'activate',
}

export const STATUS_KEY: Record<StepId, keyof OnboardSteps> = {
  fund: 'funded', safe: 'safeDeployed', module: 'moduleEnabled', register: 'registered', vaultA: 'vaults', vaultB: 'vaults',
  authorizer: 'authorizer', exitKey: 'exitKey', autoCap: 'caps', dailyCap: 'caps', maxBandWidth: 'caps', maxOracleAge: 'caps',
  bankLimit: 'bankLimit', activate: 'activated',
}

export const STEP_ORDER = Object.keys(GROUP) as StepId[]

export function initialSteps(status?: OnboardSteps | null): StepState[] {
  return STEP_ORDER.map((id) => ({
    id, group: GROUP[id], label: STEP_LABELS[id], hashes: [],
    status: status?.[STATUS_KEY[id]] ? 'skipped' : 'idle',
    txIndex: TX_STEPS.includes(id) ? TX_STEPS.indexOf(id) + 1 : undefined,
  }))
}

type Step = { id: StepId; done: () => Promise<boolean>; run: () => Promise<Hex[]>; who: string; batchable?: () => Call }

function short(a: Address) {
  return `${a.slice(0, 6)}…${a.slice(-4)}`
}

function isEstimateRevert(e: unknown): boolean {
  const m = (e as Error)?.message ?? ''
  return /execution reverted|estimateGas|gas required exceeds|could not be estimated/i.test(m) && !/insufficient funds/i.test(m)
}

export class OnboardRunner {
  private steps: StepState[]
  private pending = new Map<StepId, Hex>()
  private safe: Address | null
  private status: OnboardStatus | null = null

  constructor(private readonly d: RunnerDeps, steps?: StepState[]) {
    this.steps = steps ? steps.map((s) => ({ ...s })) : initialSteps()
    this.safe = d.safe ?? null
  }

  get state(): StepState[] {
    return this.steps
  }

  private patch(id: StepId, p: Partial<StepState>) {
    this.steps = this.steps.map((s) => (s.id === id ? { ...s, ...p } : s))
    this.d.onUpdate(this.steps)
  }

  private now() {
    return (this.d.now?.() ?? new Date()).toISOString()
  }

  // A browser key signs silently; only a wallet opens a window, so only a wallet gets the plain-words prompt.
  private async prompted<T>(prompt: WalletPrompt, ask: () => Promise<T>): Promise<T> {
    if (this.d.owner.kind !== 'injected') return ask()
    this.d.onPrompt?.(prompt)
    try {
      return await ask()
    } finally {
      this.d.onPrompt?.(null)
    }
  }

  private async refreshStatus(): Promise<OnboardStatus | null> {
    try {
      this.status = await this.d.api.onboardStatus(this.d.owner.address)
    } catch {
      this.status = null
    }
    return this.status
  }

  private read<T>(functionName: string, args: unknown[], address: Address = this.d.config.registry): Promise<T> {
    return this.d.client.readContract({ address, abi: REGISTRY_ABI, functionName, args } as never) as Promise<T>
  }

  async predictSafe(): Promise<Address> {
    if (this.safe) return this.safe
    const c = this.d.config
    const proxyCreationCode = await this.d.client.readContract({ address: c.safeProxyFactory, abi: FACTORY_ABI, functionName: 'proxyCreationCode' })
    const safe = predictSafeAddress({
      factory: c.safeProxyFactory, singleton: c.safeSingleton, proxyCreationCode,
      initializer: safeInitializer(this.d.owner.address, c.fallbackHandler), saltNonce: saltNonceFor(this.d.owner.address),
    })
    this.safe = safe
    this.d.onSafe(safe)
    return safe
  }

  private plan(safe: Address): Step[] {
    const { config: c, owner, bank, client } = this.d
    const p = c.params
    const reg = (functionName: string, args: unknown[]): Call => ({ to: c.registry, data: encodeFunctionData({ abi: REGISTRY_ABI, functionName, args } as never) })
    const ownerWho = `The owner key (${short(owner.address)})`
    const bankWho = `The bank key (${short(bank.address)})`
    const [vaultA, vaultB] = c.vaults
    const eq = (a: string, b: string) => a.toLowerCase() === b.toLowerCase()
    const ownerTx = (id: StepId, call: () => Call, done: () => Promise<boolean>): Step => ({
      id, who: ownerWho, done, batchable: call,
      run: async () => {
        const tx = call()
        const index = TX_STEPS.indexOf(id) + 1
        return [await this.prompted({ kind: 'tx', step: id, title: STEP_LABELS[id], why: STEP_WHY[id], to: tx.to, index, total: TX_STEPS.length }, () => owner.send(tx))]
      },
    })
    const capStep = (id: StepId, fn: string, value: string | number) =>
      ownerTx(id, () => reg(fn, [safe, BigInt(value)]), async () => (await this.read<bigint>(fn.replace(/^set(.)/, (_, x: string) => x.toLowerCase()), [safe])) === BigInt(value))

    return [
      {
        id: 'fund', who: ownerWho,
        done: async () => {
          if (this.status?.steps.funded) return true
          const [o, b] = await Promise.all([client.getBalance({ address: owner.address }), client.getBalance({ address: bank.address })])
          return o * 2n >= BigInt(c.ethOwner) && b * 2n >= BigInt(c.ethBank)
        },
        run: async () => {
          const issuedAt = this.now()
          const text = onboardingMessage(owner.address, bank.address, c.chainId, issuedAt)
          const signature = await this.prompted({ kind: 'sign', step: 'fund', title: STEP_LABELS.fund, why: STEP_WHY.fund, text }, () => owner.signMessage(text))
          const res = await this.d.api.onboardFund({ owner: getAddress(owner.address), bank: getAddress(bank.address), issuedAt, signature })
          return (res.txs ?? []).map((t) => t.hash)
        },
      },
      {
        id: 'safe', who: ownerWho,
        done: async () => {
          const code = await client.getCode({ address: safe })
          return !!code && code !== '0x'
        },
        run: async () => [await this.prompted({ kind: 'tx', step: 'safe', title: STEP_LABELS.safe, why: STEP_WHY.safe, to: c.safeProxyFactory },
          () => owner.send({ to: c.safeProxyFactory, data: createProxyCall(c.safeSingleton, safeInitializer(owner.address, c.fallbackHandler), saltNonceFor(owner.address)) }))],
      },
      ownerTx('module', () => ({ to: safe, data: enableModuleCall(safe, c.module, owner.address) }),
        async () => (await client.readContract({ address: safe, abi: SAFE_ABI, functionName: 'isModuleEnabled', args: [c.module] })) as boolean),
      ownerTx('register', () => reg('register', [safe, owner.address, bank.address]), async () => (await this.read<Address>('owner', [safe])) !== zeroAddress),
      ownerTx('vaultA', () => reg('addVault', [safe, vaultA.address]), () => this.read<boolean>('allowedVault', [safe, vaultA.address])),
      ownerTx('vaultB', () => reg('addVault', [safe, vaultB.address]), () => this.read<boolean>('allowedVault', [safe, vaultB.address])),
      ownerTx('authorizer', () => reg('setAuthorizer', [safe, c.operator.authorizer]), async () => eq(await this.read<Address>('authorizer', [safe]), c.operator.authorizer)),
      ownerTx('exitKey', () => reg('setExitKey', [safe, c.operator.exitKey]), async () => eq(await this.read<Address>('exitKey', [safe]), c.operator.exitKey)),
      capStep('autoCap', 'setAutoCap', p.autoCap),
      capStep('dailyCap', 'setDailyCap', p.dailyCap),
      capStep('maxBandWidth', 'setMaxBandWidth', p.maxBandWidth),
      capStep('maxOracleAge', 'setMaxOracleAge', p.maxOracleAge),
      {
        id: 'bankLimit', who: bankWho,
        done: async () => (await this.read<bigint>('bankLimit', [safe])) === BigInt(p.bankLimit),
        run: async () => [await bank.send(reg('setBankLimit', [safe, BigInt(p.bankLimit)]))],
      },
      {
        id: 'activate', who: ownerWho,
        done: async () => !!(await this.refreshStatus())?.steps.activated,
        run: async () => {
          const { nonce } = await this.d.api.authNonce()
          const message = buildSiwe({ purpose: { kind: 'activate', safe }, address: owner.address, chainId: c.chainId, nonce, origin: this.d.origin ?? pageOrigin(), now: this.d.now?.() })
          const signature = await this.prompted({ kind: 'sign', step: 'activate', title: STEP_LABELS.activate, why: STEP_WHY.activate, text: message }, () => owner.signMessage(message))
          const res = await this.d.api.onboardActivate({ safe, owner: getAddress(owner.address), message, signature })
          if (res.session) this.d.onSession?.(res.session)
          return res.mintTx ? [res.mintTx] : []
        },
      },
    ]
  }

  private async isDone(step: Step): Promise<boolean> {
    try {
      return await step.done()
    } catch {
      return false
    }
  }

  private async confirm(step: Step, hashes: Hex[]) {
    for (const h of hashes) {
      const r = await waitForReceipt(this.d.client, h)
      if (r.status !== 'success') throw Object.assign(new Error('The transaction was mined but reverted. Nothing changed.'), { hash: h })
    }
    if (step.id === 'activate') return
    await pollUntil(() => step.done())
  }

  private async exec(step: Step, firstPass: boolean): Promise<void> {
    const prev = this.pending.get(step.id)
    this.patch(step.id, { status: 'running', error: undefined })
    if (prev) {
      try {
        await this.confirm(step, [prev])
      } catch { /* dropped or reverted: decide below from the chain */ }
    }
    if (await this.isDone(step)) {
      const hadTx = !!prev || (this.steps.find((s) => s.id === step.id)?.hashes.length ?? 0) > 0
      this.patch(step.id, { status: hadTx || !firstPass ? 'done' : 'skipped' })
      return
    }
    for (let attempt = 0; ; attempt++) {
      try {
        const hashes = await step.run()
        if (hashes.length) {
          this.pending.set(step.id, hashes[hashes.length - 1])
          this.patch(step.id, { hashes: [...(this.steps.find((s) => s.id === step.id)?.hashes ?? []), ...hashes] })
        }
        if (step.id === 'fund' && !hashes.length && !(await pollUntil(() => step.done(), 4000))) {
          throw Object.assign(new Error('faucet'), { plain: { code: 'FaucetSpent', retry: true, message: `The faucet already sent test ETH to these keys once. Send a little Base Sepolia ETH to the owner (${short(this.d.owner.address)}) and the bank (${short(this.d.bank.address)}), then retry.` } })
        }
        await this.confirm(step, hashes)
        this.pending.delete(step.id)
        this.patch(step.id, { status: 'done' })
        return
      } catch (e) {
        if (attempt < 2 && isEstimateRevert(e) && !(await this.isDone(step))) {
          await sleep(1500 * (attempt + 1))
          continue
        }
        if (await this.isDone(step)) {
          this.patch(step.id, { status: 'done' })
          return
        }
        const plain = (e as { plain?: Plain }).plain ?? plainError(e, step.who)
        this.patch(step.id, { status: 'failed', error: plain })
        throw Object.assign(new Error(plain.message), { plain, step: step.id })
      }
    }
  }

  private async execBatch(steps: Step[]): Promise<boolean> {
    const send = this.d.owner.sendBatch
    if (!send) return false
    const open: Step[] = []
    for (const s of steps) if (!(await this.isDone(s))) open.push(s); else this.patch(s.id, { status: 'skipped' })
    if (!open.length) return true
    open.forEach((s) => this.patch(s.id, { status: 'running', error: undefined }))
    let hashes: Hex[]
    try {
      const calls = open.map((s) => s.batchable!())
      hashes = await this.prompted({
        kind: 'batch', title: `${calls.length} setup calls in one confirmation`,
        why: 'Your wallet can run these calls together. Either all of them happen or none does.',
        calls: open.map((s, i) => ({ step: s.id, title: STEP_LABELS[s.id], to: calls[i].to })),
      }, () => send(calls))
    } catch (e) {
      const plain = plainError(e, open[0].who)
      if (plain.code === 'Rejected') {
        open.forEach((s) => this.patch(s.id, { status: 'failed', error: plain }))
        throw Object.assign(new Error(plain.message), { plain, step: open[0].id })
      }
      open.forEach((s) => this.patch(s.id, { status: 'idle' }))
      return false
    }
    open.forEach((s) => this.patch(s.id, { hashes }))
    try {
      for (const h of hashes) {
        const r = await waitForReceipt(this.d.client, h)
        if (r.status !== 'success') throw new Error('The batch was mined but reverted. Nothing changed.')
      }
    } catch (e) {
      const plain = plainError(e, open[0].who)
      open.forEach((s) => this.patch(s.id, { status: 'failed', error: plain }))
      throw Object.assign(new Error(plain.message), { plain, step: open[0].id })
    }
    for (const s of open) {
      if (await pollUntil(() => s.done())) this.patch(s.id, { status: 'done' })
      else await this.exec(s, false)
    }
    return true
  }

  async run(): Promise<Address> {
    await this.refreshStatus()
    const safe = await this.predictSafe()
    if (this.status?.steps.activated) {
      this.steps = initialSteps(this.status.steps)
      this.d.onUpdate(this.steps)
      return safe
    }
    if (!this.d.config.onboardingOpen && !this.status?.steps.safeDeployed) {
      const plain = plainError(new ApiError('closed', 403, { error: 'OnboardingClosed' }))
      this.patch('fund', { status: 'failed', error: plain })
      throw Object.assign(new Error(plain.message), { plain, step: 'fund' })
    }
    const steps = this.plan(safe)
    const byId = (id: StepId) => steps.find((s) => s.id === id)!
    await this.exec(byId('fund'), true)
    await this.exec(byId('safe'), true)
    const batched = this.d.owner.kind === 'injected' && (await this.execBatch(TX_STEPS.map(byId)))
    if (!batched) for (const id of TX_STEPS) await this.exec(byId(id), true)
    await this.exec(byId('bankLimit'), true)
    await this.exec(byId('activate'), true)
    return safe
  }
}
