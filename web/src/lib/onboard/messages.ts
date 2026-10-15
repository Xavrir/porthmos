import { getAddress, type Address } from 'viem'

export { sessionMessage } from '../session'

export function onboardingMessage(owner: Address, bank: Address, chainId: number, issuedAt: string): string {
  return `AEGIS onboarding\nowner: ${getAddress(owner)}\nbank: ${getAddress(bank)}\nchainId: ${chainId}\nissuedAt: ${issuedAt}`
}
