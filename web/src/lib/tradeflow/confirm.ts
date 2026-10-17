import { getAddress, type Address, type Hex } from 'viem'
import type { TypedDataPayload } from '../types'

export const CONFIRMATION_TYPES = {
  ReleaseConfirmation: [
    { name: 'orderId', type: 'uint256' },
    { name: 'index', type: 'uint8' },
    { name: 'proofHash', type: 'bytes32' },
    { name: 'expiry', type: 'uint64' },
  ],
}

export type Confirmation = { orderId: string; index: number; proofHash: Hex; expiry: number }

// Owner ReleaseConfirmation (TECHNICAL-DOCUMENT 04, C8): TradeEscrow domain, verified only by the Authorizer.
export function confirmationPayload(chainId: number, escrow: Address, c: Confirmation): TypedDataPayload {
  return {
    domain: { name: 'TradeEscrow', version: '1', chainId, verifyingContract: getAddress(escrow) },
    types: CONFIRMATION_TYPES,
    primaryType: 'ReleaseConfirmation',
    message: { orderId: c.orderId, index: c.index, proofHash: c.proofHash, expiry: String(c.expiry) },
  }
}
