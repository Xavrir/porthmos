import { describe, expect, it } from 'vitest'
import { amount } from './format'
import { balanceSeries, dailyTotals, DAY_OFFSET, dayIndex, delta, holdingSeries, niceTicks, resample, since, timeTicks, vaultFlows } from './history'
import type { LedgerRow } from './types'

const base = { prevHash: '0x0', rowHash: '0x1', summary: '', state: 'CONFIRMED' } as const
const row = (seq: number, ts: number, kind: LedgerRow['kind'], op?: LedgerRow['op'], value?: number): LedgerRow =>
  ({ ...base, seq, ts, kind, op, amount: value === undefined ? undefined : amount(value) }) as LedgerRow

describe('balance history', () => {
  const rows = [
    row(1, 1000, 'policy'),
    row(2, 2000, 'execution', 'DEPOSIT', 1500),
    row(3, 3000, 'rejection', 'DEPOSIT', 4000),
    row(4, 4000, 'execution', 'REDEEM', 300),
  ]

  it('uses executed deposits and redemptions only', () => {
    expect(vaultFlows(rows)).toEqual([{ t: 2000, delta: 1500 }, { t: 4000, delta: -300 }])
  })

  it('walks back from today’s balances without inventing values', () => {
    const s = balanceSeries(vaultFlows(rows), { t: 5000, safe: 8800, vaults: 1200 })
    expect(s.map((p) => [p.safe, p.vaults])).toEqual([[10000, 0], [8500, 1500], [8800, 1200], [8800, 1200]])
    expect(s[0].t).toBeLessThan(2000)
    expect(s[s.length - 1].t).toBe(5000)
  })

  it('returns nothing when there is no execution', () => {
    expect(balanceSeries([], { t: 1, safe: 1, vaults: 0 })).toEqual([])
  })
})

describe('daily totals and deltas', () => {
  it('buckets by UTC+8 day and keeps empty days at zero', () => {
    const end = Date.parse('2026-10-15T06:00:00Z') / 1000
    const items = [
      { t: Date.parse('2026-10-15T01:00:00Z') / 1000, v: 1000 },
      { t: Date.parse('2026-10-13T02:00:00Z') / 1000, v: 1500 },
      { t: Date.parse('2026-10-14T17:00:00Z') / 1000, v: 50 },
      { t: Date.parse('2026-10-01T00:00:00Z') / 1000, v: 999 },
    ]
    expect(dailyTotals(items, 4, end)).toEqual([0, 1500, 0, 1050])
    expect(dayIndex(Date.parse('2026-10-14T16:00:00Z') / 1000)).toBe(dayIndex(Date.parse('2026-10-15T15:59:00Z') / 1000))
  })

  it('gives no percentage when the base is zero', () => {
    expect(delta(0, 1000)).toEqual({ abs: 1000, pct: null, dir: 'up' })
    expect(delta(2000, 1000)).toEqual({ abs: -1000, pct: -0.5, dir: 'down' })
    expect(delta(5, 5).dir).toBe('flat')
    expect(delta(5.58, 4205.22).pct).toBeNull()
  })

  it('can bucket by UTC day for the daily cap', () => {
    const end = Date.parse('2026-10-15T06:00:00Z') / 1000
    const items = [{ t: Date.parse('2026-10-14T17:16:54Z') / 1000, v: 300 }, { t: Date.parse('2026-10-15T01:00:00Z') / 1000, v: 1000 }]
    expect(dailyTotals(items, 2, end, 0)).toEqual([300, 1000])
    expect(dailyTotals(items, 2, end)).toEqual([0, 1300])
  })

  it('picks round axis ticks', () => {
    expect(niceTicks(10005)).toEqual([0, 5000, 10000, 15000])
    expect(niceTicks(4205)).toEqual([0, 2000, 4000, 6000])
    expect(niceTicks(0)).toEqual([0, 1])
  })
})

describe('stacked holdings', () => {
  const vrow = (seq: number, ts: number, op: 'DEPOSIT' | 'REDEEM', value: number, vault: string): LedgerRow =>
    ({ ...base, seq, ts, kind: 'execution', op, vault, amount: amount(value) }) as LedgerRow

  it('walks each vault back separately and keeps the total', () => {
    const rows = [vrow(1, 2000, 'DEPOSIT', 1500, 'Vault A'), vrow(2, 3000, 'DEPOSIT', 2000, 'Vault B'), vrow(3, 4000, 'REDEEM', 300, 'Vault A')]
    const s = holdingSeries(rows, { t: 5000, cash: 6800, vaults: [{ key: 'Vault A', value: 1200 }, { key: 'Vault B', value: 2000 }] })
    expect(s.map((p) => [p.values.cash, p.values['Vault A'], p.values['Vault B']])).toEqual([
      [10000, 0, 0], [8500, 1500, 0], [6500, 1500, 2000], [6800, 1200, 2000], [6800, 1200, 2000],
    ])
    for (const p of s) expect(p.values.cash + p.values['Vault A'] + p.values['Vault B']).toBe(10000)
  })

  it('samples a step history at a fixed interval without inventing values', () => {
    const pts = [{ t: 0, values: { cash: 10 } }, { t: 5400, values: { cash: 4 } }, { t: 10800, values: { cash: 4 } }]
    const r = resample(pts, 96)
    expect(r[0]).toEqual(pts[0])
    expect(r[r.length - 1]).toEqual(pts[2])
    expect(r.find((p) => p.t === 3600)!.values.cash).toBe(10)
    expect(r.find((p) => p.t === 7200)!.values.cash).toBe(4)
  })

  it('puts time ticks on UTC+8 day boundaries', () => {
    const t0 = Date.parse('2026-10-13T00:00:00Z') / 1000
    const t1 = Date.parse('2026-10-15T06:00:00Z') / 1000
    const ticks = timeTicks(t0, t1, 4)
    expect(ticks.length).toBeGreaterThan(1)
    for (const t of ticks) expect((t + DAY_OFFSET) % 86400).toBe(0)
  })
})

describe('date range window', () => {
  const pts = [{ t: 0, values: { cash: 10 } }, { t: 100, values: { cash: 6 } }, { t: 200, values: { cash: 4 } }]
  it('opens with the value that held at the start', () => {
    expect(since(pts, 150)).toEqual([{ t: 150, values: { cash: 6 } }, pts[2]])
    expect(since(pts, -5)).toEqual(pts)
  })
})
