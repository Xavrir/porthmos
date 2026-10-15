import type { Address } from 'viem'
import { REPLAY_DEPLOYMENT } from '../replay/recorded'

export type Deployment = {
  chainId: number
  usdc: Address
  priceFeed: Address
  vaultA: Address
  vaultB: Address
  registry: Address
  module: Address
  safe: Address
  safeSingleton?: Address
  safeProxyFactory?: Address
  roles: { owner: Address; bank: Address; authorizer: Address; exitKey: Address; executor: Address; keeper: Address }
  params?: Record<string, string | number>
}

export const REPLAY_DEPLOY: Deployment = {
  ...(REPLAY_DEPLOYMENT as unknown as Deployment),
  params: { autoCap: '1000000000', dailyCap: '5000000000', bankLimit: '3000000000', reserveFloor: '4500000000', maxBandWidth: '2000000', maxOracleAge: 180 },
}

export async function loadDeployment(chainId: number): Promise<Deployment | null> {
  try {
    const res = await fetch(`/deployments/${chainId}.json`, { cache: 'no-store' })
    if (!res.ok) return null
    const json = (await res.json()) as Deployment
    return json && json.module ? json : null
  } catch {
    return null
  }
}

export const REGISTRY_ABI = [
  { type: 'function', name: 'bankFreeze', stateMutability: 'nonpayable', inputs: [{ name: 'safe', type: 'address' }], outputs: [] },
  { type: 'function', name: 'bankUnfreeze', stateMutability: 'nonpayable', inputs: [{ name: 'safe', type: 'address' }], outputs: [] },
  { type: 'function', name: 'revokeAuthorizer', stateMutability: 'nonpayable', inputs: [{ name: 'safe', type: 'address' }], outputs: [] },
] as const
