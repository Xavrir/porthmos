import type { Address, Hex } from 'viem'
import { amount } from '../format'
import { sentenceCase } from '../vocabulary'
import type { Amount, BankClient, ChainEvent, LedgerRow, PendingApproval, RequestRecord, SignedRecord, VaultRisk, WorkflowState } from '../types'

// The service (service/aegis) answers with its own field names in a few places; these map them onto the web types
// and pass through anything already in the web shape, so Replay and older services keep working.

type Obj = Record<string, unknown>

function asAmount(v: unknown): Amount {
  if (v && typeof v === 'object' && 'raw' in (v as Amount)) return v as Amount
  if (typeof v === 'string' && /^-?\d+$/.test(v)) return amount(BigInt(v))
  if (typeof v === 'number' || typeof v === 'bigint') return amount(BigInt(v))
  return amount(0)
}

const hex32 = (v: unknown): Hex => (typeof v === 'string' && v ? (v.startsWith('0x') ? v : `0x${v}`) : `0x${'0'.repeat(64)}`) as Hex

const SIGNED = new Set(['DAR_SIGNED', 'SUBMITTED', 'CONFIRMED', 'REVERTED', 'EXPLAINED'])

export function requestFrom(v: unknown): RequestRecord {
  const x = (v ?? {}) as Obj
  const history = Array.isArray(x.history) ? (x.history as Obj[]).map((h) => ('state' in h ? h : { state: h.to, at: h.at, note: h.note ?? undefined })) : []
  const darRaw = x.dar as Obj | null | undefined
  let dar: SignedRecord | undefined
  if (darRaw && typeof darRaw === 'object') {
    if ('primaryType' in darRaw) dar = darRaw as unknown as SignedRecord
    else {
      const { signature, ...fields } = darRaw
      const message = Object.fromEntries(Object.entries(fields).map(([k, val]) => [k, typeof val === 'number' ? val : String(val)])) as Record<string, string | number>
      const sig = typeof signature === 'string' ? signature : typeof x.authSig === 'string' ? x.authSig : null
      dar = { primaryType: 'DAR', message, signature: sig as Hex | null, signer: null, digest: typeof x.darHash === 'string' ? (x.darHash as Hex) : undefined, signatureWithheld: !sig && SIGNED.has(String(x.state)) }
    }
  }
  return {
    ...(x as unknown as RequestRecord),
    id: String(x.id ?? x.requestId ?? ''),
    origin: (x.origin as RequestRecord['origin']) ?? 'owner',
    message: String(x.message ?? ''),
    createdAt: Number(x.createdAt ?? 0),
    history: history as RequestRecord['history'],
    dar,
    txHash: (x.txHash as Hex | null) ?? undefined,
    revertReason: (x.revertReason as RequestRecord['revertReason'] | null) ?? undefined,
    explanation: (x.explanation as string | undefined) ?? (x.reply as string | undefined) ?? (x.reason as string | undefined) ?? undefined,
  }
}

export function pendingFrom(body: unknown): PendingApproval[] {
  const list = Array.isArray(body) ? body : Array.isArray((body as Obj)?.approvals) ? (body as Obj).approvals : Array.isArray((body as Obj)?.pending) ? (body as Obj).pending : []
  const role = ((body as Obj)?.role as PendingApproval['role']) ?? 'owner'
  return (list as Obj[]).filter((p) => p && p.actionCard).map((p) => {
    const card = p.actionCard as PendingApproval['actionCard']
    const expiry = Number(card.approvalTypedData?.message.approvalExpiry ?? 0)
    return {
      requestId: String(p.requestId ?? card.requestId),
      role: (p.role as PendingApproval['role']) ?? (card.tier === 4 && role === 'bank' ? 'bank' : role),
      safe: p.safe as Address,
      client: p.client as string | undefined,
      actionCard: card,
      createdAt: Number(p.createdAt ?? 0),
      expiresAt: Number(p.expiresAt ?? (expiry || Number(p.createdAt ?? 0) + 86400)),
    }
  })
}

const REJECT = new Set(['REVERTED', 'EXIT_REVERTED', 'ATTACK_REFUSED', 'POLICY_REJECTED', 'SIM_FAILED', 'CROSS_CLIENT_REFUSED', 'EXIT_SIM_FAILED', 'EXIT_BLOCKED'])
const HOLD = new Set(['HELD', 'AWAITING_APPROVAL', 'NEEDS_CLARIFICATION', 'APPROVAL_EXPIRED', 'CORRECTION_REQUESTED'])

function kindOf(k: string): LedgerRow['kind'] {
  if (k === 'CONFIRMED' || k === 'EXIT_CONFIRMED') return 'execution'
  if (REJECT.has(k)) return 'rejection'
  if (HOLD.has(k)) return 'hold'
  if (k === 'APPROVAL_DENIED') return 'denial'
  if (k === 'CANCELLED') return 'cancel'
  if (k === 'QUARANTINED') return 'risk'
  if (k.startsWith('OBLIGATION')) return 'obligation'
  return 'policy'
}

