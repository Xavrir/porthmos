import type { Address, Hex } from 'viem'

export type OnboardConfig = {
  chainId: number
  rpcUrl: string
  explorer: string
  safeSingleton: Address
  safeProxyFactory: Address
  fallbackHandler: Address
  registry: Address
  module: Address
  usdc: Address
  priceFeed: Address
  vaults: { address: Address; name: string }[]
  operator: { authorizer: Address; exitKey: Address; executor: Address; keeper: Address }
  // reserveFloor and scheduleHash: the reserve of an empty schedule, written at sign-up so the floor starts in sync.
  params: { autoCap: string; dailyCap: string; bankLimit: string; maxBandWidth: string; maxOracleAge: number | string; reserveFloor: string; scheduleHash: Hex }
  paramBounds: Record<string, string | number>
  ethOwner: string
  ethBank: string
  testUsdc: string
  referenceSafe: Address
  onboardingOpen: boolean
}

export type OnboardSteps = {
  funded: boolean
  safeDeployed: boolean
  moduleEnabled: boolean
  registered: boolean
  vaults: boolean
  authorizer: boolean
  exitKey: boolean
  caps: boolean
  reserveFloor: boolean
  bankLimit: boolean
  activated: boolean
}

export type OnboardStatus = { safe: Address | null; steps: OnboardSteps }

export type FundResult = { txs: { address: Address; hash: Hex; amountWei: string; pending?: boolean }[] }

export type ActivateResult = { safe: Address; mintTx: Hex | null; tenant?: unknown; session?: { token: string; role: 'owner'; address: Address; safe: Address; expiresAt: number } }

export type AttackKind = 'tampered' | 'replay'

export type AttackResult = { kind: AttackKind; txHash: Hex; reverted: boolean; error: string; blockNumber?: number }

export type MarketState = { active: boolean; scenario: string | null; label: string; detail: string | null; since: number | null }
