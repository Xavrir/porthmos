import { num } from './format'
import type { LedgerRow, TreasuryState } from './types'

export type Flow = { t: number; delta: number }
export type BalancePoint = { t: number; safe: number; vaults: number }

// Positive moves cash from the Safe into vaults; a redemption moves it back.
export function vaultFlows(rows: readonly LedgerRow[]): Flow[] {
  return rows
    .filter((r) => r.kind === 'execution' && r.amount && (r.op === 'DEPOSIT' || r.op === 'REDEEM'))
    .map((r) => ({ t: r.ts, delta: (r.op === 'DEPOSIT' ? 1 : -1) * num(r.amount) }))
    .sort((a, b) => a.t - b.t)
}

// Anchored on today's balances and walked back through each execution, so no value is guessed.
export function balanceSeries(flows: readonly Flow[], now: { t: number; safe: number; vaults: number }): BalancePoint[] {
  if (!flows.length) return []
  const first = flows[0].t
  const last = flows[flows.length - 1].t
  const points: BalancePoint[] = [{ t: Math.max(now.t, last), safe: now.safe, vaults: now.vaults }]
  let safe = now.safe
  let vaults = now.vaults
  for (let i = flows.length - 1; i >= 0; i--) {
    const f = flows[i]
    points.push({ t: f.t, safe, vaults })
    safe += f.delta
    vaults = Math.max(0, vaults - f.delta)
  }
  points.push({ t: first - Math.max(3600, (Math.max(now.t, last) - first) * 0.05), safe, vaults })
  return points.reverse()
}

export const DAY_OFFSET = 8 * 3600

export function dayIndex(ts: number, offset = DAY_OFFSET): number {
  return Math.floor((ts + offset) / 86400)
}

// offset 0 buckets by UTC day, which is how the contract's daily cap counts.
export function dailyTotals(items: readonly { t: number; v: number }[], days: number, endTs: number, offset = DAY_OFFSET): number[] {
  const end = dayIndex(endTs, offset)
  const out = Array.from({ length: days }, () => 0)
  for (const it of items) {
    const i = days - 1 - (end - dayIndex(it.t, offset))
    if (i >= 0 && i < days) out[i] += it.v
  }
  return out
}

export type Delta = { abs: number; pct: number | null; dir: 'up' | 'down' | 'flat' }

// A percentage over a near-empty base (say yield left before the first deposit) says nothing, so it is withheld.
export function delta(from: number, to: number): Delta {
  const abs = to - from
  const dir = Math.abs(abs) < 0.005 ? 'flat' : abs > 0 ? 'up' : 'down'
  const pct = Math.abs(from) >= 0.005 ? abs / Math.abs(from) : null
  return { abs, pct: pct !== null && Math.abs(pct) <= 10 ? pct : null, dir }
}

export function niceTicks(max: number, count = 3): number[] {
  if (max <= 0) return [0, 1]
  const raw = max / count
  const mag = 10 ** Math.floor(Math.log10(raw))
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? 10 * mag
  const top = Math.ceil(max / step) * step
  return Array.from({ length: Math.round(top / step) + 1 }, (_, i) => i * step)
}

export function treasuryNow(t: TreasuryState, fallbackTs: number) {
  return {
    t: t.updatedAt ?? fallbackTs,
    safe: num(t.balances.safeUsdc),
    vaults: t.balances.vaults.reduce((a, v) => a + num(v.assets), 0),
  }
}

export function latestTs(rows: readonly LedgerRow[] | undefined): number {
  return rows?.length ? Math.max(...rows.map((r) => r.ts)) : Math.floor(Date.now() / 1000)
}

export type HoldingPoint = { t: number; values: Record<string, number> }
export const CASH = 'cash'

// Same walk as balanceSeries, kept per vault so a stacked chart can show where the money sat.
export function holdingSeries(rows: readonly LedgerRow[], now: { t: number; cash: number; vaults: { key: string; value: number }[] }): HoldingPoint[] {
  const flows = rows
    .filter((r) => r.kind === 'execution' && r.amount && r.vault && (r.op === 'DEPOSIT' || r.op === 'REDEEM'))
    .map((r) => ({ t: r.ts, vault: r.vault!, delta: (r.op === 'DEPOSIT' ? 1 : -1) * num(r.amount) }))
    .sort((a, b) => a.t - b.t)
  if (!flows.length) return []
  const values: Record<string, number> = { [CASH]: now.cash }
  for (const v of now.vaults) values[v.key] = v.value
  const last = flows[flows.length - 1].t
  const end = Math.max(now.t, last)
  const points: HoldingPoint[] = [{ t: end, values: { ...values } }]
  for (let i = flows.length - 1; i >= 0; i--) {
    const f = flows[i]
    points.push({ t: f.t, values: { ...values } })
    values[CASH] += f.delta
    values[f.vault] = Math.max(0, (values[f.vault] ?? 0) - f.delta)
  }
  points.push({ t: flows[0].t - Math.max(3600, (end - flows[0].t) * 0.05), values: { ...values } })
  return points.reverse()
}

const STEPS = [900, 1800, 3600, 7200, 10800, 21600, 43200, 86400]

// A balance holds between executions, so each sample takes the last known value at or before it.
export function resample(points: readonly HoldingPoint[], target = 96): HoldingPoint[] {
  if (points.length < 2) return [...points]
  const t0 = points[0].t
  const t1 = points[points.length - 1].t
  const step = STEPS.find((s) => (t1 - t0) / s <= target) ?? 86400
  const out: HoldingPoint[] = []
  let k = 0
  for (let t = Math.ceil(t0 / step) * step; t < t1; t += step) {
    while (k + 1 < points.length && points[k + 1].t <= t) k++
    out.push({ t, values: points[k].values })
  }
  return [points[0], ...out.filter((p) => p.t > t0), points[points.length - 1]]
}

const TICK_STEPS = [300, 600, 900, 1800, 3600, 3 * 3600, 6 * 3600, 12 * 3600, 86400, 2 * 86400, 7 * 86400]

// Ticks fall on UTC+8 hour and day boundaries, the zone every time in the app is shown in.
export function timeTicks(t0: number, t1: number, max = 6): number[] {
  const span = Math.max(1, t1 - t0)
  const step = TICK_STEPS.find((s) => span / s <= max) ?? 7 * 86400
  const first = Math.ceil((t0 + DAY_OFFSET) / step) * step - DAY_OFFSET
  const out: number[] = []
  for (let t = first; t <= t1; t += step) out.push(t)
  return out
}

// Cuts a step history to [start, end], opening with the balance that held at start.
export function since(points: readonly HoldingPoint[], start: number): HoldingPoint[] {
  if (!points.length || start <= points[0].t) return [...points]
  let k = 0
  while (k + 1 < points.length && points[k + 1].t <= start) k++
  return [{ t: start, values: points[k].values }, ...points.filter((p) => p.t > start)]
}
