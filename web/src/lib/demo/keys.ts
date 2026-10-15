import type { Hex } from 'viem'

// Public Anvil test accounts 1 (owner) and 2 (bank) from docs/INTERFACES.md §1.6.
// They are published with every Foundry install and must never hold value or be used off chain 31337.
export const ANVIL_DEMO_KEYS: Record<'owner' | 'bank', Hex> = {
  owner: '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d',
  bank: '0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a',
}
