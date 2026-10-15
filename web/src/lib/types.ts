import type { Address, Hex } from 'viem'

export type Amount = { raw: string; display: string }

export type Role = 'owner' | 'bank'

export type WorkflowState =
  | 'REQUEST_RECEIVED' | 'INTENT_PARSED' | 'NEEDS_CLARIFICATION' | 'STATE_LOADED' | 'RISK_EVALUATED'
  | 'PLAN_OPTIONS_BUILT' | 'OPTION_SELECTED' | 'HELD' | 'PROPOSAL_VALIDATED' | 'POLICY_CHECKED'
  | 'POLICY_REJECTED' | 'SIMULATED' | 'SIM_FAILED' | 'AWAITING_APPROVAL' | 'APPROVAL_DENIED'
  | 'CORRECTION_REQUESTED' | 'APPROVAL_EXPIRED' | 'APPROVED' | 'FINAL_REVALIDATION' | 'DAR_SIGNED'
  | 'SUBMITTED' | 'CONFIRMED' | 'REVERTED' | 'EXPLAINED' | 'CANCELLED'

export type ErrorName =
  | 'Unauthorized' | 'BadSignature' | 'WrongOp' | 'Expired' | 'NonceUsed' | 'Frozen' | 'VaultQuarantined'
  | 'PolicyVersionMismatch' | 'VaultNotAllowed' | 'MissingApproval' | 'ApprovalMismatch' | 'ApprovalExceeded'
  | 'ApprovalExpired' | 'StaleOracle' | 'PriceOutOfBand' | 'BandTooWide' | 'ReserveFloorBreached'
  | 'DailyCapExceeded' | 'NoPosition' | 'SlippageExceeded' | 'ExecutionFailed'

export type Tier = 0 | 1 | 2 | 3 | 4
export type Op = 'DEPOSIT' | 'REDEEM'

export type Health = {
  ok: boolean
  chainId?: number
  mode?: string
  llm?: string
  demo?: boolean
  version?: string
  llmMode?: string
  agentMode?: string
  onboardingOpen?: boolean
  tenants?: number
}

export type Session = { token: string; role: Role; safe?: Address; expiresAt?: number }

export type VaultPosition = {
  address: Address
  name: string
  shares: Amount
  assets: Amount
  everDeposited?: boolean
  quarantined?: boolean
  allowed?: boolean
}

export type TreasuryState = {
  safe: Address
  balances: { safeUsdc: Amount; vaults: VaultPosition[]; total: Amount }
  reserve: { required: Amount; onchainFloor: Amount; inSync: boolean; scheduleHash?: Hex; buffer?: Amount }
  deployable: Amount
  fees?: Amount
  depositedToday?: Amount
  policy: {
    autoCap: Amount
    dailyCap: Amount
    bankLimit: Amount
    frozen: { owner: boolean; bank: boolean }
    version: number
    maxBandWidth?: string
    maxOracleAge?: number
    authorizerRevoked?: boolean
  }
  updatedAt?: number
}

export type Obligation = {
  id: string
  label: string
  amount: Amount
  dueDate: string
  confirmedInflow?: boolean
  settled?: boolean
}

export type TxRequest = { to: Address; data: Hex; value: string }

export type ObligationCreated = { obligation: Obligation; floorUpdate: TxRequest }

export type RiskComponents = { peg: number; liquidity: number; utilisation: number; concentration: number }

export type VaultRisk = {
  address: Address
  name: string
  score: number
  components: RiskComponents
  triggers: string[]
  quarantined: boolean
  quarantinedAt?: number
  maxRedeem: Amount
  position?: Amount
}

export type RiskReport = { vaults: VaultRisk[]; updatedAt?: number }

export type OracleState = {
  price: Amount
  updatedAt: number
  ageSeconds: number
  stale: boolean
  maxOracleAge?: number
  history?: { t: number; price: number }[]
}

export type PolicyCheck = { name: string; ok: boolean; detail: string }

