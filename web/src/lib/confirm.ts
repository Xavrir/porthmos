import type { PendingConfirmation, ReplyMode } from './types'

export type ConfirmChoice = 'confirm' | 'cancel'

export type ConfirmStatus = 'open' | 'expired' | 'superseded' | ConfirmChoice

export function proposalText(p: PendingConfirmation): string {
  return p.op === 'REDEEM'
    ? `Redeem ${p.amount.display} USDC from ${p.vault.name}`
    : `Deposit ${p.amount.display} USDC into ${p.vault.name}`
}

export function confirmStatus(p: PendingConfirmation, opts: { used?: ConfirmChoice; latest: boolean; now: number }): ConfirmStatus {
  if (opts.used) return opts.used
  if (!opts.latest) return 'superseded'
  if (p.expiresAt !== undefined && opts.now >= p.expiresAt) return 'expired'
  return 'open'
}

export function confirmRequest(choice: ConfirmChoice, p: PendingConfirmation): { message: string; requestId: string } {
  return { message: choice, requestId: p.requestId }
}

export function countdown(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

export const STATUS_TEXT: Record<Exclude<ConfirmStatus, 'open'>, string> = {
  confirm: 'You confirmed. The result is in the next reply.',
  cancel: 'You cancelled. Nothing was submitted.',
  expired: 'This proposal expired. Ask again for a fresh one.',
  superseded: 'Closed: a newer message followed this proposal.',
}

export const REPLY_MODE: Record<ReplyMode, { label: string; title: string }> = {
  llm: { label: 'LLM', title: 'Written by the LLM from verified facts' },
  deterministic: { label: 'Rules', title: 'Fixed template, no LLM' },
}

// ReadOnly is the normal outcome of a question, so it gets no label.
const HOLD_TEXT: Record<string, string | null> = {
  ReadOnly: null,
  AwaitingConfirmation: 'Waiting for your confirmation',
  SuspiciousRequest: 'Refused: the message looked like an injection',
  NothingToConfirm: 'Nothing open to confirm',
  NothingDeployable: 'No free cash to deploy',
  WithinBand: 'Reserve already in range',
  Frozen: 'Deposits are frozen',
  StaleOracle: 'Price feed is stale',
  PegDeviation: 'USDC is off its peg',
  FloorOutOfSync: 'On-chain floor is out of date',
  NotRepresentable: 'Transfers out are not allowed',
  AwaitingObligationConfirmation: 'Waiting for you to confirm the payment',
  PlanPrefersRedemption: 'The plan prefers a redemption',
  NoMatchingOption: 'No plan option matches the request',
  InvalidSelection: 'The selection failed validation',
  OwnerCorrectedToHold: 'You changed it to hold',
  Hold: 'Held',
}

export function holdText(reason: string | undefined): string | null {
  if (!reason) return null
  if (reason in HOLD_TEXT) return HOLD_TEXT[reason]
  const words = reason.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase()
  return words.charAt(0).toUpperCase() + words.slice(1)
}
