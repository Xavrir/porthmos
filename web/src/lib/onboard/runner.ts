import { encodeFunctionData, getAddress, zeroAddress, type Address, type Hex, type PublicClient } from 'viem'
import { ApiError } from '../api/contract'
import { REGISTRY_ABI } from '../deployment'
import { sessionMessage } from '../session'
import { pollUntil, sleep, waitForReceipt } from './chain'
import { plainError, type Plain } from './errors'
import { onboardingMessage } from './messages'
import { createProxyCall, enableModuleCall, FACTORY_ABI, predictSafeAddress, SAFE_ABI, safeInitializer, saltNonceFor } from './safe'
import type { ActivateResult, FundResult, OnboardConfig, OnboardStatus, OnboardSteps } from './types'

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
  onboardActivate(body: { safe: Address; owner: Address; issuedAt: string; signature: Hex }): Promise<ActivateResult>
}

export type RunnerDeps = {
  config: OnboardConfig
  api: OnboardApi
  client: PublicClient
  owner: OwnerSigner
  bank: Sender
  safe?: Address | null
  onSafe(safe: Address): void
  onUpdate(steps: StepState[]): void
  now?: () => Date
}

export const TX_STEPS: StepId[] = ['module', 'register', 'vaultA', 'vaultB', 'authorizer', 'exitKey', 'autoCap', 'dailyCap', 'maxBandWidth', 'maxOracleAge']

export const STEP_LABELS: Record<StepId, string> = {
  fund: 'Test ETH for gas',
  safe: 'Create your Safe',
  module: 'Turn on the AEGIS module',
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
      id, who: ownerWho, done, batchable: call, run: async () => [await owner.send(call())],
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
          const signature = await owner.signMessage(onboardingMessage(owner.address, bank.address, c.chainId, issuedAt))
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
        run: async () => [await owner.send({ to: c.safeProxyFactory, data: createProxyCall(c.safeSingleton, safeInitializer(owner.address, c.fallbackHandler), saltNonceFor(owner.address)) })],
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
          const issuedAt = this.now()
          const signature = await owner.signMessage(sessionMessage('owner', owner.address, c.chainId, issuedAt))
          const res = await this.d.api.onboardActivate({ safe, owner: getAddress(owner.address), issuedAt, signature })
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
      hashes = await send(open.map((s) => s.batchable!()))
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
