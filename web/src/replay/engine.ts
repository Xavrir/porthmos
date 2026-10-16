import { encodeFunctionData, keccak256, parseAbi, toHex, type Address, type Hex } from 'viem'
import { ApiError, REPLAY_SIMULATED_SIGNATURE, type AegisApi, type ApprovalSubmission, type BankAction, type NewObligation, type StreamStatus } from '../lib/api/contract'
import { recoverSigner, typedDataFor } from '../lib/eip712'
import { amount, day, fromUnits, money, toUnits } from '../lib/format'
import { requiredTier, reserveRequired, TRIGGERS } from '../lib/policy'
import { reconcile } from '../lib/reconcile'
import type {
  ActionCard, BankClient, ChainEvent, ChatResponse, ErrorName, Health, LedgerRow, Obligation, ObligationCreated, OracleState,
  PendingApproval, ReconciliationRow, RequestRecord, RiskReport, Role, ScenarioName, Session, SignedRecord, StreamEvent, Tier,
  TreasuryState, VaultRisk, WorkflowState,
} from '../lib/types'
import { builder, buildBaseModel, DEMO_CLIENT, depositCard, recorded, type RecordedId } from './fixtures'
import { D, EPOCH, blockAt, type Model, type VaultKey } from './model'
import { recordedSlot } from './hashes'
import { REPLAY_APPROVAL_SIGNATURES } from './recorded'

const REGISTRY_ABI = parseAbi(['function setReserveFloor(address safe, uint256 floor, bytes32 scheduleHash)'])
const STATE_KEY = 'aegis.replay-state'
const STATE_VERSION = 2

type Saved = { v: number; model: Model; elapsed: number; seq: number }
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))
const lower = (a: string) => a.toLowerCase()

export class ReplayApi implements AegisApi {
  readonly mode = 'replay' as const
  private model: Model = this.freshModel()
  private startedAt = Date.now()
  private base = { rows: this.model.ledger.length, requests: Object.keys(this.model.requests).length }
  private saveTimer: ReturnType<typeof setTimeout> | null = null
  private token: string | null = null
  private sessions = new Map<string, Session>()
  private listeners = new Set<(e: StreamEvent) => void>()
  private ticker: ReturnType<typeof setInterval> | null = null
  private lastPoke = 0
  private seq = 0
  private busy = false

  constructor() {
    this.restore()
  }

  private restore() {
    try {
      const raw = sessionStorage.getItem(STATE_KEY)
      if (!raw) return
      const saved = JSON.parse(raw) as Saved
      if (saved.v !== STATE_VERSION || !saved.model?.requests) return
      this.model = saved.model
      this.startedAt = Date.now() - saved.elapsed * 1000
      this.seq = saved.seq
    } catch {
      /* unreadable or blocked storage: start from the recorded base run */
    }
  }

