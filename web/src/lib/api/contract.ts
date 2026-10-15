import type { Address, Hex } from 'viem'
import type {
  BankClient, ChainEvent, ChatResponse, Health, LedgerRow, Obligation, ObligationCreated, OracleState,
  PendingApproval, ReconciliationRow, RequestRecord, RiskReport, Role, ScenarioName, Session, StreamEvent, TreasuryState,
} from '../types'

export type Mode = 'live' | 'replay'
export type StreamStatus = 'connecting' | 'open' | 'closed'

export type NewObligation = { label: string; amount: string; dueDate: string; confirmedInflow?: boolean }

export type ApprovalSubmission = { signature: Hex; approval: Record<string, string | number> }

// Replay only: an approval submitted without any signature, shown everywhere as simulated.
export const REPLAY_SIMULATED_SIGNATURE = '0x' as Hex

export type BankAction = 'bankFreeze' | 'bankUnfreeze' | 'revokeAuthorizer'

export type SessionProof = { signature: Hex; issuedAt: string }

export interface AegisApi {
  readonly mode: Mode
  setSession(token: string | null): void
  health(): Promise<Health>
  createSession(role: Role, address: Address, proof?: SessionProof): Promise<Session>
  treasury(): Promise<TreasuryState>
  obligations(): Promise<Obligation[]>
  addObligation(input: NewObligation): Promise<ObligationCreated>
  settleObligation(id: string): Promise<unknown>
  risk(): Promise<RiskReport>
  oracle(): Promise<OracleState>
  chat(message: string): Promise<ChatResponse>
  request(id: string): Promise<RequestRecord>
  submitApproval(id: string, body: ApprovalSubmission): Promise<unknown>
  deny(id: string, reason: string): Promise<unknown>
  correct(id: string, message: string): Promise<unknown>
  pendingApprovals(): Promise<PendingApproval[]>
  ledger(safe?: Address): Promise<LedgerRow[]>
  events(safe?: Address): Promise<ChainEvent[]>
  bankClients(): Promise<BankClient[]>
  scenario(name: ScenarioName): Promise<unknown>
  stream(onEvent: (e: StreamEvent) => void, onStatus: (s: StreamStatus) => void): () => void
  reconciliation?(safe: Address): Promise<ReconciliationRow[]>
  simulateBankAction?(action: BankAction, safe: Address, actor: Address): Promise<void>
  simulateFloorUpdate?(actor: Address): Promise<void>
  recordedApproval?(requestId: string): Promise<{ signature: Hex; signer: Address } | null>
  reset?(): void
  isChanged?(): boolean
}

export class ApiError extends Error {
  constructor(message: string, readonly status: number, readonly body?: unknown) {
    super(message)
  }
}
