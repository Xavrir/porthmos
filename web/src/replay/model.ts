import { keccak256, toHex, type Address, type Hex } from 'viem'
import { placeholderTx, recordedSlot } from './hashes'
import type { ChainEvent, LedgerRow, Obligation, RequestRecord } from '../lib/types'
import { REPLAY_DEPLOYMENT } from './recorded'

export const D = REPLAY_DEPLOYMENT
export const EPOCH = Date.parse('2026-10-15T06:00:00Z') / 1000

// E1 sits at its recorded block and time; every other replay event gets a block that keeps 2-second spacing from it.
export const E1_TS = Date.parse('2026-10-14T17:16:54Z') / 1000
const E1_BLOCK = recordedSlot('e1-deposit')?.block ?? 48114963
export const E1_DAR_HASH = (recordedSlot('e1-deposit')?.darHash ?? keccak256(toHex('aegis-replay-dar:e1'))) as Hex
export const blockAt = (ts: number) => E1_BLOCK + Math.round((ts - E1_TS) / 2)
export const ZERO_HASH = ('0x' + '0'.repeat(64)) as Hex

export const at = (iso: string) => Date.parse(iso) / 1000
export const txHash = (label: string) => placeholderTx(label)

export type VaultKey = 'A' | 'B'

export type VaultModel = {
  key: VaultKey
  address: Address
  name: string
  shares: number
  sharePrice: number
  everDeposited: boolean
  quarantined: boolean
  quarantinedAt?: number
  maxRedeemCap: number
  utilisation: number
  allowed: boolean
}

export type ClientModel = {
  safe: Address
  name: string
  riskScore: number
  frozen: { owner: boolean; bank: boolean }
  authorizerRevoked: boolean
  total: number
  policyVersion: number
  lastActivity: number
  mismatches: number
}

export type PendingModel = {
  requestId: string
  role: 'owner' | 'bank'
  safe: Address
  client: string
  createdAt: number
  expiresAt: number
}

export type Model = {
  safeUsdc: number
  vaults: Record<VaultKey, VaultModel>
  floor: number
  fees: number
  policy: { autoCap: number; dailyCap: number; bankLimit: number; version: number; frozen: { owner: boolean; bank: boolean }; authorizerRevoked: boolean; maxBandWidth: number; maxOracleAge: number }
  depositedToday: number
  oracle: { price: number; keeperStoppedAt: number | null; frozenUpdatedAt: number | null; history: { t: number; price: number }[] }
  obligations: Obligation[]
  requests: Record<string, RequestRecord>
  ledger: LedgerRow[]
  events: ChainEvent[]
  clients: ClientModel[]
  pending: PendingModel[]
  block: number
  scenario: string | null
}

function priceNoise(i: number) {
  const s = Math.sin(i * 12.9898) * 43758.5453
  return (s - Math.floor(s) - 0.5) * 0.0004
}

export function seedHistory(): { t: number; price: number }[] {
  const out: { t: number; price: number }[] = []
  for (let i = 90; i >= 1; i--) out.push({ t: EPOCH - i * 60, price: 1 + priceNoise(i) })
  out.push({ t: EPOCH, price: 1.0001 })
  return out
}

export function hashRow(prev: Hex, row: Omit<LedgerRow, 'prevHash' | 'rowHash'>): Hex {
  return keccak256(toHex(prev + JSON.stringify(row)))
}
