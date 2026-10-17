import type { Tone } from '../../components/bits'
import { MILESTONES, tempRange } from './model'
import type { OrderMilestone, OrderStatus, OrderView, ProofFields } from './types'

export type MilestoneDisplay = 'pending' | 'waiting' | 'releasing' | 'held' | 'released' | 'waived' | 'refunded'

export const MILESTONE_LABEL: Record<MilestoneDisplay, string> = {
  pending: 'Pending', waiting: 'Waiting', releasing: 'Releasing', held: 'Held', released: 'Released', waived: 'Waived', refunded: 'Refunded',
}

export const MILESTONE_TONE: Record<MilestoneDisplay, Tone> = {
  pending: 'neutral', waiting: 'info', releasing: 'info', held: 'held', released: 'ok', waived: 'ok', refunded: 'refused',
}

const IN_FLIGHT = new Set(['PROOF_RECEIVED', 'PROOF_VERIFIED', 'RELEASE_SIGNED', 'RELEASE_SUBMITTED', 'RELEASE_FAILED'])

// The chain status is final; the service's workflow state only refines a milestone the chain still shows PENDING.
export function milestoneDisplay(m: Pick<OrderMilestone, 'status' | 'state'>): MilestoneDisplay {
  if (m.status === 'RELEASED') return 'released'
  if (m.status === 'WAIVED') return 'waived'
  if (m.status === 'REFUNDED') return 'refunded'
  switch (m.state) {
    case 'HELD': return 'held'
    case 'WAITING': return 'waiting'
    case 'RELEASED': case 'WAIVED': return 'releasing'
    case 'REFUNDED': return 'refunded'
    default: return m.state && IN_FLIGHT.has(m.state) ? 'releasing' : 'pending'
  }
}

export type OrderDisplay = 'active' | 'completed' | 'refunded'

export const ORDER_LABEL: Record<OrderDisplay, string> = { active: 'Active', completed: 'Completed', refunded: 'Refunded' }
export const ORDER_TONE: Record<OrderDisplay, Tone> = { active: 'info', completed: 'ok', refunded: 'refused' }

export function orderDisplay(status: OrderStatus): OrderDisplay {
  return status === 'COMPLETED' ? 'completed' : status === 'REFUNDED' ? 'refunded' : 'active'
}

export const REASON_TEXT: Record<string, string> = {
  ConditionNotMet: 'The signed proof fails a condition of the order.',
  BadProofTime: 'The proof’s issue time is outside the order’s window.',
  DeadlinePassed: 'The milestone deadline has passed. A release needs your confirmation.',
  Frozen: 'The treasury is frozen. It resumes on unfreeze.',
  OutOfOrder: 'An earlier milestone is not paid yet.',
  AuthorizerNotCurrent: 'This service is not the treasury’s current Authorizer.',
  OrderNotActive: 'The order is no longer active.',
  ActiveOrderLimit: 'The order is beyond the active-order limit, so the service does not serve it.',
}

export function reasonText(reason: string | null | undefined): string {
  if (!reason) return ''
  if (reason.startsWith('ReleaseFailed:')) return `The release failed on-chain with ${reason.slice(14)}.`
  return REASON_TEXT[reason] ?? reason
}

export const PROPOSAL_TEXT: Record<string, string> = {
  REQUEST_RESURVEY: 'Ask the surveyor to inspect the goods, then waive if they are acceptable.',
  WAIT_FOR_CORRECTED_PROOF: 'Wait for a corrected proof from the issuer. It needs your confirmation.',
  WAIVE: 'Waive the condition and pay the supplier.',
  REFUND_AFTER_DEADLINE: 'Refund the unreleased funds to your treasury.',
  NO_ACTION: 'No action needed.',
}

export type CheckResult = { name: string; ok: boolean; detail: string }

// The deterministic condition checks (TECHNICAL-DOCUMENT 04, release check 7), recomputed from the signed proof for display.
export function conditionChecks(m: Pick<OrderMilestone, 'requireDoc' | 'checkTemp' | 'minTempCenti' | 'maxTempCenti'>, p: ProofFields): CheckResult[] {
  const out: CheckResult[] = []
  if (m.requireDoc) {
    const present = !!p.docHash && !/^0x0{64}$/i.test(p.docHash)
    out.push({ name: 'Document hash', ok: present, detail: present ? 'Present' : 'Missing' })
  }
  if (m.checkTemp) {
    const ok = p.samples > 0 && p.minTempCenti <= p.maxTempCenti && p.minTempCenti >= m.minTempCenti && p.maxTempCenti <= m.maxTempCenti
    out.push({ name: 'Temperature', ok, detail: p.samples > 0 ? `${tempRange(p.minTempCenti, p.maxTempCenti)} over ${p.samples} samples, allowed ${tempRange(m.minTempCenti, m.maxTempCenti)}` : 'No samples' })
  }
  return out
}

export function nextMilestone(o: OrderView): OrderMilestone | null {
  return o.order.status === 'ACTIVE' ? o.milestones[o.order.nextIndex] ?? null : null
}

export function heldCount(o: OrderView): number {
  return o.milestones.filter((m) => milestoneDisplay(m) === 'held').length
}

export function committedRaw(o: OrderView): bigint {
  return o.order.status === 'ACTIVE' ? BigInt(o.order.total.raw) - BigInt(o.order.released.raw) : 0n
}

export function milestoneSpec(index: number) {
  return MILESTONES[index] ?? MILESTONES[0]
}

export function orderLabel(id: string | number): string {
  return `Order ${id}`
}