function stateOf(k: string): LedgerRow['state'] {
  if (k === 'EXIT_CONFIRMED') return 'CONFIRMED'
  if (k === 'EXIT_REVERTED' || k === 'ATTACK_REFUSED' || k === 'CROSS_CLIENT_REFUSED') return 'REVERTED'
  if (k === 'QUARANTINED') return 'QUARANTINED'
  if (k === 'EXIT_SIGNED' || k === 'EXIT_SELF_SUBMITTED') return 'SUBMITTED'
  if (/^[A-Z_]+$/.test(k) && sentenceCase(k) !== k && !k.startsWith('OBLIGATION') && k !== 'TENANT_ACTIVATED' && !k.startsWith('DEMO')) return k as WorkflowState
  return 'POLICY_CHANGED'
}

function summaryOf(k: string, p: Obj): string {
  const a = p.action as Obj | undefined
  if (k === 'TENANT_ACTIVATED') return 'Treasury activated, test USDC minted'
  if (k === 'ATTACK_REFUSED') return `Attack refused: ${p.kind === 'replay' ? 'a replayed record' : p.kind === 'tampered' ? 'a tampered record' : String(p.kind ?? 'unknown')}`
  if (k.startsWith('OBLIGATION')) {
    const ob = p.obligation as Obj | undefined
    return `${k === 'OBLIGATION_SETTLED' ? 'Obligation settled' : 'Obligation added'}${ob?.label ? `: ${ob.label}` : ''}`
  }
  if (a) return `${a.op === 'REDEEM' ? 'Redeem' : 'Deposit'} ${a.amountDisplay ?? ''} ${a.op === 'REDEEM' ? 'from' : 'into'} ${a.vault ?? ''}`.replace(/\s+/g, ' ').trim() + (typeof p.note === 'string' && HOLD.has(k) ? `: ${p.note}` : '')
  return `${sentenceCase(k)}${typeof p.note === 'string' ? `: ${p.note}` : typeof p.reason === 'string' ? `: ${p.reason}` : ''}`
}

export function ledgerFrom(body: unknown): LedgerRow[] {
  const list = Array.isArray(body) ? body : Array.isArray((body as Obj)?.rows) ? (body as Obj).rows : []
  const broken = new Set(((body as Obj)?.integrity as Obj | undefined)?.broken as unknown[] ?? [])
  return (list as Obj[]).map((r) => {
    if ('seq' in r) return r as unknown as LedgerRow
    const kind = String(r.kind ?? '')
    const p = (typeof r.payload === 'object' && r.payload ? r.payload : {}) as Obj
    const a = p.action as Obj | undefined
    const id = Number(r.id)
    return {
      seq: id,
      ts: Number(r.ts ?? 0),
      requestId: (r.request_id as string | null) ?? undefined,
      kind: kindOf(kind),
      state: stateOf(kind),
      summary: summaryOf(kind, p),
      op: a?.op as LedgerRow['op'],
      vault: a?.vault as string | undefined,
      amount: a?.amount !== undefined ? asAmount(String(a.amount)) : undefined,
      tier: (a?.tier ?? p.tier) as LedgerRow['tier'],
      txHash: (r.tx_hash as Hex | null) ?? undefined,
      revertReason: (r.revert_reason as LedgerRow['revertReason'] | null) ?? undefined,
      prevHash: hex32(r.prev_hash),
      rowHash: hex32(r.row_hash),
      linkOk: !broken.has(id),
    }
  })
}

export function eventsFrom(body: unknown): ChainEvent[] {
  const list = Array.isArray(body) ? body : Array.isArray((body as Obj)?.events) ? (body as Obj).events : []
  return (list as Obj[]).map((e) => {
    if ('name' in e && 'args' in e) return e as unknown as ChainEvent
    const { event, blockNumber, txHash, logIndex, timestamp, ...rest } = e
    return {
      name: event as ChainEvent['name'],
      blockNumber: Number(blockNumber ?? 0),
      txHash: txHash as Hex,
      logIndex: Number(logIndex ?? 0),
      timestamp: Number(timestamp ?? 0),
      args: Object.fromEntries(Object.entries(rest).map(([k, v]) => [k, typeof v === 'object' ? JSON.stringify(v) : (v as string | number | boolean)])),
    }
  })
}

export function riskVaultFrom(v: Obj): VaultRisk {
  const pos = v.position as Obj | Amount | undefined
  return {
    ...(v as unknown as VaultRisk),
    maxRedeem: asAmount(v.maxRedeem),
    position: pos && typeof pos === 'object' && 'assets' in pos ? asAmount((pos as Obj).assets) : pos ? asAmount(pos) : undefined,
    triggers: Array.isArray(v.triggers) ? (v.triggers as unknown[]).map((t) => (typeof t === 'string' ? t : String((t as Obj).detail ?? (t as Obj).code ?? JSON.stringify(t)))) : [],
  }
}

export function bankClientFrom(c: Obj): BankClient {
  const mismatches = Array.isArray(c.mismatches) ? c.mismatches.length : Number(c.mismatches ?? 0)
  return {
    ...(c as unknown as BankClient),
    name: String(c.name ?? `Treasury ${String(c.safe).slice(0, 6)}…${String(c.safe).slice(-4)}`),
    riskScore: Number(c.riskScore ?? 0),
    pendingEscalations: Number(c.pendingEscalations ?? 0),
    mismatches,
    total: c.total ? asAmount(c.total) : c.totalValue ? asAmount(c.totalValue) : undefined,
  }
}
