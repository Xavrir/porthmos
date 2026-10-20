import type { ErrorName, Tier, WorkflowState } from './types'

export const ERRORS: Record<ErrorName, { plain: string; short: string; gate: Gate }> = {
  Unauthorized: { plain: 'The caller does not hold the role this call needs.', short: 'the caller lacks the role', gate: 'guard' },
  BadSignature: { plain: 'The signature does not recover to the authorizer. A field changed after signing, or the wrong key signed.', short: 'record edited after signing, or wrong signer', gate: 'signature' },
  WrongOp: { plain: 'The record names a different operation from the function called.', short: 'wrong operation for this call', gate: 'guard' },
  Expired: { plain: 'The record is past its expiry (120 seconds after signing).', short: 'record expired', gate: 'guard' },
  NonceUsed: { plain: 'This record was already used once. Replays are refused.', short: 'record already used once', gate: 'guard' },
  Frozen: { plain: 'The owner or the bank has frozen deposits. Exits still run.', short: 'deposits are frozen', gate: 'guard' },
  VaultQuarantined: { plain: 'The vault is quarantined after a risk trigger. Deposits are refused.', short: 'vault is quarantined', gate: 'guard' },
  PolicyVersionMismatch: { plain: 'The policy changed after the record was signed.', short: 'policy changed after signing', gate: 'guard' },
  VaultNotAllowed: { plain: 'The owner never added this vault.', short: 'vault not on the owner’s list', gate: 'guard' },
  MissingApproval: { plain: 'The tier needs a human approval that is not attached.', short: 'a human approval is missing', gate: 'guard' },
  ApprovalMismatch: { plain: 'The approval names a different Safe, operation or vault.', short: 'approval is for something else', gate: 'guard' },
  ApprovalExceeded: { plain: 'The amount is above what the owner approved.', short: 'above the approved amount', gate: 'guard' },
  ApprovalExpired: { plain: 'The owner’s approval is past its 24-hour expiry.', short: 'approval expired', gate: 'guard' },
  StaleOracle: { plain: 'The price is older than the 180-second limit.', short: 'price too old', gate: 'guard' },
  PriceOutOfBand: { plain: 'The price left the band the record was signed for.', short: 'price left the signed band', gate: 'guard' },
  BandTooWide: { plain: 'The signed price band is wider than policy allows.', short: 'price band wider than policy allows', gate: 'guard' },
  ReserveFloorBreached: { plain: 'The Safe would hold less than the reserve floor after the deposit.', short: 'would break the reserve floor', gate: 'guard' },
  DailyCapExceeded: { plain: 'Deposits today would pass the daily cap.', short: 'over the daily cap', gate: 'guard' },
  NoPosition: { plain: 'The Safe holds no shares in this vault.', short: 'no shares to redeem', gate: 'guard' },
  SlippageExceeded: { plain: 'The measured amount came in below the signed minimum.', short: 'received less than the signed minimum', gate: 'execute' },
  ExecutionFailed: { plain: 'An inner call from the Safe failed. Nothing moved.', short: 'an inner call failed', gate: 'execute' },
}

export const ERROR_NAMES = Object.keys(ERRORS) as ErrorName[]

export function isErrorName(v: unknown): v is ErrorName {
  return typeof v === 'string' && v in ERRORS
}

export type Gate = 'intent' | 'plan' | 'policy' | 'simulation' | 'signature' | 'guard' | 'execute'

export const GATES: { id: Gate; name: string; who: string; detail: string }[] = [
  { id: 'intent', name: 'Intent', who: 'Agent (no key)', detail: 'The request is parsed into a goal. The model can only choose among plans; it never writes calldata.' },
  { id: 'plan', name: 'Deterministic plan', who: 'Reserve and risk engines', detail: 'Tested code computes the reserve, the deployable amount and the default option.' },
  { id: 'policy', name: 'Policy check', who: 'Policy verifier', detail: 'Caps, allowlist, freezes and the reserve floor; the tier the contract will demand.' },
  { id: 'simulation', name: 'Simulation', who: 'Simulator', detail: 'module.check plus an eth_call from the Safe. The exact balance change is measured.' },
  { id: 'signature', name: 'Signature', who: 'Authorizer, owner, bank', detail: 'EIP-712 records: owner approval for T3, bank as well for T4, then the authorizer’s DAR.' },
  { id: 'guard', name: 'On-chain guard', who: 'Porthmos module', detail: 'Re-checks every condition at execution: signer, nonce, expiry, oracle band, floor, caps.' },
  { id: 'execute', name: 'Execute or reject', who: 'Safe', detail: 'Exact approve, deposit to the Safe, approve back to zero. Or a typed revert.' },
]

