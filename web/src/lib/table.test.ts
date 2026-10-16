import { describe, expect, it } from 'vitest'
import { countByStatus, filterRows, matchesText, paginate } from './table'

type Row = { id: number; label: string; status: string; amount: string }

const rows: Row[] = [
  { id: 1, label: 'Deposit into Vault A', status: 'executed', amount: '1,500.00' },
  { id: 2, label: 'Replay of the Vault A record', status: 'refused', amount: '1,500.00' },
  { id: 3, label: 'Owner asked the agent to hold', status: 'held', amount: '' },
  { id: 4, label: 'Deposit into Vault B', status: 'executed', amount: '800.00' },
]
const acc = { text: (r: Row) => `${r.label} ${r.amount}`, status: (r: Row) => r.status }

describe('table filter', () => {
  it('returns every row for an empty query and no status', () => {
    expect(filterRows(rows, { text: '', status: null }, acc)).toHaveLength(4)
  })

  it('keeps only the chosen status', () => {
    expect(filterRows(rows, { text: '', status: 'executed' }, acc).map((r) => r.id)).toEqual([1, 4])
  })

  it('needs every word, in any order, ignoring case', () => {
    expect(filterRows(rows, { text: 'vault deposit', status: null }, acc).map((r) => r.id)).toEqual([1, 4])
    expect(filterRows(rows, { text: 'VAULT b', status: null }, acc).map((r) => r.id)).toEqual([4])
  })

  it('combines status and text', () => {
    expect(filterRows(rows, { text: 'vault a', status: 'refused' }, acc).map((r) => r.id)).toEqual([2])
    expect(filterRows(rows, { text: 'hold', status: 'executed' }, acc)).toEqual([])
  })

  it('matches amounts with or without thousands separators', () => {
    expect(matchesText('Deposit 1,500.00', '1500')).toBe(true)
    expect(matchesText('Deposit 1,500.00', '1,500')).toBe(true)
    expect(matchesText('Deposit 800.00', '1500')).toBe(false)
  })

  it('counts rows per status', () => {
    expect(countByStatus(rows, acc.status)).toEqual({ executed: 2, refused: 1, held: 1 })
  })
})

describe('pagination', () => {
  const many = Array.from({ length: 45 }, (_, i) => i + 1)

  it('reports the visible range', () => {
    expect(paginate(many, 0, 20)).toMatchObject({ from: 1, to: 20, total: 45, pages: 3, page: 0 })
    expect(paginate(many, 2, 20)).toMatchObject({ from: 41, to: 45, rows: [41, 42, 43, 44, 45] })
  })

  it('clamps a page past the end and handles no rows', () => {
    expect(paginate(many, 9, 20).page).toBe(2)
    expect(paginate([], 0, 20)).toMatchObject({ from: 0, to: 0, total: 0, pages: 1 })
  })
})
