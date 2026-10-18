import { parseAbi, zeroAddress, type Address } from 'viem'
import type { OnboardConfig } from './onboard/types'
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

export function deploymentFromConfig(c: OnboardConfig, tenant: { safe: Address; owner: Address; bank: Address } | null, file: Deployment | null): Deployment {
  const [a, b] = c.vaults
  return {
    chainId: c.chainId,
    usdc: c.usdc,
    priceFeed: c.priceFeed,
    vaultA: a?.address ?? file?.vaultA ?? zeroAddress,
    vaultB: b?.address ?? a?.address ?? file?.vaultB ?? zeroAddress,
    registry: c.registry,
    module: c.module,
    safe: tenant?.safe ?? c.referenceSafe ?? file?.safe ?? zeroAddress,
    safeSingleton: c.safeSingleton,
    safeProxyFactory: c.safeProxyFactory,
    roles: {
      owner: tenant?.owner ?? file?.roles.owner ?? zeroAddress,
      bank: tenant?.bank ?? file?.roles.bank ?? zeroAddress,
      authorizer: c.operator.authorizer,
      exitKey: c.operator.exitKey,
      executor: c.operator.executor,
      keeper: c.operator.keeper,
    },
    params: c.params as Record<string, string | number>,
  }
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

export const REGISTRY_ABI = parseAbi([
  'function bankFreeze(address safe)',
  'function bankUnfreeze(address safe)',
  'function revokeAuthorizer(address safe)',
  'function ownerFreeze(address safe)',
  'function ownerUnfreeze(address safe)',
  'function register(address safe, address owner_, address bank_)',
  'function addVault(address safe, address vault)',
  'function removeVault(address safe, address vault)',
  'function setAuthorizer(address safe, address a)',
  'function setExitKey(address safe, address k)',
  'function setAutoCap(address safe, uint256 v)',
  'function setDailyCap(address safe, uint256 v)',
  'function setMaxBandWidth(address safe, uint256 v)',
  'function setMaxOracleAge(address safe, uint256 v)',
  'function setBankLimit(address safe, uint256 v)',
  'function setReserveFloor(address safe, uint256 floor, bytes32 scheduleHash)',
  'function owner(address safe) view returns (address)',
  'function bank(address safe) view returns (address)',
  'function authorizer(address safe) view returns (address)',
  'function exitKey(address safe) view returns (address)',
  'function autoCap(address safe) view returns (uint256)',
  'function dailyCap(address safe) view returns (uint256)',
  'function bankLimit(address safe) view returns (uint256)',
  'function maxBandWidth(address safe) view returns (uint256)',
  'function maxOracleAge(address safe) view returns (uint256)',
  'function reserveFloor(address safe) view returns (uint256)',
  'function ownerFrozen(address safe) view returns (bool)',
  'function bankFrozen(address safe) view returns (bool)',
  'function allowedVault(address safe, address vault) view returns (bool)',
  'function policyVersion(address safe) view returns (uint64)',
  'error Unauthorized()',
])