export const STATE_GATE: Partial<Record<WorkflowState, Gate>> = {
  REQUEST_RECEIVED: 'intent', INTENT_PARSED: 'intent', NEEDS_CLARIFICATION: 'intent',
  STATE_LOADED: 'plan', RISK_EVALUATED: 'plan', PLAN_OPTIONS_BUILT: 'plan', OPTION_SELECTED: 'plan', HELD: 'plan',
  PROPOSAL_VALIDATED: 'policy', POLICY_CHECKED: 'policy', POLICY_REJECTED: 'policy',
  SIMULATED: 'simulation', SIM_FAILED: 'simulation',
  AWAITING_APPROVAL: 'signature', APPROVAL_DENIED: 'signature', CORRECTION_REQUESTED: 'signature', APPROVAL_EXPIRED: 'signature',
  APPROVED: 'signature', FINAL_REVALIDATION: 'signature', DAR_SIGNED: 'signature',
  SUBMITTED: 'guard', CONFIRMED: 'execute', REVERTED: 'execute',
}

export type Verdict = 'act' | 'protect' | 'hold' | 'bank' | 'neutral'

export const STATE_LABEL: Record<WorkflowState, string> = {
  REQUEST_RECEIVED: 'Request received', INTENT_PARSED: 'Intent parsed', NEEDS_CLARIFICATION: 'Needs clarification',
  STATE_LOADED: 'State loaded', RISK_EVALUATED: 'Risk evaluated', PLAN_OPTIONS_BUILT: 'Plan options built',
  OPTION_SELECTED: 'Option selected', HELD: 'Held', PROPOSAL_VALIDATED: 'Proposal validated', POLICY_CHECKED: 'Policy checked',
  POLICY_REJECTED: 'Policy rejected', SIMULATED: 'Simulated', SIM_FAILED: 'Simulation failed', AWAITING_APPROVAL: 'Awaiting approval',
  APPROVAL_DENIED: 'Approval denied', CORRECTION_REQUESTED: 'Correction requested', APPROVAL_EXPIRED: 'Approval expired',
  APPROVED: 'Approved', FINAL_REVALIDATION: 'Final revalidation', DAR_SIGNED: 'Record signed', SUBMITTED: 'Submitted',
  CONFIRMED: 'Confirmed', REVERTED: 'Reverted', EXPLAINED: 'Explained', CANCELLED: 'Cancelled',
}

export function sentenceCase(state: string): string {
  const known = STATE_LABEL[state as WorkflowState]
  if (known) return known
  const words = state.replace(/[_-]+/g, ' ').trim().toLowerCase()
  return words.charAt(0).toUpperCase() + words.slice(1)
}

export const TIER_SHORT: Record<Tier, string> = {
  0: 'read only',
  1: 'agent alone, exits only',
  2: 'agent alone',
  3: 'owner signs',
  4: 'owner and bank sign',
}

export const CHECK_NAMES: Record<string, string> = {
  reserveFloor: 'Reserve floor kept',
  dailyCap: 'Within the daily cap',
  vaultAllowed: 'Vault on the owner’s list',
  notQuarantined: 'Vault not quarantined',
  notFrozen: 'No freeze',
  oracleFresh: 'Price is fresh',
  priceBand: 'Price inside the signed band',
  authorizerActive: 'Authorizer active',
}

export function stateVerdict(state: string): Verdict {
  switch (state) {
    case 'CONFIRMED': case 'APPROVED': case 'DAR_SIGNED': case 'SUBMITTED': case 'FINAL_REVALIDATION':
      return 'act'
    case 'REVERTED': case 'POLICY_REJECTED': case 'SIM_FAILED': case 'APPROVAL_DENIED': case 'QUARANTINED': case 'CANCELLED':
      return 'protect'
    case 'HELD': case 'AWAITING_APPROVAL': case 'NEEDS_CLARIFICATION': case 'APPROVAL_EXPIRED': case 'CORRECTION_REQUESTED':
      return 'hold'
    case 'POLICY_CHANGED':
      return 'bank'
    default:
      return 'neutral'
  }
}

export const TIERS: Record<Tier, { name: string; signers: string; when: string }> = {
  0: { name: 'Read', signers: 'No signature', when: 'Balances, risk report, explanations' },
  1: { name: 'Protective', signers: 'Authorizer or exit key', when: 'Any redemption back to the Safe' },
  2: { name: 'Routine', signers: 'Authorizer', when: 'Deposit up to the auto cap into a vault used before' },
  3: { name: 'Material', signers: 'Authorizer and owner', when: 'Above the auto cap, a first deposit, or a choice above the default plan' },
  4: { name: 'Escalated', signers: 'Authorizer, owner and bank', when: 'Above the bank limit' },
}

export const TERMINAL_STATES: WorkflowState[] = ['EXPLAINED', 'CANCELLED', 'CONFIRMED', 'REVERTED']