export type TypedDataPayload = {
  domain: { name: string; version: string; chainId: number; verifyingContract: Address }
  types: Record<string, { name: string; type: string }[]>
  primaryType: string
  message: Record<string, string | number>
}

export type ActionCard = {
  requestId: string
  op: Op
  vault: { address: Address; name: string }
  amount: Amount
  tier: Tier
  requiredSigners: ('authorizer' | 'exitKey' | 'owner' | 'bank')[]
  reason: string
  reserveAfter: Amount
  simulation: { ok: boolean; sharesOut?: Amount; assetsOut?: Amount; error?: ErrorName }
  policyChecks: PolicyCheck[]
  approvalTypedData?: TypedDataPayload
}

export type ChatResponse = { reply: string; requestId: string; state: WorkflowState; actionCard?: ActionCard }

export type StateTransition = { state: WorkflowState; at: number; note?: string }

export type SignedRecord = {
  primaryType: 'DAR' | 'Approval'
  message: Record<string, string | number>
  signature: Hex | null
  signer: Address | null
  digest?: Hex
  replayUnsigned?: boolean
  signatureWithheld?: boolean
}

export type RequestRecord = {
  id: string
  createdAt: number
  message: string
  origin: 'owner' | 'exit_agent' | 'attack_script' | 'bank'
  state: WorkflowState
  history: StateTransition[]
  actionCard?: ActionCard
  dar?: SignedRecord
  approvals?: SignedRecord[]
  txHash?: Hex
  revertReason?: ErrorName
  explanation?: string
  options?: { id: string; label: string; legs: { vault: string; amount: string }[]; isDefault?: boolean; chosen?: boolean }[]
}

export type PendingApproval = {
  requestId: string
  role: Role
  safe: Address
  client?: string
  actionCard: ActionCard
  createdAt: number
  expiresAt: number
}

export type LedgerRow = {
  seq: number
  ts: number
  requestId?: string
  kind: 'execution' | 'rejection' | 'hold' | 'denial' | 'policy' | 'risk' | 'obligation' | 'injection' | 'cancel'
  state: WorkflowState | 'POLICY_CHANGED' | 'QUARANTINED'
  summary: string
  op?: Op
  vault?: string
  amount?: Amount
  tier?: Tier
  txHash?: Hex
  revertReason?: ErrorName
  evidenceHash?: Hex
  prevHash: Hex
  rowHash: Hex
  linkOk?: boolean
}

export type ChainEventName = 'AegisExecuted' | 'PolicyChanged' | 'Quarantined'

export type ChainEvent = {
  name: ChainEventName
  blockNumber: number
  txHash: Hex
  logIndex: number
  timestamp: number
  args: Record<string, string | number | boolean>
}

export type BankClient = {
  safe: Address
  name: string
  riskScore: number
  frozen: { owner: boolean; bank: boolean }
  authorizerRevoked?: boolean
  pendingEscalations: number
  mismatches: number
  total?: Amount
  policyVersion?: number
  lastActivity?: number
}

export type ReconciliationRow = {
  key: string
  ledger?: { seq: number; summary: string; amount?: Amount; txHash?: Hex; hashOk: boolean }
  chain?: { name: ChainEventName; txHash: Hex; blockNumber: number; amount?: Amount }
  status: 'match' | 'amount-mismatch' | 'missing-in-ledger' | 'missing-on-chain' | 'hash-broken'
}

export type ScenarioName = 'depeg' | 'liquidity' | 'stale' | 'obligation' | 'restore'

export type StreamEvent =
  | { type: 'state'; data: { requestId: string; state: WorkflowState; note?: string } }
  | { type: 'ledger'; data: LedgerRow }
  | { type: 'risk'; data: RiskReport }
  | { type: 'oracle'; data: OracleState }
  | { type: 'execution'; data: ChainEvent }
  | { type: 'policy'; data: { version: number; frozen: { owner: boolean; bank: boolean } } }
  | { type: 'treasury'; data: TreasuryState }
  | { type: 'notice'; data: { level: 'info' | 'alert'; text: string } }