  private save() {
    if (this.saveTimer) return
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null
      try {
        const saved: Saved = { v: STATE_VERSION, model: this.model, elapsed: (Date.now() - this.startedAt) / 1000, seq: this.seq }
        sessionStorage.setItem(STATE_KEY, JSON.stringify(saved))
      } catch {
        /* storage full or blocked: the run still works for this page */
      }
    }, 120)
  }

  isChanged(): boolean {
    const m = this.model
    return m.ledger.length !== this.base.rows || Object.keys(m.requests).length !== this.base.requests || m.oracle.price !== 1.0001 || !!m.oracle.keeperStoppedAt
  }

  reset() {
    this.model = this.freshModel()
    this.startedAt = Date.now()
    try { sessionStorage.removeItem(STATE_KEY) } catch { /* nothing stored */ }
    this.emitState()
    this.emit({ type: 'policy', data: { version: this.model.policy.version, frozen: { ...this.model.policy.frozen } } })
    this.emit({ type: 'notice', data: { level: 'info', text: 'Demo reset to the recorded base run.' } })
  }

  private freshModel(): Model {
    const m = buildBaseModel()
    const pending = m.requests['req-d2-b']
    if (pending?.actionCard) {
      pending.actionCard.policyChecks = [
        { name: 'reserveFloor', ok: true, detail: 'Safe keeps 4,550.36 against a 4,500.00 floor' },
        { name: 'dailyCap', ok: true, detail: '2,250.00 of 5,000.00 today' },
        { name: 'vaultAllowed', ok: true, detail: 'Vault B was added by the owner' },
        { name: 'notQuarantined', ok: true, detail: 'No risk trigger' },
        { name: 'notFrozen', ok: true, detail: 'No freeze' },
        { name: 'oracleFresh', ok: true, detail: 'Price 1.0001, under 60 s old (limit 180 s)' },
        { name: 'priceBand', ok: true, detail: 'Signed band 0.9990 to 1.0010, width within 0.0200' },
      ]
    }
    return m
  }

  now(): number {
    return Math.floor(EPOCH + (Date.now() - this.startedAt) / 1000)
  }

  setSession(token: string | null) {
    this.token = token
  }

  private role(): Role | null {
    return (this.token && this.sessions.get(this.token)?.role) || null
  }

  private emit(e: StreamEvent) {
    this.save()
    for (const l of this.listeners) l(e)
  }

  private emitState() {
    this.emit({ type: 'treasury', data: this.treasurySync() })
    this.emit({ type: 'risk', data: this.riskSync() })
    this.emit({ type: 'oracle', data: this.oracleSync() })
  }

  async health(): Promise<Health> {
    return { ok: true, chainId: D.chainId, mode: 'replay', llm: 'deterministic', demo: true, version: 'replay-fixtures' }
  }

  async createSession(role: Role, address: Address): Promise<Session> {
    const expected = role === 'owner' ? D.roles.owner : D.roles.bank
    if (lower(address) !== lower(expected)) {
      throw new ApiError(`${address} is not the registry ${role} for this Safe (${expected}).`, 403)
    }
    const token = `replay-${role}-${++this.seq}`
    const s: Session = { token, role, safe: role === 'owner' ? (D.safe as Address) : undefined }
    this.sessions.set(token, s)
    return s
  }

  private oracleUpdatedAt(now = this.now()): number {
    const o = this.model.oracle
    if (o.keeperStoppedAt && o.frozenUpdatedAt) return o.frozenUpdatedAt
    return now - ((now - EPOCH + 26) % TRIGGERS.heartbeatSeconds)
  }

  private extendHistory() {
    const h = this.model.oracle.history
    const updatedAt = this.oracleUpdatedAt()
    const last = h[h.length - 1]
    if (!this.model.oracle.keeperStoppedAt && updatedAt > last.t) {
      const drift = this.model.oracle.price === 1.0001 ? ((updatedAt % 7) - 3) * 0.00004 : 0
      h.push({ t: updatedAt, price: this.model.oracle.price + drift })
      if (h.length > 240) h.shift()
      return true
    }
    return false
  }

  private oracleSync(): OracleState {
    this.extendHistory()
    const now = this.now()
    const updatedAt = this.oracleUpdatedAt(now)
    const age = now - updatedAt
    const p = this.model.oracle.history[this.model.oracle.history.length - 1]?.price ?? this.model.oracle.price
    return {
      price: { raw: toUnits(p, 8).toString(), display: p.toFixed(4) },
      updatedAt,
      ageSeconds: age,
      stale: age > this.model.policy.maxOracleAge,
      maxOracleAge: this.model.policy.maxOracleAge,
      history: this.model.oracle.history.slice(-90),
    }
  }

  private vaultAssets(k: VaultKey) {
    const v = this.model.vaults[k]
    return Math.round(v.shares * v.sharePrice * 100) / 100
  }

  private required() {
    const r = reserveRequired(this.model.obligations.filter((o) => !o.settled).map((o) => ({ amount: fromUnits(o.amount.raw), due: Date.parse(o.dueDate), inflow: o.confirmedInflow })))
    return { ...r, required: Math.round(r.required * 100) / 100 }
  }

  private scheduleHash(): Hex {
    return keccak256(toHex(JSON.stringify(this.model.obligations.filter((o) => !o.settled).map((o) => [o.label, o.amount.raw, o.dueDate, !!o.confirmedInflow]))))
  }

  private treasurySync(): TreasuryState {
    const m = this.model
    const a = this.vaultAssets('A')
    const b = this.vaultAssets('B')
    const total = m.safeUsdc + a + b
    const req = this.required()
    const withdrawable = Math.min(a, m.vaults.A.maxRedeemCap) + Math.min(b, m.vaults.B.maxRedeemCap)
    const deployable = Math.max(0, m.safeUsdc + withdrawable - Math.max(m.floor, req.required) - m.fees)
    return {
      safe: D.safe as Address,
      balances: {
        safeUsdc: amount(m.safeUsdc),
        total: amount(total),
        vaults: (['A', 'B'] as VaultKey[]).map((k) => {
          const v = m.vaults[k]
          return { address: v.address, name: v.name, shares: amount(v.shares), assets: amount(this.vaultAssets(k)), everDeposited: v.everDeposited, quarantined: v.quarantined, allowed: v.allowed }
        }),
      },
      reserve: { required: amount(req.required), onchainFloor: amount(m.floor), inSync: m.floor >= req.required, scheduleHash: this.scheduleHash(), buffer: amount(req.buffer) },
      deployable: amount(deployable),
      fees: amount(m.fees),
      depositedToday: amount(m.depositedToday),
      policy: {
        autoCap: amount(m.policy.autoCap), dailyCap: amount(m.policy.dailyCap), bankLimit: amount(m.policy.bankLimit),
        frozen: { ...m.policy.frozen }, version: m.policy.version, maxBandWidth: '2000000', maxOracleAge: m.policy.maxOracleAge,
        authorizerRevoked: m.policy.authorizerRevoked,
      },
      updatedAt: this.now(),
    }
  }

  private riskSync(): RiskReport {
    const m = this.model
    const o = this.oracleSync()
    const price = Number(o.price.display)
    const dev = Math.abs(price - 1)
    const a = this.vaultAssets('A')
    const b = this.vaultAssets('B')
    const deployed = a + b
    const vaults: VaultRisk[] = (['A', 'B'] as VaultKey[]).map((k) => {
      const v = m.vaults[k]
      const pos = k === 'A' ? a : b
      const peg = Math.min(1, dev / 0.02)
      const liquidity = pos > 0 ? Math.min(1, (pos * TRIGGERS.liquidityMultiple) / Math.max(1, v.maxRedeemCap)) : 0.02
      const concentration = deployed > 0 ? pos / deployed : 0
      const score = 0.4 * peg + 0.3 * liquidity + 0.2 * v.utilisation + 0.1 * concentration
      const triggers: string[] = []
      if (dev > TRIGGERS.pegDeviation) triggers.push(`Peg ${price.toFixed(4)} is ${(dev * 100).toFixed(2)}% from 1.0000 (limit 1.00%)`)
      if (o.stale) triggers.push(`Price is ${o.ageSeconds} s old (limit ${TRIGGERS.maxOracleAge} s)`)
      if (pos > 0 && v.maxRedeemCap < TRIGGERS.liquidityMultiple * pos) triggers.push(`Withdrawable ${money(v.maxRedeemCap)} is below 1.2 × position ${money(TRIGGERS.liquidityMultiple * pos)}`)
      return {
        address: v.address, name: v.name, score: Math.round(score * 1000) / 1000,
        components: { peg: round3(peg), liquidity: round3(liquidity), utilisation: v.utilisation, concentration: round3(concentration) },
        triggers, quarantined: v.quarantined, quarantinedAt: v.quarantinedAt, maxRedeem: amount(Math.min(pos, v.maxRedeemCap)), position: amount(pos),
      }
    })
    return { vaults, updatedAt: this.now() }
  }

  async treasury() { return this.treasurySync() }
  async risk() { return this.riskSync() }
  async oracle() { return this.oracleSync() }

  async obligations(): Promise<Obligation[]> {
    return this.model.obligations.map((o) => ({ ...o }))
  }

  async addObligation(input: NewObligation): Promise<ObligationCreated> {
    const value = Number(input.amount)
    if (!input.label.trim() || !(value > 0) || !input.dueDate) throw new ApiError('Label, a positive amount and a due date are required.', 422)
    const ob: Obligation = { id: `obl-${++this.seq}`, label: input.label.trim(), amount: amount(value), dueDate: input.dueDate, confirmedInflow: !!input.confirmedInflow }
    this.model.obligations.push(ob)
    const { row } = builder(this.model)
    const req = this.required()
    this.emit({ type: 'ledger', data: row({ ts: this.now(), kind: 'obligation', state: 'EXPLAINED', summary: `${input.confirmedInflow ? 'Confirmed inflow' : 'Obligation'} added: ${ob.label}, ${ob.amount.display} due ${day(ob.dueDate)}. Required reserve now ${money(req.required)}.` }) })
    this.holdIfFloorOutOfSync()
    this.emitState()
    return { obligation: ob, floorUpdate: this.floorTx() }
  }

  private floorTx() {
    const req = this.required()
    return {
      to: D.registry as Address,
      data: encodeFunctionData({ abi: REGISTRY_ABI, functionName: 'setReserveFloor', args: [D.safe as Address, toUnits(req.required), this.scheduleHash()] }),
      value: '0',
    }
  }

  async settleObligation(id: string) {
    const ob = this.model.obligations.find((o) => o.id === id)
    if (!ob) throw new ApiError('No such obligation', 404)
    ob.settled = true
    const { row } = builder(this.model)
    this.emit({ type: 'ledger', data: row({ ts: this.now(), kind: 'obligation', state: 'EXPLAINED', summary: `Obligation settled: ${ob.label}, ${ob.amount.display}. Required reserve now ${money(this.required().required)}.` }) })
    this.emitState()
    return { obligation: ob, floorUpdate: this.floorTx() }
  }

  private holdIfFloorOutOfSync() {
    if (this.model.floor >= this.required().required) return
    for (const r of Object.values(this.model.requests)) {
      if (r.state === 'AWAITING_APPROVAL' && r.actionCard?.op === 'DEPOSIT') {
        this.transition(r, 'STATE_LOADED', 'Obligation schedule changed')
        this.transition(r, 'HELD', 'FloorOutOfSync: the on-chain floor is below the new required reserve')
      }
    }
    this.emit({ type: 'notice', data: { level: 'alert', text: `Floor out of sync. The owner must sign setReserveFloor(${money(this.required().required)}) before the agent acts.` } })
  }

  async simulateFloorUpdate(actor: Address) {
    if (lower(actor) !== lower(D.roles.owner)) throw new ApiError('Only the owner can set the reserve floor (role matrix).', 403)
    const b = builder(this.model)
    const req = this.required()
    this.model.floor = Math.round(req.required * 100) / 100
    const e3Floor = recordedSlot('e3-floor')
    b.policy(this.now(), 'setReserveFloor', actor, `Owner signed reserve floor ${money(this.model.floor)}`, e3Floor?.amount === this.model.floor ? 'e3-floor' : undefined)
    this.emitLast(b)
    this.emitState()
    await this.coverFloor()
  }

  private emitLast(b: ReturnType<typeof builder>) {
    void b
    const row = this.model.ledger[this.model.ledger.length - 1]
    const ev = this.model.events[this.model.events.length - 1]
    if (row) this.emit({ type: 'ledger', data: row })
    if (ev && row && ev.timestamp === row.ts) this.emit({ type: 'execution', data: ev })
    this.emit({ type: 'policy', data: { version: this.model.policy.version, frozen: { ...this.model.policy.frozen } } })
  }

  private async coverFloor() {
    const m = this.model
    const need = m.floor + m.fees - m.safeUsdc
    for (const r of Object.values(m.requests)) {
      if ((r.state === 'HELD' || r.state === 'AWAITING_APPROVAL') && r.actionCard?.op === 'DEPOSIT') {
        this.transition(r, 'CANCELLED', 'No longer fits above the new reserve floor')
        this.dropPending(r.id)
        const { row } = builder(m)
        this.emit({ type: 'ledger', data: row({ ts: this.now(), requestId: r.id, kind: 'cancel', state: 'CANCELLED', summary: `Pending deposit of ${r.actionCard.amount.display} into ${r.actionCard.vault.name} cancelled: it no longer fits above the floor.` }) })
      }
    }
    if (need <= 0) {
      this.emit({ type: 'notice', data: { level: 'info', text: 'The Safe already covers the new floor. No redemption needed.' } })
      return
    }
    const why = `Cover the new reserve floor of ${money(m.floor)}`
    const e3 = recordedSlot('e3-redeem-b')
    const legs: { k: VaultKey; assets: number; slot?: string }[] = []
    let left = Math.round(need * 100) / 100
    if (e3?.amount && left >= e3.amount && this.vaultAssets('B') >= e3.amount && recordedSlot('e3-floor')?.amount === m.floor) {
      legs.push({ k: 'B', assets: e3.amount, slot: 'e3-redeem-b' })
      left = Math.round((left - e3.amount) * 100) / 100
    }
    for (const k of ['A', 'B'] as VaultKey[]) {
      if (left <= 0) break
      const take = Math.min(this.vaultAssets(k), left)
      if (take <= 0) continue
      legs.push({ k, assets: take })
      left = Math.round((left - take) * 100) / 100
    }
    for (const leg of legs) {
      const shares = Math.round((leg.assets / m.vaults[leg.k].sharePrice) * 100) / 100
      await wait(900)
      await this.runRedeem(leg.k, shares, 'authorizer', why, leg.slot ? 'dar-obl-b' : undefined, leg.slot, leg.assets)
    }
  }

  private dropPending(id: string) {
    this.model.pending = this.model.pending.filter((p) => p.requestId !== id)
  }

  private transition(r: RequestRecord, state: WorkflowState, note?: string) {
    r.state = state
    r.history.push({ state, at: this.now(), note })
    this.emit({ type: 'state', data: { requestId: r.id, state, note } })
  }

  private newRequest(message: string, origin: RequestRecord['origin']): RequestRecord {
    const id = `req-${(this.now() % 100000).toString(36)}-${++this.seq}`
    const r: RequestRecord = { id, createdAt: this.now(), message, origin, state: 'REQUEST_RECEIVED', history: [{ state: 'REQUEST_RECEIVED', at: this.now() }] }
    this.model.requests[id] = r
    return r
  }

  private unsignedDar(fields: Record<string, string | number>): SignedRecord {
    return { primaryType: 'DAR', message: fields, signature: null, signer: null, replayUnsigned: true }
  }

  private async runRedeem(k: VaultKey, shares: number, signer: 'authorizer' | 'exitKey', why: string, rec?: RecordedId, slot?: string, exactAssets?: number) {
    const m = this.model
    const v = m.vaults[k]
    const r = this.newRequest(`${signer === 'exitKey' ? 'Exit Agent' : 'Agent'}: ${why}`, signer === 'exitKey' ? 'exit_agent' : 'owner')
    const assets = exactAssets ?? Math.round(shares * v.sharePrice * 100) / 100
    const minOut = Math.floor(assets * (1 - TRIGGERS.exitSlippage) * 100) / 100
    r.actionCard = {
      requestId: r.id, op: 'REDEEM', vault: { address: v.address, name: v.name }, amount: amount(shares), tier: 1,
      requiredSigners: [signer === 'exitKey' ? 'exitKey' : 'authorizer'], reason: why, reserveAfter: amount(m.safeUsdc + assets),
      simulation: { ok: true, assetsOut: amount(assets) },
      policyChecks: [
        { name: 'Receiver is the Safe', ok: true, detail: 'Redeem(shares, receiver = Safe, owner = Safe)' },
        { name: 'Position exists', ok: true, detail: `${money(v.shares)} shares held` },
        { name: 'Minimum out', ok: true, detail: `${money(minOut)} (0.5% below preview)` },
      ],
    }
    r.dar = rec ? recorded(rec) : this.unsignedDar({ safe: D.safe, op: 1, vault: v.address, amount: toUnits(shares).toString(), minOut: toUnits(minOut).toString(), tier: 1 })
    this.transition(r, 'SIMULATED', `Preview ${money(assets)}`)
    await wait(600)
    this.transition(r, 'DAR_SIGNED', signer === 'exitKey' ? 'Signed by the exit key (redeem only)' : 'Signed by the authorizer')
    await wait(700)
    this.transition(r, 'SUBMITTED', 'Executor submitted')
    await wait(1100)
    v.shares = Math.max(0, Math.round((v.shares - shares) * 100) / 100)
    m.safeUsdc = Math.round((m.safeUsdc + assets) * 100) / 100
    const rec3 = slot ? recordedSlot(slot) : undefined
    const h = rec3?.hash
    r.txHash = h
    const b = builder(m)
    const ev = b.event({ name: 'AegisExecuted', txHash: h, timestamp: this.now(), args: { safe: D.safe, darHash: r.dar.digest ?? keccak256(toHex(r.id)), op: 1, vault: v.address, assets: toUnits(assets).toString(), shares: toUnits(shares).toString(), tier: 1, evidenceHash: keccak256(toHex('ev-' + r.id)) } }, rec3?.block ?? blockAt(this.now()))
    const row = b.row({ ts: this.now(), requestId: r.id, kind: 'execution', state: 'CONFIRMED', op: 'REDEEM', vault: v.name, amount: amount(assets), tier: 1, txHash: h, summary: `${signer === 'exitKey' ? 'Exit Agent redeemed' : 'Redeemed'} ${money(shares)} shares of ${v.name} for ${money(assets)}: ${why}` })
    this.transition(r, 'CONFIRMED', `Received ${money(assets)} (minimum ${money(minOut)})`)
    if (ev) this.emit({ type: 'execution', data: ev })
    this.emit({ type: 'ledger', data: row })
    this.emitState()
    await wait(300)
    r.explanation = `Redeemed ${money(shares)} shares of ${v.name} back to the Safe for ${money(assets)}.`
    this.transition(r, 'EXPLAINED')
  }

  async chat(message: string): Promise<ChatResponse> {
    if (this.role() !== 'owner') throw new ApiError('Chat is bound to the owner’s Safe. Switch to the owner seat to ask the agent.', 403)
    const text = message.trim()
    const r = this.newRequest(text, 'owner')
    await wait(350)
    const m = this.model
    const t = this.treasurySync()
    const lowerText = text.toLowerCase()
    const address = text.match(/0x[0-9a-fA-F]{6,40}/)?.[0]

    if (address || /\b(send|transfer|wire|pay out|move all .* to)\b/i.test(text)) {
      this.transition(r, 'INTENT_PARSED', 'Transfer to an outside address requested')
      this.transition(r, 'POLICY_REJECTED', 'No typed action can express a transfer')
      const { row } = builder(m)
      this.emit({ type: 'ledger', data: row({ ts: this.now(), requestId: r.id, kind: 'injection', state: 'POLICY_REJECTED', summary: `Chat asked for a transfer${address ? ` to ${address.slice(0, 6)}…${address.slice(-4)}` : ''}. Not representable; nothing was signed.` }) })
      r.explanation = 'I can only deposit into vaults you added, or redeem back to the Safe. A transfer to any other address cannot be written as an action, so there is nothing to plan, sign or submit. I logged the request.'
      this.transition(r, 'EXPLAINED')
      return { reply: r.explanation, requestId: r.id, state: 'POLICY_REJECTED' }
    }

    if (/\b(why|explain)\b/.test(lowerText)) {
      const last = Object.values(m.requests).filter((q) => q.id !== r.id && q.explanation).sort((a, b) => b.createdAt - a.createdAt)[0]
      r.explanation = last ? `About “${last.message}”: ${last.explanation}` : 'Nothing to explain yet.'
      this.transition(r, 'EXPLAINED')
      return { reply: r.explanation, requestId: r.id, state: 'EXPLAINED' }
    }

    if (/\b(hold|wait|pause|do nothing)\b/.test(lowerText)) {
      this.transition(r, 'INTENT_PARSED')
      this.transition(r, 'HELD', 'Owner asked to hold')
      const { row } = builder(m)
      this.emit({ type: 'ledger', data: row({ ts: this.now(), requestId: r.id, kind: 'hold', state: 'HELD', summary: 'Owner asked the agent to hold. No action planned.' }) })
      r.explanation = 'Holding. Nothing will be planned until you ask again. Exits on risk triggers still run.'
      this.transition(r, 'EXPLAINED')
      return { reply: r.explanation, requestId: r.id, state: 'HELD' }
    }

    const vaultKey: VaultKey | null = /\bvault\s*a\b|\ba\b vault/i.test(text) ? 'A' : /\bvault\s*b\b/i.test(text) ? 'B' : null
    const figure = Number((text.match(/(\d[\d,]*(?:\.\d+)?)/)?.[1] ?? '').replace(/,/g, ''))

    if (/\b(exit|redeem|withdraw|pull out|take out)\b/.test(lowerText)) {
      const k = vaultKey ?? (this.vaultAssets('B') >= this.vaultAssets('A') ? 'B' : 'A')
      const v = m.vaults[k]
      if (v.shares <= 0) {
        r.explanation = `The Safe holds no shares in ${v.name}; nothing to redeem.`
        this.transition(r, 'HELD', 'NoPosition')
        this.transition(r, 'EXPLAINED')
        return { reply: r.explanation, requestId: r.id, state: 'HELD' }
      }
      const shares = figure > 0 ? Math.min(v.shares, Math.round((figure / v.sharePrice) * 100) / 100) : v.shares
      this.transition(r, 'INTENT_PARSED', `Redeem from ${v.name}`)
      this.transition(r, 'POLICY_CHECKED', 'Redemptions to the Safe are tier 1')
      r.explanation = `Redeeming ${money(shares)} shares of ${v.name} back to the Safe. Tier 1: the authorizer signs alone, and it would run even under a freeze.`
      this.transition(r, 'EXPLAINED')
      void this.runRedeem(k, shares, 'authorizer', `Owner asked to redeem from ${v.name}`)
      return { reply: r.explanation, requestId: r.id, state: 'POLICY_CHECKED' }
    }

    if (/\b(deposit|invest|put|deploy|allocate|work|earn|top up)\b/.test(lowerText)) {
      this.transition(r, 'INTENT_PARSED', 'Deploy surplus')
      this.transition(r, 'STATE_LOADED')
      this.transition(r, 'RISK_EVALUATED')
      const idle = Math.floor((m.safeUsdc - m.floor - m.fees) * 100) / 100
      const pending = Object.values(m.requests).find((q) => q.state === 'AWAITING_APPROVAL')
      if (!t.reserve.inSync) {
        this.transition(r, 'HELD', 'FloorOutOfSync')
        r.explanation = `The schedule needs a reserve of ${t.reserve.required.display}, but the on-chain floor is ${t.reserve.onchainFloor.display}. Sign the floor update on the Treasury page first; until then I hold.`
        this.transition(r, 'EXPLAINED')
        return { reply: r.explanation, requestId: r.id, state: 'HELD' }
      }
      const amountWanted = figure > 0 ? figure : idle
      if (idle <= 0 || amountWanted <= 0) {
        this.transition(r, 'HELD', 'Nothing above the floor')
        r.explanation = `Nothing to deploy: the Safe holds ${t.balances.safeUsdc.display} against a ${t.reserve.onchainFloor.display} floor plus ${money(m.fees)} kept for fees.${pending ? ` One deposit of ${pending.actionCard?.amount.display} into ${pending.actionCard?.vault.name} is already waiting for your approval.` : ''}`
        this.transition(r, 'EXPLAINED')
        return { reply: r.explanation, requestId: r.id, state: 'HELD' }
      }
      const open = (['A', 'B'] as VaultKey[]).filter((k) => !m.vaults[k].quarantined)
      const k = vaultKey && !m.vaults[vaultKey].quarantined ? vaultKey : open.sort((x, y) => this.vaultAssets(x) - this.vaultAssets(y))[0]
      if (!k) {
        this.transition(r, 'HELD', 'All vaults quarantined')
        r.explanation = 'Both vaults are quarantined after a risk trigger. Deposits are refused on-chain until the owner clears quarantine after 24 hours.'
        this.transition(r, 'EXPLAINED')
        return { reply: r.explanation, requestId: r.id, state: 'HELD' }
      }
      const value = Math.round(amountWanted * 100) / 100
      this.transition(r, 'PLAN_OPTIONS_BUILT', `Idle above floor: ${money(idle)}`)
      this.transition(r, 'OPTION_SELECTED', value > idle ? 'Above the default option: escalated to tier 3' : 'At or below the default option')
      this.transition(r, 'PROPOSAL_VALIDATED')
      return this.buildDeposit(r, k, value, value > idle)
    }

    if (/\b(reserve|balance|status|how much|position|report|cash|floor)\b/.test(lowerText)) {
      const lines = [
        `The treasury holds ${t.balances.total.display} USDC: ${t.balances.safeUsdc.display} in the Safe, ${t.balances.vaults.map((v) => `${v.assets.display} in ${v.name}`).join(' and ')}.`,
        `The reserve for upcoming obligations is ${t.reserve.required.display}; the on-chain floor is ${t.reserve.onchainFloor.display}${t.reserve.inSync ? ', in sync' : ', out of sync'}.`,
        `Deployable after reserve and fees: ${t.deployable.display}. Policy v${t.policy.version}; ${t.policy.frozen.bank || t.policy.frozen.owner ? 'deposits are frozen' : 'not frozen'}.`,
      ]
      r.explanation = lines.join(' ')
      this.transition(r, 'EXPLAINED', 'Tier 0: read only')
      return { reply: r.explanation, requestId: r.id, state: 'EXPLAINED' }
    }

    this.transition(r, 'NEEDS_CLARIFICATION')
    r.explanation = 'Do you want a report, to deploy surplus above the reserve, to exit a vault, or to hold? You can name a vault and an amount.'
    return { reply: r.explanation, requestId: r.id, state: 'NEEDS_CLARIFICATION' }
  }

  private policyChecks(k: VaultKey, value: number): ActionCard['policyChecks'] {
    const m = this.model
    const o = this.oracleSync()
    const safeAfter = m.safeUsdc - value
    return [
      { name: 'reserveFloor', ok: safeAfter >= m.floor, detail: `Safe keeps ${money(safeAfter)} against a ${money(m.floor)} floor` },
      { name: 'dailyCap', ok: m.depositedToday + value <= m.policy.dailyCap, detail: `${money(m.depositedToday + value)} of ${money(m.policy.dailyCap)} today` },
      { name: 'vaultAllowed', ok: m.vaults[k].allowed, detail: `${m.vaults[k].name} was added by the owner` },
      { name: 'notQuarantined', ok: !m.vaults[k].quarantined, detail: m.vaults[k].quarantined ? 'Quarantined' : 'No risk trigger' },
      { name: 'notFrozen', ok: !m.policy.frozen.owner && !m.policy.frozen.bank, detail: m.policy.frozen.bank ? 'Bank freeze in force' : m.policy.frozen.owner ? 'Owner freeze in force' : 'No freeze' },
      { name: 'oracleFresh', ok: !o.stale, detail: `Price ${o.price.display}, ${o.ageSeconds} s old (limit ${m.policy.maxOracleAge} s)` },
      { name: 'priceBand', ok: Math.abs(Number(o.price.display) - 1) <= 0.001, detail: 'Signed band 0.9990 to 1.0010, width within 0.0200' },
    ]
  }

  private firstFailure(checks: ActionCard['policyChecks']): ErrorName | null {
    const map: Record<string, ErrorName> = { reserveFloor: 'ReserveFloorBreached', dailyCap: 'DailyCapExceeded', vaultAllowed: 'VaultNotAllowed', notQuarantined: 'VaultQuarantined', notFrozen: 'Frozen', oracleFresh: 'StaleOracle', priceBand: 'PriceOutOfBand' }
    const order = ['notFrozen', 'notQuarantined', 'vaultAllowed', 'oracleFresh', 'priceBand', 'reserveFloor', 'dailyCap']
    for (const name of order) if (!checks.find((c) => c.name === name)?.ok) return map[name]
    return null
  }

  private async buildDeposit(r: RequestRecord, k: VaultKey, value: number, aboveDefault: boolean): Promise<ChatResponse> {
    const m = this.model
    const v = m.vaults[k]
    let tier: Tier = requiredTier(value, this.treasurySync().policy, { ...this.treasurySync().balances.vaults.find((x) => x.address === v.address)!, everDeposited: v.everDeposited })
    if (aboveDefault && tier < 3) tier = 3
    const checks = this.policyChecks(k, value)
    const fail = this.firstFailure(checks)
    const now = this.now()
    const approval: SignedRecord | undefined = tier >= 3 ? {
      primaryType: 'Approval', signature: null, signer: null,
      message: { safe: D.safe, op: 0, vault: v.address, maxAmount: toUnits(value).toString(), policyVersion: m.policy.version, approvalExpiry: now + 86400, approvalNonce: BigInt(keccak256(toHex(`${r.id}-${now}`))).toString() },
    } : undefined
    const card = depositCard({
      requestId: r.id, vault: k, amount: value, tier, reserveAfter: m.safeUsdc - value, sharesOut: Math.round((value / v.sharePrice) * 100) / 100, error: fail ?? undefined, approval,
      reason: tier === 4 ? `${money(value)} is above the ${money(m.policy.bankLimit)} bank limit: owner and bank must approve.` : tier === 3 ? (aboveDefault ? 'Above the default option, so it escalates to your approval.' : !v.everDeposited ? `First deposit into ${v.name}: your approval is required.` : `${money(value)} is above the ${money(m.policy.autoCap)} auto cap: your approval is required.`) : `Within the ${money(m.policy.autoCap)} auto cap into a vault used before: the agent can act alone.`,
    })
    card.policyChecks = checks
    r.actionCard = card
    r.approvals = approval ? [approval] : []
    if (fail) {
      this.transition(r, 'POLICY_CHECKED', `Would revert ${fail}`)
      this.transition(r, 'POLICY_REJECTED', fail)
      const { row } = builder(m)
      this.emit({ type: 'ledger', data: row({ ts: this.now(), requestId: r.id, kind: 'rejection', state: 'POLICY_REJECTED', op: 'DEPOSIT', vault: v.name, amount: amount(value), tier, revertReason: fail, summary: `Deposit ${money(value)} into ${v.name} stopped before signing: it would revert ${fail}.` }) })
      r.explanation = `I did not sign this. The contract would revert ${fail}: ${checks.find((c) => !c.ok)?.detail}.`
      this.transition(r, 'EXPLAINED')
      return { reply: r.explanation, requestId: r.id, state: 'POLICY_REJECTED', actionCard: card }
    }
    this.transition(r, 'POLICY_CHECKED', `Tier ${tier}`)
    this.transition(r, 'SIMULATED', `Expect ${card.simulation.sharesOut?.display} shares`)
    if (tier >= 3) {
      this.transition(r, 'AWAITING_APPROVAL', tier === 4 ? 'Waiting for the owner and the bank' : 'Waiting for the owner')
      m.pending.push({ requestId: r.id, role: 'owner', safe: D.safe as Address, client: DEMO_CLIENT, createdAt: now, expiresAt: now + 86400 })
      const reply = `I can deposit ${money(value)} into ${v.name}. ${card.reason} The Safe would keep ${card.reserveAfter.display}, above the ${money(m.floor)} floor. Review the record and sign if you agree.`
      return { reply, requestId: r.id, state: 'AWAITING_APPROVAL', actionCard: card }
    }
    void this.executeDeposit(r, k, value)
    return { reply: `Depositing ${money(value)} into ${v.name}. ${card.reason} The Safe keeps ${card.reserveAfter.display}.`, requestId: r.id, state: 'SIMULATED', actionCard: card }
  }

  private async executeDeposit(r: RequestRecord, k: VaultKey, value: number) {
    const m = this.model
    const v = m.vaults[k]
    if (r.state === 'APPROVED') {
      await wait(600)
      this.transition(r, 'FINAL_REVALIDATION', 'Reloaded state, replanned and simulated again')
      const fail = this.firstFailure(this.policyChecks(k, value))
      if (m.policy.authorizerRevoked) {
        this.transition(r, 'HELD', 'The bank revoked the authorizer: nothing can be signed')
        r.explanation = 'The bank has revoked the authorizer key, so no deposit record can be signed. Exits by the exit key still run.'
        this.transition(r, 'EXPLAINED')
        this.dropPending(r.id)
        return
      }
      if (fail) {
        this.transition(r, 'STATE_LOADED', `Conditions changed: would revert ${fail}`)
        this.transition(r, 'HELD', fail)
        const { row } = builder(m)
        this.emit({ type: 'ledger', data: row({ ts: this.now(), requestId: r.id, kind: 'hold', state: 'HELD', op: 'DEPOSIT', vault: v.name, amount: amount(value), revertReason: fail, summary: `Approved deposit of ${money(value)} into ${v.name} held at final revalidation: it would revert ${fail}.` }) })
        r.explanation = `You approved it, but conditions changed before signing: the contract would revert ${fail}. Nothing was signed.`
        this.transition(r, 'EXPLAINED')
        this.dropPending(r.id)
        return
      }
    }
    await wait(700)
    const isRecorded = r.id === 'req-d2-b' && value === 1250 && k === 'B'
    r.dar = isRecorded ? recorded('dar-d2-b1250') : this.unsignedDar({ safe: D.safe, op: 0, vault: v.address, amount: toUnits(value).toString(), policyVersion: m.policy.version, tier: r.actionCard?.tier ?? 2 })
    this.transition(r, 'DAR_SIGNED', 'Authorizer signed the decision record')
    await wait(800)
    this.transition(r, 'SUBMITTED', 'Executor submitted; anyone may submit a signed record')
    await wait(1300)
    const shares = Math.round((value / v.sharePrice) * 100) / 100
    v.shares += shares
    v.everDeposited = true
    m.safeUsdc = Math.round((m.safeUsdc - value) * 100) / 100
    m.depositedToday += value
        const b = builder(m)
    const ev = b.event({ name: 'AegisExecuted', timestamp: this.now(), args: { safe: D.safe, darHash: r.dar.digest ?? keccak256(toHex(r.id)), op: 0, vault: v.address, assets: toUnits(value).toString(), shares: toUnits(shares).toString(), tier: r.actionCard?.tier ?? 2, evidenceHash: (r.dar.message.evidenceHash as string) ?? keccak256(toHex('ev-' + r.id)) } })
    const row = b.row({ ts: this.now(), requestId: r.id, kind: 'execution', state: 'CONFIRMED', op: 'DEPOSIT', vault: v.name, amount: amount(value), tier: r.actionCard?.tier, evidenceHash: r.dar.message.evidenceHash as Hex | undefined, summary: `Deposit ${money(value)} into ${v.name}${(r.actionCard?.tier ?? 2) >= 3 ? ' with the owner’s approval' : ' on the agent’s own authority'} (tier ${r.actionCard?.tier})` })
    this.dropPending(r.id)
    this.transition(r, 'CONFIRMED', `Received ${money(shares)} shares; approval reset to zero`)
    if (ev) this.emit({ type: 'execution', data: ev })
    this.emit({ type: 'ledger', data: row })
    this.emitState()
    await wait(300)
    r.explanation = `Deposited ${money(value)} into ${v.name}. The Safe keeps ${money(m.safeUsdc)}, above the ${money(m.floor)} floor.`
    this.transition(r, 'EXPLAINED')
  }

  async request(id: string): Promise<RequestRecord> {
    const r = this.model.requests[id]
    if (!r) throw new ApiError('No such request', 404)
    const out = structuredClone(r)
    if (out.actionCard) out.actionCard = this.liveCard(r)
    return out
  }

  private liveCard(r: RequestRecord): ActionCard {
    const card = structuredClone(r.actionCard!)
    if (r.state !== 'AWAITING_APPROVAL' || card.op !== 'DEPOSIT' ) return card
    const value = fromUnits(card.amount.raw)
    const k: VaultKey = lower(card.vault.address) === lower(D.vaultA) ? 'A' : 'B'
    card.policyChecks = this.policyChecks(k, value)
    const fail = this.firstFailure(card.policyChecks)
    card.simulation = fail ? { ok: false, error: fail } : { ok: true, sharesOut: amount(Math.round((value / this.model.vaults[k].sharePrice) * 100) / 100) }
    if (this.model.policy.authorizerRevoked) card.policyChecks = [...card.policyChecks, { name: 'authorizerActive', ok: false, detail: 'The bank revoked the authorizer: no decision record can be signed' }]
    return card
  }

  async listRequests(): Promise<RequestRecord[]> {
    return Object.values(this.model.requests).sort((a, b) => b.createdAt - a.createdAt).map((r) => structuredClone(r))
  }

  private recordedFor(id: string): { signature: Hex; signer: Address; nonce: string } | null {
    const key = id === 'req-d2-b' ? 'apr-d2-b1250' : null
    if (!key) return null
    const r = REPLAY_APPROVAL_SIGNATURES[key]
    return { signature: r.signature as Hex, signer: r.signer as Address, nonce: String(recorded(key).message.approvalNonce) }
  }

  async recordedApproval(id: string) {
    const rec = this.recordedFor(id)
    const stored = this.model.requests[id]?.approvals?.[0]
    if (!rec || !stored || String(stored.message.approvalNonce) !== rec.nonce) return null
    return { signature: rec.signature, signer: rec.signer }
  }

  async submitApproval(id: string, body: ApprovalSubmission) {
    const r = this.model.requests[id]
    if (!r) throw new ApiError('No such request', 404)
    if (r.state !== 'AWAITING_APPROVAL') throw new ApiError(`The request is ${r.state}; it is no longer waiting for approval.`, 409)
    const pending = this.model.pending.find((p) => p.requestId === id)
    const role = pending?.role ?? 'owner'
    const stored = r.approvals?.[0]
    if (stored && JSON.stringify(stored.message) !== JSON.stringify(body.approval)) throw new ApiError('ApprovalMismatch: the signed approval differs from the one proposed.', 422)
    let signer: Address
    let simulated = false
    if (body.signature === REPLAY_SIMULATED_SIGNATURE) {
      simulated = true
      signer = role === 'bank' ? (D.roles.bank as Address) : (D.roles.owner as Address)
    } else {
      const payload = typedDataFor({ primaryType: 'Approval', message: body.approval }, D.chainId, D.module as Address)
      const got = await recoverSigner(payload, body.signature)
      const accepted = [role === 'bank' ? D.roles.bank : D.roles.owner, (await this.recordedApproval(id))?.signer].filter(Boolean).map((a) => lower(a!))
      if (!got || !accepted.includes(lower(got))) throw new ApiError(`BadSignature: the approval recovers to ${got ?? 'nothing'}, not the ${role}.`, 422)
      signer = got
    }
    const signed: SignedRecord = { primaryType: 'Approval', message: body.approval, signature: simulated ? null : body.signature, signer, replayUnsigned: simulated }
    r.approvals = [signed, ...(r.approvals?.slice(1) ?? [])]
    const who = simulated ? `${role} approval simulated in replay` : `${role === 'bank' ? 'Bank' : 'Owner'} signed (${signer.slice(0, 6)}…${signer.slice(-4)})`
    this.transition(r, 'APPROVED', who)
    this.dropPending(id)
    this.emit({ type: 'state', data: { requestId: id, state: 'APPROVED', note: 'No longer waiting for a signature' } })
    const k: VaultKey = lower(r.actionCard!.vault.address) === lower(D.vaultA) ? 'A' : 'B'
    void this.executeDeposit(r, k, fromUnits(r.actionCard!.amount.raw))
    return structuredClone(r)
  }

  async deny(id: string, reason: string) {
    const r = this.model.requests[id]
    if (!r || r.state !== 'AWAITING_APPROVAL') throw new ApiError('Nothing to deny', 409)
    this.transition(r, 'APPROVAL_DENIED', reason || 'Denied by the owner')
    this.dropPending(id)
    const { row } = builder(this.model)
    this.emit({ type: 'ledger', data: row({ ts: this.now(), requestId: id, kind: 'denial', state: 'APPROVAL_DENIED', op: r.actionCard?.op, vault: r.actionCard?.vault.name, amount: r.actionCard?.amount, tier: r.actionCard?.tier, summary: `Owner denied ${r.actionCard?.amount.display} into ${r.actionCard?.vault.name}${reason ? `: “${reason}”` : ''}` }) })
    r.explanation = 'Denied. Nothing was signed and the deposit will not run.'
    this.transition(r, 'EXPLAINED')
    return structuredClone(r)
  }

  async correct(id: string, message: string) {
    const r = this.model.requests[id]
    if (!r || r.state !== 'AWAITING_APPROVAL' || !r.actionCard) throw new ApiError('Nothing to correct', 409)
    const figure = Number((message.match(/(\d[\d,]*(?:\.\d+)?)/)?.[1] ?? '').replace(/,/g, ''))
    this.transition(r, 'CORRECTION_REQUESTED', message)
    this.dropPending(id)
    if (!(figure > 0)) {
      r.explanation = 'I could not read an amount in the correction. Say for example “make it 900”.'
      this.transition(r, 'NEEDS_CLARIFICATION')
      return structuredClone(r)
    }
    const k: VaultKey = /\bvault\s*b\b/i.test(message) ? 'B' : /\bvault\s*a\b/i.test(message) ? 'A' : lower(r.actionCard.vault.address) === lower(D.vaultA) ? 'A' : 'B'
    this.transition(r, 'OPTION_SELECTED', `Corrected to ${money(figure)} in Vault ${k}`)
    this.transition(r, 'PROPOSAL_VALIDATED')
    await this.buildDeposit(r, k, figure, false)
    return structuredClone(r)
  }

  async pendingApprovals(): Promise<PendingApproval[]> {
    const role = this.role() ?? 'owner'
    return this.model.pending
      .filter((p) => p.role === role)
      .map((p) => ({ requestId: p.requestId, role: p.role, safe: p.safe, client: p.client, createdAt: p.createdAt, expiresAt: p.expiresAt, actionCard: this.liveCard(this.model.requests[p.requestId]) }))
  }

  async ledger(safe?: Address): Promise<LedgerRow[]> {
    if (safe && lower(safe) !== lower(D.safe)) return this.foreignLedger(safe)
    return this.model.ledger.map((r) => ({ ...r }))
  }

  async events(safe?: Address): Promise<ChainEvent[]> {
    if (safe && lower(safe) !== lower(D.safe)) return []
    return this.model.events.map((e) => ({ ...e, args: { ...e.args } }))
  }

  private foreignLedger(safe: Address): LedgerRow[] {
    void safe
    return []
  }

  async bankClients(): Promise<BankClient[]> {
    if (this.role() !== 'bank') throw new ApiError('Bank session required: the client list is visible to the bank role only.', 403)
    const t = this.treasurySync()
    const r = this.riskSync()
    const own: BankClient = {
      safe: D.safe as Address, name: DEMO_CLIENT, riskScore: Math.max(...r.vaults.map((v) => v.score)), frozen: { ...this.model.policy.frozen },
      authorizerRevoked: this.model.policy.authorizerRevoked, pendingEscalations: this.model.pending.filter((p) => lower(p.safe) === lower(D.safe) && p.role === 'bank').length,
      mismatches: (await this.reconciliation(D.safe as Address)).filter((x) => x.status !== 'match').length, total: t.balances.total, policyVersion: this.model.policy.version,
      lastActivity: this.model.ledger[this.model.ledger.length - 1]?.ts,
    }
    return [own]
  }

  async reconciliation(safe: Address): Promise<ReconciliationRow[]> {
    if (lower(safe) === lower(D.safe)) return reconcile(this.model.ledger, this.model.events)
    return []
  }

  async simulateBankAction(action: BankAction, safe: Address, actor: Address) {
    if (lower(actor) !== lower(D.roles.bank)) throw new ApiError(`Unauthorized: ${action} is a bank-only call and ${actor} is not the bank.`, 403)
    const now = this.now()
    if (lower(safe) !== lower(D.safe)) throw new ApiError('Unknown Safe', 404)
    const p = this.model.policy
    if (action === 'bankUnfreeze' && !p.frozen.bank) throw new ApiError('The bank has not frozen this Safe.', 409)
    const b = builder(this.model)
    if (action === 'bankFreeze') { p.frozen.bank = true; b.policy(now, 'bankFreeze', actor, 'Bank froze deposits') }
    if (action === 'bankUnfreeze') { p.frozen.bank = false; b.policy(now, 'bankUnfreeze', actor, 'Bank lifted its freeze') }
    if (action === 'revokeAuthorizer') { p.authorizerRevoked = true; p.frozen.bank = true; b.policy(now, 'revokeAuthorizer', actor, 'Bank revoked the authorizer and froze deposits') }
    this.emitLast(b)
    this.emitState()
  }

  async scenario(name: ScenarioName) {
    if (this.busy && name !== 'restore') throw new ApiError('A scenario is still running.', 409)
    this.busy = true
    try {
      if (name === 'restore') {
        this.model = this.freshModel()
        this.emitState()
        this.emit({ type: 'notice', data: { level: 'info', text: 'Restored the recorded base state: healthy peg, both vaults open, one approval waiting.' } })
        return { ok: true }
      }
      this.model.scenario = name
      if (name === 'depeg') await this.runDepeg()
      if (name === 'stale') await this.runStale()
      if (name === 'liquidity') await this.runLiquidity()
      if (name === 'obligation') {
        const recordedFloor = recordedSlot('e3-floor')?.amount
        const outflows = this.model.obligations.filter((o) => !o.settled && !o.confirmedInflow).reduce((a, o) => a + fromUnits(o.amount.raw), 0)
        const invoice = recordedFloor ? Math.round((recordedFloor / 1.1 - outflows) * 100) / 100 : 2000
        await this.addObligation({ label: 'Supplier invoice', amount: String(invoice > 0 ? invoice : 2000), dueDate: '2026-10-19' })
      }
      return { ok: true }
    } finally {
      this.busy = false
    }
  }

  private pushPrice(p: number) {
    const o = this.model.oracle
    o.price = p
    o.history.push({ t: this.now(), price: p })
    this.emit({ type: 'oracle', data: this.oracleSync() })
  }

  private async quarantineAndExit(keys: VaultKey[], why: string, recs: Partial<Record<VaultKey, RecordedId>>, quarantineSlots: Partial<Record<VaultKey, string>> = {}) {
    const m = this.model
    for (const k of keys) {
      const v = m.vaults[k]
      if (v.quarantined) continue
      await wait(800)
      v.quarantined = true
      v.quarantinedAt = this.now()
      const b = builder(m)
      m.policy.version += 1
      const qs = quarantineSlots[k] ? recordedSlot(quarantineSlots[k]!) : undefined
      const h = qs?.hash
      const ev = b.event({ name: 'Quarantined', txHash: h, timestamp: this.now(), args: { safe: D.safe, vault: v.address, by: D.roles.exitKey } }, qs?.block ?? blockAt(this.now()))
      const row = b.row({ ts: this.now(), kind: 'risk', state: 'QUARANTINED', vault: v.name, txHash: h, summary: `${why}: ${v.name} quarantined by the exit key (policy v${m.policy.version}). Deposits into it now revert VaultQuarantined.` })
      if (ev) this.emit({ type: 'execution', data: ev })
      this.emit({ type: 'ledger', data: row })
      for (const r of Object.values(m.requests)) {
        if (r.state === 'AWAITING_APPROVAL' && r.actionCard?.op === 'DEPOSIT' && lower(r.actionCard.vault.address) === lower(v.address)) {
          this.transition(r, 'CANCELLED', `${v.name} quarantined: pending deposit dropped`)
          this.dropPending(r.id)
          this.emit({ type: 'ledger', data: b.row({ ts: this.now(), requestId: r.id, kind: 'cancel', state: 'CANCELLED', op: 'DEPOSIT', vault: v.name, amount: r.actionCard.amount, summary: `Pending deposit of ${r.actionCard.amount.display} into ${v.name} dropped after quarantine.` }) })
        }
      }
      this.emitState()
    }
    for (const k of keys) {
      const v = m.vaults[k]
      if (v.shares <= 0) continue
      const shares = Math.min(v.shares, Math.floor((v.maxRedeemCap / v.sharePrice) * 100) / 100)
      const rec = recs[k]
      const matches = rec && Math.abs(Number(RECORDED_AMOUNT(rec)) - shares) < 0.005
      await wait(500)
      await this.runRedeem(k, shares, 'exitKey', why, matches ? rec : undefined)
    }
  }

  private async runDepeg() {
    this.pushPrice(0.9962)
    await wait(900)
    this.pushPrice(0.985)
    this.emit({ type: 'risk', data: this.riskSync() })
    this.emit({ type: 'notice', data: { level: 'alert', text: 'Peg trigger: price 0.9850 is 1.50% from 1.0000 (limit 1.00%). Exit Agent acting.' } })
    await this.quarantineAndExit(['A', 'B'], 'Peg 0.9850 broke the 1.00% limit', { A: 'dar-depeg-a', B: 'dar-depeg-b' }, { A: 'e2-quarantine-1', B: 'e2-quarantine-2' })
    this.emit({ type: 'notice', data: { level: 'info', text: `Both positions are back in the Safe: ${money(this.model.safeUsdc)} USDC. With one stablecoin and one feed, this exit reduces vault risk, not exposure to the coin itself.` } })
  }

  private async runStale() {
    const o = this.model.oracle
    o.keeperStoppedAt = this.now()
    o.frozenUpdatedAt = this.now() - 412
    this.emit({ type: 'oracle', data: this.oracleSync() })
    this.emit({ type: 'risk', data: this.riskSync() })
    this.emit({ type: 'notice', data: { level: 'alert', text: 'Keeper stopped. Replay skips ahead: the last price is 412 s old, past the 180 s limit. Deposits would revert StaleOracle; exits still run.' } })
    await this.quarantineAndExit(['A', 'B'], 'Oracle older than 180 s', { A: 'dar-stale-a', B: 'dar-stale-b' })
  }

  private async runLiquidity() {
    this.model.vaults.B.maxRedeemCap = 1500
    this.emit({ type: 'risk', data: this.riskSync() })
    this.emit({ type: 'notice', data: { level: 'alert', text: 'Liquidity trigger: Vault B lets only 1,500.00 leave, below 1.2 × the position. Exit Agent takes what it can.' } })
    await this.quarantineAndExit(['B'], 'Vault B withdrawable fell below 1.2 × position', { B: 'dar-liq-b' })
    this.emit({ type: 'notice', data: { level: 'alert', text: `${money(this.vaultAssets('B'))} remains in Vault B. The Exit Agent retries every window until it is out.` } })
  }

  stream(onEvent: (e: StreamEvent) => void, onStatus: (s: StreamStatus) => void): () => void {
    this.listeners.add(onEvent)
    onStatus('connecting')
    const t = setTimeout(() => onStatus('open'), 60)
    if (!this.ticker) {
      this.ticker = setInterval(() => {
        const updatedAt = this.oracleUpdatedAt()
        if (updatedAt !== this.lastPoke) {
          this.lastPoke = updatedAt
          if (this.extendHistory()) this.emit({ type: 'oracle', data: this.oracleSync() })
        }
      }, 1000)
    }
    return () => {
      clearTimeout(t)
      this.listeners.delete(onEvent)
      if (!this.listeners.size && this.ticker) {
        clearInterval(this.ticker)
        this.ticker = null
      }
    }
  }
}

function round3(n: number) {
  return Math.round(n * 1000) / 1000
}


function RECORDED_AMOUNT(id: RecordedId): number {
  return fromUnits(String(recorded(id).message.amount))
}
