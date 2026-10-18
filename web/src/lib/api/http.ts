import type { Address, Hex } from 'viem'
import type { ActivateResult, AttackKind, AttackResult, FundResult, MarketState, OnboardConfig, OnboardStatus } from '../onboard/types'
import type {
  Amount, BankClient, ChainEvent, ChatResponse, Health, LedgerRow, Obligation, ObligationCreated, OracleState,
  PendingApproval, RequestRecord, RiskReport, Role, ScenarioName, Session, StreamEvent, TreasuryState, TxRequest,
} from '../types'
import type { DemoVariant, OrderView, ProofResult, TradeFlowConfig } from '../tradeflow/types'
import { ApiError, type AegisApi, type ApprovalSubmission, type AuthRoles, type ChatStage, type ChatStreamHandlers, type NewObligation, type SessionProof, type StreamStatus } from './contract'
import { SseParser } from './sse'
import type { AuthNonce } from '../siwe'
import { amount, PRICE_DECIMALS, fromUnits } from '../format'
import { reconcile } from '../reconcile'
import { bankClientFrom, eventsFrom, ledgerFrom, pendingFrom, requestFrom, riskVaultFrom } from './normalize'
import type { ReconciliationRow } from '../types'

function asAmount(v: unknown): Amount {
  if (v && typeof v === 'object' && 'raw' in (v as Amount)) return v as Amount
  if (typeof v === 'string' || typeof v === 'number' || typeof v === 'bigint') return amount(BigInt(v))
  return amount(0)
}

function asList<T>(v: unknown, key: string): T[] {
  if (Array.isArray(v)) return v as T[]
  if (v && typeof v === 'object' && Array.isArray((v as Record<string, unknown>)[key])) return (v as Record<string, T[]>)[key]
  return []
}

// The service sends a heartbeat every 10 s while a chat turn runs, so this long without a byte means the link is gone.
const CHAT_IDLE_MS = 30000

export class HttpApi implements AegisApi {
  readonly mode = 'live' as const
  private token: string | null = null
  private readonly base: string
  // Called when the service answers SessionRequired to a request that carried a token: the session expired or was revoked.
  onSessionLost: (() => void) | null = null

  constructor(base: string) {
    this.base = base.replace(/\/$/, '')
  }

  setSession(token: string | null) {
    this.token = token
  }

  hasSession(): boolean {
    return !!this.token
  }

