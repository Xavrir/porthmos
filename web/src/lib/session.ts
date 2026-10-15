import { getAddress, type Address } from 'viem'

export function sessionMessage(role: 'owner' | 'bank', address: Address, chainId: number, issuedAt: string): string {
  return `AEGIS session\nrole: ${role}\naddress: ${getAddress(address)}\nchainId: ${chainId}\nissuedAt: ${issuedAt}`
}
