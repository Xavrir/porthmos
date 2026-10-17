import { recoverTypedDataAddress, type Address, type Hex } from 'viem'
import type { SignedRecord, TypedDataPayload } from './types'

export const APPROVAL_TYPES = {
  Approval: [
    { name: 'safe', type: 'address' },
    { name: 'op', type: 'uint8' },
    { name: 'vault', type: 'address' },
    { name: 'maxAmount', type: 'uint256' },
    { name: 'policyVersion', type: 'uint64' },
    { name: 'approvalExpiry', type: 'uint64' },
    { name: 'approvalNonce', type: 'uint256' },
  ],
} as const

export const DAR_TYPES = {
  DAR: [
    { name: 'safe', type: 'address' },
    { name: 'op', type: 'uint8' },
    { name: 'vault', type: 'address' },
    { name: 'amount', type: 'uint256' },
    { name: 'minOut', type: 'uint256' },
    { name: 'policyVersion', type: 'uint64' },
    { name: 'priceLow', type: 'int256' },
    { name: 'priceHigh', type: 'int256' },
    { name: 'tier', type: 'uint8' },
    { name: 'approvalHash', type: 'bytes32' },
    { name: 'nonce', type: 'uint256' },
    { name: 'expiry', type: 'uint64' },
    { name: 'evidenceHash', type: 'bytes32' },
  ],
} as const

export function aegisDomain(chainId: number, module: Address) {
  return { name: 'AegisModule', version: '1', chainId, verifyingContract: module } as const
}

const BIG_FIELDS = new Set(['orderId', 'maxAmount', 'approvalNonce', 'amount', 'minOut', 'priceLow', 'priceHigh', 'nonce', 'policyVersion', 'approvalExpiry', 'expiry'])

export function toViemMessage(message: Record<string, string | number>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(message)) out[k] = BIG_FIELDS.has(k) ? BigInt(v) : k === 'op' || k === 'tier' ? Number(v) : v
  return out
}

export function typedDataFor(record: Pick<SignedRecord, 'primaryType' | 'message'>, chainId: number, module: Address): TypedDataPayload {
  const types = record.primaryType === 'DAR' ? DAR_TYPES : APPROVAL_TYPES
  return {
    domain: aegisDomain(chainId, module),
    types: types as unknown as TypedDataPayload['types'],
    primaryType: record.primaryType,
    message: record.message,
  }
}

export async function recoverSigner(payload: TypedDataPayload, signature: Hex): Promise<Address | null> {
  try {
    const args = { domain: payload.domain, types: payload.types, primaryType: payload.primaryType, message: toViemMessage(payload.message), signature }
    return await recoverTypedDataAddress(args as unknown as Parameters<typeof recoverTypedDataAddress>[0])
  } catch {
    return null
  }
}

export const DAR_FIELD_NOTES: Record<string, string> = {
  safe: 'The treasury. Funds can only move between it and owner-added vaults.',
  op: '0 deposit, 1 redeem. Nothing else can be expressed.',
  vault: 'Must be on the owner’s allowlist and not quarantined.',
  amount: 'Raw units: 6 decimals for USDC, shares for a redeem.',
  minOut: 'Smallest measured result accepted, or the call reverts.',
  policyVersion: 'Must equal the registry’s version at execution.',
  priceLow: 'Oracle price must sit inside this band at execution.',
  priceHigh: 'Band width is capped by policy (0.02).',
  tier: 'Can raise the tier the contract derives, never lower it.',
  approvalHash: 'Binds the owner’s (and bank’s) approval to this record.',
  nonce: 'Random 256-bit value. Used once.',
  expiry: '120 seconds after signing, shorter than the 180-second oracle limit.',
  evidenceHash: 'Hash of the inputs the plan used, including the obligation schedule.',
  maxAmount: 'The most the authorizer may deposit under this approval.',
  approvalExpiry: '24 hours after the owner signs.',
  approvalNonce: 'Used once, then marked on-chain.',
}
