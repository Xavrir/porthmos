import { describe, expect, it } from 'vitest'
import { amount } from './format'
import { balanceSeries, dailyTotals, dayIndex, delta, niceTicks, vaultFlows } from './history'
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
