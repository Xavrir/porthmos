import type { Address } from 'viem'
import type {
  Amount, BankClient, ChainEvent, ChatResponse, Health, LedgerRow, Obligation, ObligationCreated, OracleState,
  PendingApproval, RequestRecord, RiskReport, Role, ScenarioName, Session, StreamEvent, TreasuryState,
} from '../types'
import { ApiError, type AegisApi, type ApprovalSubmission, type NewObligation, type SessionProof, type StreamStatus } from './contract'
import { amount, PRICE_DECIMALS, fromUnits } from '../format'
import { reconcile } from '../reconcile'
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

export class HttpApi implements AegisApi {
  readonly mode = 'live' as const
  private token: string | null = null
  private readonly base: string

  constructor(base: string) {
    this.base = base.replace(/\/$/, '')
  }

  setSession(token: string | null) {
    this.token = token
  }

  private async call<T>(path: string, init: RequestInit = {}, timeoutMs = 15000): Promise<T> {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), timeoutMs)
    const headers: Record<string, string> = { Accept: 'application/json' }
    if (init.body) headers['Content-Type'] = 'application/json'
    if (this.token) headers['X-Aegis-Session'] = this.token
    try {
      const res = await fetch(`${this.base}${path}`, { ...init, headers: { ...headers, ...(init.headers as Record<string, string>) }, signal: ctrl.signal })
      const text = await res.text()
      const body = text ? safeJson(text) : undefined
      if (!res.ok) {
        const detail = body && typeof body === 'object' && 'detail' in body ? String((body as { detail: unknown }).detail) : res.statusText
        throw new ApiError(detail || `HTTP ${res.status}`, res.status, body)
      }
      return body as T
    } finally {
      clearTimeout(timer)
    }
  }

  async health(): Promise<Health> {
    const h = await this.call<unknown>('/api/health', {}, 2500)
    // A static host's SPA rewrite answers any path with HTML and 200, so only an explicit JSON ok counts.
    if (!h || typeof h !== 'object') throw new ApiError('No AEGIS service at this address', 503)
    const body = h as Health & { status?: string }
    return { ...body, ok: body.ok === true || body.status === 'ok' }
  }

  createSession(role: Role, address: Address, proof?: SessionProof): Promise<Session> {
    return this.call<Session>('/api/session', { method: 'POST', body: JSON.stringify({ role, address, ...(proof ?? {}) }) })
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
    return { vaults: asList(r, 'vaults') }
  }

  async oracle(): Promise<OracleState> {
    const o = await this.call<OracleState & { price: unknown }>('/api/oracle')
    const p = o.price
    const priceAmount: Amount = typeof p === 'object' && p ? (p as Amount) : { raw: String(p), display: fromUnits(BigInt(String(p ?? 0)), PRICE_DECIMALS).toFixed(4) }
    return { ...o, price: priceAmount }
  }

  chat(message: string): Promise<ChatResponse> {
    return this.call('/api/agent/chat', { method: 'POST', body: JSON.stringify({ message }) }, 60000)
  }

  request(id: string): Promise<RequestRecord> {
    return this.call(`/api/requests/${encodeURIComponent(id)}`)
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
    return asList<PendingApproval>(await this.call('/api/approvals/pending'), 'approvals')
  }

  async ledger(safe?: Address): Promise<LedgerRow[]> {
    return asList<LedgerRow>(await this.call(`/api/ledger${safe ? `?safe=${safe}` : ''}`), 'rows')
  }

  async events(safe?: Address): Promise<ChainEvent[]> {
    return asList<ChainEvent>(await this.call(`/api/events${safe ? `?safe=${safe}` : ''}`), 'events')
  }

  async bankClients(): Promise<BankClient[]> {
    return asList<BankClient>(await this.call('/api/bank/clients'), 'clients')
  }

  async reconciliation(safe: Address): Promise<ReconciliationRow[]> {
    const [rows, events] = await Promise.all([this.ledger(safe), this.events(safe)])
    return reconcile(rows, events)
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