  private async call<T>(path: string, init: RequestInit = {}, timeoutMs = 15000, anonymous = false): Promise<T> {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), timeoutMs)
    const headers: Record<string, string> = { Accept: 'application/json' }
    if (init.body) headers['Content-Type'] = 'application/json'
    if (this.token && !anonymous) headers['X-Aegis-Session'] = this.token
    try {
      let res: Response
      try {
        res = await fetch(`${this.base}${path}`, { ...init, headers: { ...headers, ...(init.headers as Record<string, string>) }, signal: ctrl.signal })
      } catch (e) {
        throw new ApiError((e as Error).name === 'AbortError' ? 'The Porthmos service took too long to answer' : 'Could not reach the Porthmos service', 0)
      }
      const text = await res.text()
      const body = text ? safeJson(text) : undefined
      if (res.status === 401 && headers['X-Aegis-Session'] && (body as { error?: string } | undefined)?.error === 'SessionRequired' && this.token === headers['X-Aegis-Session']) {
        this.onSessionLost?.()
      }
      if (!res.ok) throw new ApiError(errorText(body) || res.statusText || `HTTP ${res.status}`, res.status, body)
      return body as T
    } finally {
      clearTimeout(timer)
    }
  }

  async health(): Promise<Health> {
    const h = await this.call<unknown>('/api/health', {}, 2500)
    // A static host's SPA rewrite answers any path with HTML and 200, so only an explicit JSON ok counts.
    if (!h || typeof h !== 'object') throw new ApiError('No Porthmos service at this address', 503)
    const body = h as Health & { status?: string }
    return { ...body, ok: body.ok === true || body.status === 'ok' }
  }

  createSession(role: Role, address: Address, proof?: SessionProof): Promise<Session> {
    const body = proof ? { message: proof.message, signature: proof.signature } : { role, address }
    return this.call<Session>('/api/session', { method: 'POST', body: JSON.stringify(body) }, 20000, true)
  }

  authNonce(): Promise<AuthNonce> {
    return this.call<AuthNonce>('/api/auth/nonce', { cache: 'no-store' }, 10000, true)
  }

  authRoles(address: Address): Promise<AuthRoles> {
    return this.call<AuthRoles>(`/api/auth/roles?address=${address}`, {}, 10000, true)
  }

  async treasury(): Promise<TreasuryState> {
    const t = await this.call<TreasuryState>('/api/treasury')
    return {
      ...t,
      deployable: asAmount(t.deployable),
      balances: {
        ...t.balances,
        safeUsdc: asAmount(t.balances?.safeUsdc),
        total: asAmount(t.balances?.total),
        vaults: (t.balances?.vaults ?? []).map((v) => ({ ...v, shares: asAmount(v.shares), assets: asAmount(v.assets) })),
      },
    }
  }

  async obligations(): Promise<Obligation[]> {
    return asList<Obligation>(await this.call('/api/obligations'), 'obligations')
  }

  addObligation(input: NewObligation): Promise<ObligationCreated> {
    return this.call('/api/obligations', { method: 'POST', body: JSON.stringify(input) })
  }

  settleObligation(id: string) {
    return this.call(`/api/obligations/${encodeURIComponent(id)}/settle`, { method: 'POST' })
  }

  async risk(): Promise<RiskReport> {
    const r = await this.call<unknown>('/api/risk')
    return { vaults: asList<Record<string, unknown>>(r, 'vaults').map(riskVaultFrom) }
  }

  async oracle(): Promise<OracleState> {
    const o = await this.call<OracleState & { price: unknown }>('/api/oracle')
    const p = o.price
    const priceAmount: Amount = typeof p === 'object' && p ? (p as Amount) : { raw: String(p), display: fromUnits(BigInt(String(p ?? 0)), PRICE_DECIMALS).toFixed(4) }
    return { ...o, price: priceAmount }
  }

  chat(message: string, requestId?: string): Promise<ChatResponse> {
    return this.call('/api/agent/chat', { method: 'POST', body: JSON.stringify(requestId ? { message, requestId } : { message }) }, 60000)
  }

  // Falls back to chat() only while no stream was accepted. Once the service answers with an event stream the
  // turn is running there, so a broken stream is an error rather than a second request.
  async chatStream(message: string, on: ChatStreamHandlers = {}, signal?: AbortSignal, requestId?: string): Promise<ChatResponse> {
    const ctrl = new AbortController()
    const abort = () => ctrl.abort()
    signal?.addEventListener('abort', abort)
    let idle: ReturnType<typeof setTimeout> | undefined
    const arm = () => {
      clearTimeout(idle)
      idle = setTimeout(abort, CHAT_IDLE_MS)
    }
    const headers: Record<string, string> = { Accept: 'text/event-stream', 'Content-Type': 'application/json' }
    if (this.token) headers['X-Aegis-Session'] = this.token
    try {
      let res: Response
      try {
        arm()
        res = await fetch(`${this.base}/api/agent/chat/stream`, { method: 'POST', headers, body: JSON.stringify(requestId ? { message, requestId } : { message }), signal: ctrl.signal })
      } catch (e) {
        if (signal?.aborted) throw e
        clearTimeout(idle)
        return this.chat(message, requestId)
      }
      if (!res.ok || !res.body || !(res.headers.get('content-type') ?? '').startsWith('text/event-stream')) {
        clearTimeout(idle)
        void res.body?.cancel().catch(() => {})
        return this.chat(message, requestId)
      }
      const reader = res.body.pipeThrough(new TextDecoderStream()).getReader()
      const parser = new SseParser()
      for (;;) {
        let chunk: ReadableStreamReadResult<string>
        try {
          chunk = await reader.read()
        } catch (e) {
          if (signal?.aborted) throw e
          throw new ApiError('The reply stream was interrupted. The request may still have run; check the request list.', 0)
        }
        arm()
        for (const m of chunk.done ? parser.end() : parser.push(chunk.value)) {
          const data = safeJson(m.data) as Record<string, unknown>
          if (!data || typeof data !== 'object') continue
          if (m.event === 'status' && typeof data.stage === 'string') on.onStatus?.(data.stage as ChatStage)
          else if (m.event === 'delta' && typeof data.text === 'string') on.onDelta?.(data.text)
          else if (m.event === 'replace' && typeof data.text === 'string') on.onReplace?.(data.text)
          else if (m.event === 'done') {
            void reader.cancel().catch(() => {})
            return data as unknown as ChatResponse
          } else if (m.event === 'error') {
            const status = typeof data.status === 'number' ? data.status : 500
            const body = { error: data.code, detail: data.detail }
            if (status === 401 && data.code === 'SessionRequired' && headers['X-Aegis-Session'] && this.token === headers['X-Aegis-Session']) this.onSessionLost?.()
            throw new ApiError(errorText(body) || `HTTP ${status}`, status, body)
          }
        }
        if (chunk.done) break
      }
      throw new ApiError('The reply stream ended early. The request may still have run; check the request list.', 0)
    } finally {
      clearTimeout(idle)
      signal?.removeEventListener('abort', abort)
    }
  }

  async request(id: string): Promise<RequestRecord> {
    return requestFrom(await this.call(`/api/requests/${encodeURIComponent(id)}`))
  }

  submitApproval(id: string, body: ApprovalSubmission) {
    return this.call(`/api/requests/${encodeURIComponent(id)}/approval`, { method: 'POST', body: JSON.stringify(body) })
  }

  deny(id: string, reason: string) {
    return this.call(`/api/requests/${encodeURIComponent(id)}/deny`, { method: 'POST', body: JSON.stringify({ reason }) })
  }

  correct(id: string, message: string) {
    return this.call(`/api/requests/${encodeURIComponent(id)}/correct`, { method: 'POST', body: JSON.stringify({ message }) })
  }

  async pendingApprovals(): Promise<PendingApproval[]> {
    return pendingFrom(await this.call('/api/approvals/pending'))
  }

  async ledger(safe?: Address): Promise<LedgerRow[]> {
    return ledgerFrom(await this.call(`/api/ledger${safe ? `?safe=${safe}` : ''}`))
  }

  async events(safe?: Address): Promise<ChainEvent[]> {
    return eventsFrom(await this.call(`/api/events${safe ? `?safe=${safe}` : ''}`))
  }

  async bankClients(): Promise<BankClient[]> {
    return asList<Record<string, unknown>>(await this.call('/api/bank/clients'), 'clients').map(bankClientFrom)
  }

  async reconciliation(safe: Address): Promise<ReconciliationRow[]> {
    const [rows, events] = await Promise.all([this.ledger(safe), this.events(safe)])
    return reconcile(rows, events)
  }

  onboardConfig(): Promise<OnboardConfig> {
    return this.call('/api/onboard/config', {}, 8000)
  }

  onboardStatus(owner: Address): Promise<OnboardStatus> {
    return this.call(`/api/onboard/status?owner=${owner}`, {}, 10000)
  }

  onboardFund(body: { owner: Address; bank: Address; issuedAt: string; signature: Hex }): Promise<FundResult> {
    return this.call('/api/onboard/fund', { method: 'POST', body: JSON.stringify(body) }, 75000)
  }

  onboardActivate(body: { safe: Address; owner: Address; message: string; signature: Hex }): Promise<ActivateResult> {
    return this.call('/api/onboard/activate', { method: 'POST', body: JSON.stringify(body) }, 75000)
  }

  async market(): Promise<MarketState> {
    return marketFrom(await this.call<unknown>('/api/market', {}, 8000))
  }

  attack(kind: AttackKind): Promise<AttackResult> {
    return this.call('/api/tenant/attack', { method: 'POST', body: JSON.stringify({ kind }) }, 90000)
  }

  async floorUpdate(): Promise<TxRequest | null> {
    const body = await this.call<{ floorUpdate?: TxRequest | null }>('/api/obligations')
    return body && !Array.isArray(body) && body.floorUpdate?.data ? body.floorUpdate : null
  }

  tradeflowConfig(): Promise<TradeFlowConfig> {
    return this.call('/api/tradeflow/config', {}, 8000)
  }

  async orders(): Promise<OrderView[]> {
    return asList<OrderView>(await this.call('/api/tradeflow/orders', {}, 20000), 'orders')
  }

  // The supplier view never sends the session, so the service answers with on-chain fields only (C9).
  order(id: string, publicView = false): Promise<OrderView> {
    return this.call(`/api/tradeflow/orders/${encodeURIComponent(id)}`, { credentials: publicView ? 'omit' : 'same-origin' }, 15000, publicView)
  }

  demoProof(id: string, index: number, variant: DemoVariant): Promise<ProofResult> {
    return this.call(`/api/tradeflow/orders/${encodeURIComponent(id)}/proofs/demo`, { method: 'POST', body: JSON.stringify({ index, variant }) }, 60000)
  }

  confirmRelease(id: string, body: { index: number; proofHash: Hex; expiry: number; signature: Hex }): Promise<OrderView> {
    return this.call(`/api/tradeflow/orders/${encodeURIComponent(id)}/confirm`, { method: 'POST', body: JSON.stringify(body) }, 60000)
  }

  scenario(name: ScenarioName) {
    return this.call('/api/demo/scenario', { method: 'POST', body: JSON.stringify({ name }) })
  }

  stream(onEvent: (e: StreamEvent) => void, onStatus: (s: StreamStatus) => void): () => void {
    let stopped = false
    let ctrl: AbortController | null = null
    let retry = 1000

    const connect = async () => {
      if (stopped) return
      ctrl = new AbortController()
      onStatus('connecting')
      try {
        const headers: Record<string, string> = { Accept: 'text/event-stream' }
        if (this.token) headers['X-Aegis-Session'] = this.token
        const res = await fetch(`${this.base}/api/stream`, { headers, signal: ctrl.signal })
        if (!res.ok || !res.body) throw new Error(`stream ${res.status}`)
        onStatus('open')
        retry = 1000
        const reader = res.body.pipeThrough(new TextDecoderStream()).getReader()
        let buffer = ''
        for (;;) {
          const { value, done } = await reader.read()
          if (done) break
          buffer += value
          let cut: number
          while ((cut = buffer.search(/\r?\n\r?\n/)) >= 0) {
            const chunk = buffer.slice(0, cut)
            buffer = buffer.slice(cut).replace(/^\r?\n\r?\n/, '')
            const evt = parseSse(chunk)
            if (evt) onEvent(evt)
          }
        }
      } catch {
        if (stopped) return
      }
      onStatus('closed')
      if (!stopped) setTimeout(connect, (retry = Math.min(retry * 2, 15000)))
    }
    connect()
    return () => {
      stopped = true
      ctrl?.abort()
    }
  }
}

