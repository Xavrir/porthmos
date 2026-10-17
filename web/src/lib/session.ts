import { getAddress, type Address } from 'viem'

export function sessionMessage(role: 'owner' | 'bank', address: Address, chainId: number, issuedAt: string): string {
  return `AEGIS session\nrole: ${role}\naddress: ${getAddress(address)}\nchainId: ${chainId}\nissuedAt: ${issuedAt}`
}

export const ISSUED_AT_PLACEHOLDER = 'the time you press Sign in'

export function sessionPreview(role: 'owner' | 'bank', address: Address, chainId: number): string {
  return sessionMessage(role, address, chainId, ISSUED_AT_PLACEHOLDER)
}
