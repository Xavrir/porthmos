import { getAddress, type Hex } from 'viem'
import { EVIDENCE_META, EVIDENCE_ORDER, type EvidenceOrder, type EvidenceOrderStep } from '../../replay/evidence'
import { amount } from '../format'
import type { HistoryItem, LedgerRef, OrderMilestone, OrderView, ProofView, WorkflowMilestoneState } from './types'

// TECHNICAL-DOCUMENT 05, execution evidence plan: which recorded E6 step settled which milestone index.
const STEP_INDEX: Record<string, number> = { E6b: 0, E6c: 1, E6d: 1, E6e: 2 }

function proofOf(step: EvidenceOrderStep | undefined): ProofView | null {
  if (!step || (!step.proof && !step.proofHash)) return null
  return { id: 0, proofHash: step.proofHash ?? null, proof: step.proof, source: 'recorded', receivedAt: 0 }
}

function historyOf(steps: EvidenceOrderStep[]): HistoryItem[] {
  const out: HistoryItem[] = []
  for (const s of steps) {
    let from = out.length ? out[out.length - 1].to : 'AWAITING_PROOF'
    for (const to of s.workflow) {
      out.push({ from, to, at: 0, note: s.id, requestId: s.requestId })
      from = to
    }
    if (s.id === 'E6d') out.push({ from, to: 'WAIVED', at: 0, note: 'E6d: waived by the owner', requestId: null })
  }
  return out
}

export function recordedOrder(ev: EvidenceOrder | null = EVIDENCE_ORDER): OrderView | null {
  if (!ev) return null
  const byId = Object.fromEntries(ev.steps.map((s) => [s.id, s]))
  const created = byId.E6a?.txs.find((t) => !t.reverted)
  let released = 0n
  const txs: Record<string, Hex> = {}
  const milestones: OrderMilestone[] = ev.milestones.map((m, i) => {
    const steps = ev.steps.filter((s) => STEP_INDEX[s.id] === i)
    const settle = [...steps].reverse().flatMap((s) => s.txs).find((t) => !t.reverted && (t.role === 'executor' || t.role === 'owner'))
    const waived = steps.some((s) => s.id === 'E6d') && !!settle
    const done = !!settle
    if (done) { released += BigInt(m.amount); txs[String(i)] = settle.hash }
    const held = steps.find((s) => s.workflow.includes('HELD'))
    const withProof = steps.find((s) => s.proof) ?? steps.find((s) => s.proofHash)
    const ledgerRef: LedgerRef[] = steps.flatMap((s) => s.ledger.map((r) => ({ ...r, txHash: r.txHash as Hex | null })))
    const state: WorkflowMilestoneState = waived ? 'WAIVED' : done ? 'RELEASED' : 'AWAITING_PROOF'
    return {
      index: i, amount: amount(BigInt(m.amount)), issuer: getAddress(m.issuer), kind: m.kind, kindName: m.kindName, requireDoc: m.requireDoc, checkTemp: m.checkTemp,
      minTempCenti: m.minTempCenti, maxTempCenti: m.maxTempCenti, deadline: m.deadline,
      status: waived ? 'WAIVED' : done ? 'RELEASED' : 'PENDING', state, reason: held ? held.ledger.find((r) => r.reason)?.reason ?? 'ConditionNotMet' : null,
      requestId: steps.find((s) => s.requestId)?.requestId ?? null, proof: proofOf(withProof),
      explanation: (held ?? steps.find((s) => s.explanation))?.explanation ?? null, history: historyOf(steps), ledgerRef,
    }
  })
  const attacks = ev.steps.filter((s) => s.id === 'E6f' || s.id === 'E6g' || s.id === 'E6c')
    .flatMap((s) => s.txs.filter((t) => t.reverted).map((t) => ({ id: s.id, label: t.label, hash: t.hash, error: t.error ?? undefined })))
  return {
    order: {
      orderId: ev.orderId, buyer: getAddress(ev.buyer), supplier: getAddress(ev.supplier), createdAt: 0, nextIndex: Math.min(3, milestones.filter((m) => m.status !== 'PENDING').length),
      status: ev.orderStatus === 'COMPLETED' ? 'COMPLETED' : 'ACTIVE', total: amount(BigInt(ev.total)), released: amount(released), termsHash: ev.termsHash,
    },
    milestones,
    transactions: { created: created?.hash ?? null, refund: null, milestones: txs },
    view: 'full',
    served: true,
    recorded: { network: EVIDENCE_META.network, terms: ev.terms, attacks, holdTx: byId.E6c?.txs[0]?.hash },
  }
}

export function recordedBlock(hash: Hex | null | undefined): number | null {
  if (!hash || !EVIDENCE_ORDER) return null
  for (const s of EVIDENCE_ORDER.steps) for (const t of s.txs) if (t.hash.toLowerCase() === hash.toLowerCase()) return t.block
  return null
}