function errorText(body: unknown): string {
  if (!body || typeof body !== 'object') return typeof body === 'string' && body.length < 200 ? body : ''
  const b = body as { detail?: unknown; error?: unknown }
  if (typeof b.detail === 'string' && b.detail) return b.detail
  if (Array.isArray(b.detail)) return b.detail.map((d) => (d && typeof d === 'object' && 'msg' in d ? String((d as { msg: unknown }).msg) : String(d))).join('; ')
  return typeof b.error === 'string' ? b.error : ''
}

const MARKET_LABELS: Record<string, string> = { depeg: 'Depeg', liquidity: 'Liquidity squeeze', stale: 'Stale price feed' }
const CALM = new Set(['', 'restore', 'none', 'normal', 'ok', 'healthy', 'calm'])

function marketLabel(name: string): string {
  return MARKET_LABELS[name.toLowerCase()] ?? name.replace(/[_-]+/g, ' ').replace(/^./, (c) => c.toUpperCase())
}

// v2.1 shape: {price, stale, pegDeviationPct, vaults[{name, liquidityCapped, remainingLiquidity}], active: string[], scenario: {name, at, by} | null}
export function marketFrom(v: unknown): MarketState {
  const o = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>
  const sc = o.scenario
  const scenarioName = typeof sc === 'string' ? sc : sc && typeof sc === 'object' && typeof (sc as { name?: unknown }).name === 'string' ? (sc as { name: string }).name : null
  const list = Array.isArray(o.active) ? o.active.filter((x): x is string => typeof x === 'string' && !CALM.has(x.toLowerCase())) : null
  const active = list ? list.length > 0 : typeof o.active === 'boolean' ? o.active : !CALM.has((scenarioName ?? '').toLowerCase())
  const names = list?.length ? list : scenarioName && !CALM.has(scenarioName.toLowerCase()) ? [scenarioName] : []
  const parts: string[] = []
  const price = typeof o.price === 'number' ? o.price : typeof o.price === 'string' && /^\d+$/.test(o.price) ? Number(o.price) / 1e8 : typeof o.price === 'string' ? Number(o.price) : null
  if (names.some((n) => n.toLowerCase() === 'depeg') && price !== null && Number.isFinite(price)) parts.push(`The shared price feed reads ${price.toFixed(4)}${typeof o.pegDeviationPct === 'number' ? `, ${Math.abs(o.pegDeviationPct).toFixed(2)}% off the peg` : ''}.`)
  if (names.some((n) => n.toLowerCase() === 'stale') || o.stale === true) parts.push('The price feed is stale, so deposits are refused. Exits still run.')
  if (names.some((n) => n.toLowerCase() === 'liquidity') && Array.isArray(o.vaults)) {
    const capped = (o.vaults as { name?: string; liquidityCapped?: boolean }[]).filter((x) => x.liquidityCapped).map((x) => x.name).filter(Boolean)
    if (capped.length) parts.push(`${capped.join(' and ')} let only a little leave right now.`)
  }
  const text = o.detail ?? o.note ?? o.text ?? o.message
  const at = sc && typeof sc === 'object' ? (sc as { at?: unknown }).at : o.since
  return {
    active,
    scenario: names[0] ?? scenarioName,
    label: names.length ? names.map(marketLabel).join(', ') : 'Market event',
    detail: typeof text === 'string' && text ? text : parts.length ? parts.join(' ') : null,
    since: typeof at === 'number' ? at : null,
  }
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}

function parseSse(chunk: string): StreamEvent | null {
  let name = ''
  const data: string[] = []
  for (const line of chunk.split(/\r?\n/)) {
    if (line.startsWith(':')) continue
    if (line.startsWith('event:')) name = line.slice(6).trim()
    else if (line.startsWith('data:')) data.push(line.slice(5).trimStart())
  }
  if (!data.length) return null
  const parsed = safeJson(data.join('\n'))
  if (parsed && typeof parsed === 'object' && 'type' in parsed && 'data' in parsed) return parsed as StreamEvent
  if (!name) return null
  return { type: name, data: parsed } as StreamEvent
}
