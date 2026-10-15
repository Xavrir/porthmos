import type { ErrorName, OracleState, Tier, TreasuryState, VaultPosition } from './types'
import { num } from './format'

export const TRIGGERS = {
  pegDeviation: 0.01,
  maxOracleAge: 180,
  liquidityMultiple: 1.2,
  exitSlippage: 0.005,
  quarantineCooldownHours: 24,
  darExpirySeconds: 120,
  approvalExpiryHours: 24,
  heartbeatSeconds: 60,
}

export function requiredTier(amount: number, policy: TreasuryState['policy'], vault?: VaultPosition): Tier {
  const bankLimit = num(policy.bankLimit)
  if (bankLimit > 0 && amount > bankLimit) return 4
  if (amount > num(policy.autoCap) || !vault?.everDeposited) return 3
  return 2
}

export function signersFor(tier: Tier): string[] {
  if (tier === 4) return ['Authorizer', 'Owner', 'Bank']
  if (tier === 3) return ['Authorizer', 'Owner']
  if (tier === 2) return ['Authorizer']
  if (tier === 1) return ['Authorizer or exit key']
  return []
}

export type DepositPreview = {
  tier: Tier
  signers: string[]
  stopsAt: ErrorName | null
  safeAfter: number
  floor: number
  dailyLeft: number
  checks: { name: string; ok: boolean; detail: string }[]
}

export function previewDeposit(t: TreasuryState, oracle: OracleState | undefined, vaultAddr: string, amount: number): DepositPreview {
  const vault = t.balances.vaults.find((v) => v.address.toLowerCase() === vaultAddr.toLowerCase())
  const tier = requiredTier(amount, t.policy, vault)
  const safeAfter = num(t.balances.safeUsdc) - amount
  const floor = num(t.reserve.onchainFloor)
  const dailyLeft = num(t.policy.dailyCap) - num(t.depositedToday)
  const frozen = t.policy.frozen.owner || t.policy.frozen.bank
  const stale = oracle ? oracle.stale : false
  const checks = [
    { name: 'Not frozen', ok: !frozen, detail: frozen ? (t.policy.frozen.bank ? 'The bank froze deposits' : 'The owner froze deposits') : 'Neither owner nor bank has frozen deposits', error: 'Frozen' as ErrorName },
    { name: 'Vault open', ok: !vault?.quarantined, detail: vault?.quarantined ? `${vault.name} is quarantined` : `${vault?.name ?? 'Vault'} is not quarantined`, error: 'VaultQuarantined' as ErrorName },
    { name: 'Vault allowed', ok: vault?.allowed !== false, detail: 'Added by the owner', error: 'VaultNotAllowed' as ErrorName },
    { name: 'Fresh price', ok: !stale, detail: stale ? `Price is ${oracle?.ageSeconds ?? '?'} s old` : `Price is ${oracle?.ageSeconds ?? 0} s old, limit ${TRIGGERS.maxOracleAge} s`, error: 'StaleOracle' as ErrorName },
    { name: 'Reserve floor', ok: safeAfter >= floor, detail: `Safe keeps ${safeAfter.toFixed(2)}, floor ${floor.toFixed(2)}`, error: 'ReserveFloorBreached' as ErrorName },
    { name: 'Daily cap', ok: amount <= dailyLeft, detail: `${Math.max(0, dailyLeft).toFixed(2)} left today`, error: 'DailyCapExceeded' as ErrorName },
  ]
  const failed = checks.find((c) => !c.ok)
  return {
    tier,
    signers: signersFor(tier),
    stopsAt: amount <= 0 ? null : failed ? failed.error : null,
    safeAfter,
    floor,
    dailyLeft,
    checks: checks.map(({ name, ok, detail }) => ({ name, ok, detail })),
  }
}

export function reserveRequired(obligations: { amount: number; due: number; inflow?: boolean }[], bufferMin = 500, bufferRate = 0.1) {
  const sorted = [...obligations].sort((a, b) => a.due - b.due)
  let cum = 0
  let worst = 0
  let outflows = 0
  for (const o of sorted) {
    if (o.inflow) cum -= o.amount
    else {
      cum += o.amount
      outflows += o.amount
    }
    worst = Math.max(worst, cum)
  }
  const buffer = Math.max(bufferMin, bufferRate * outflows)
  return { worst, buffer, required: worst + buffer }
}
