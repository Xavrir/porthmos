import type { Address, Hex } from 'viem'
import type { Amount } from '../types'

export type OrderStatus = 'NONE' | 'ACTIVE' | 'COMPLETED' | 'REFUNDED'
export type ChainMilestoneStatus = 'PENDING' | 'RELEASED' | 'WAIVED' | 'REFUNDED'
export type WorkflowMilestoneState =
  | 'AWAITING_PROOF' | 'PROOF_RECEIVED' | 'PROOF_VERIFIED' | 'RELEASE_SIGNED' | 'RELEASE_SUBMITTED' | 'RELEASED'
  | 'RELEASE_FAILED' | 'WAITING' | 'HELD' | 'WAIVED' | 'REFUNDED'

export type ProofFields = {
  orderId: string
  index: number
  kind: number
  docHash: Hex
  minTempCenti: number
  maxTempCenti: number
  samples: number
  issuedAt: string
}

export type ProofView = {
  id: number
  proofHash: Hex | null
  proof: ProofFields | null
  issuerSignature?: Hex
  source: string
  documentHash?: Hex | null
  receivedAt: number
}

export type Explanation = { text: string; proposal: 'REQUEST_RESURVEY' | 'WAIT_FOR_CORRECTED_PROOF' | 'WAIVE' | 'REFUND_AFTER_DEADLINE' | 'NO_ACTION' | string; source: string }

export type Resolution = {
  orderId: string
  index: number
  canWaive: boolean
  canRefund: boolean
  refundAfter: number | null
  confirmation: { orderId: string; index: number; proofHash: Hex; expiry: number } | null
}

export type HistoryItem = { from: string; to: string; at: number; note: string; requestId: string | null }

export type LedgerRef = { ledgerId: number; kind: string; rowHash: string; prevHash: string; txHash: Hex | null; requestId: string | null; reason?: string | null }

export type OrderMilestone = {
  index: number
  amount: Amount
  issuer: Address
  kind: number
  kindName?: string
  requireDoc: boolean
  checkTemp: boolean
  minTempCenti: number
  maxTempCenti: number
  deadline: number
  status: ChainMilestoneStatus
  state?: WorkflowMilestoneState
  reason?: string | null
  requestId?: string | null
  proof?: ProofView | null
  pendingProof?: ProofView | null
  proofs?: ProofView[]
  explanation?: Explanation | null
  waitingOn?: Record<string, unknown> | null
  resigns?: number
  resolution?: Resolution
  history?: HistoryItem[]
  ledgerRef?: LedgerRef[]
}

export type OrderView = {
  order: {
    orderId: string
    buyer: Address
    supplier: Address
    createdAt: number
    nextIndex: number
    status: OrderStatus
    total: Amount
    released: Amount
    termsHash: Hex
  }
  milestones: OrderMilestone[]
  transactions: { created: Hex | null; refund: Hex | null; milestones: Record<string, Hex> }
  view: 'public' | 'full'
  served?: boolean
  obligationId?: string | null
  orderLedgerRef?: LedgerRef[]
  recorded?: RecordedContext
}

export type RecordedContext = {
  network: string
  terms: string
  attacks: { id: string; label: string; hash: Hex; error?: string }[]
  holdTx?: Hex
}

export type TradeFlowConfig = {
  enabled: boolean
  chainId?: number
  tradeEscrow?: Address
  multiSendCallOnly?: Address
  token?: Address
  issuers?: Partial<Record<'carrier' | 'sensor' | 'surveyor', Address>>
  demoIssuers?: Partial<Record<'carrier' | 'sensor' | 'surveyor', boolean>>
  limits?: Record<string, number>
}

export type DemoVariant = 'valid' | 'outOfRange' | 'corrected'

export type ProofResult = { admitted: boolean; orderId: string; index: number; proofHash: Hex; requestId: string | null; state: WorkflowMilestoneState; reason: string | null; awaitingConfirmation?: boolean }
