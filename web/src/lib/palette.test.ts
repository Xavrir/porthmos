import { describe, expect, it } from 'vitest'
import { flatten, moveActive, searchPalette, type PaletteItem } from './palette'

const items: PaletteItem[] = [
  { id: 'p-t', group: 'Pages', title: 'Treasury', hint: 'Balances, reserve and positions', target: { kind: 'route', to: '/treasury' } },
  { id: 'p-a', group: 'Pages', title: 'Audit', hint: 'Decision ledger', target: { kind: 'route', to: '/audit' } },
  { id: 'p-b', group: 'Pages', title: 'Bank desk', hint: 'Clients and freezes', target: { kind: 'route', to: '/bank' } },
  { id: 'a-k', group: 'Actions', title: 'Keyboard shortcuts', target: { kind: 'action', action: 'shortcuts' } },
  { id: 'l-25', group: 'Ledger', title: 'Row 25: Deposit 1,000.00 into Vault B', hint: 'Confirmed', keywords: '0x69fc', target: { kind: 'route', to: '/audit#row-25' } },
  { id: 'l-22', group: 'Ledger', title: 'Row 22: Deposit 800.00 during the bank freeze', hint: 'Frozen', target: { kind: 'route', to: '/audit#row-22' } },
  { id: 't-n', group: 'Terms', title: 'Nonce', hint: 'A random number in each record', target: { kind: 'term', term: 'Nonce' } },
  { id: 't-q', group: 'Terms', title: 'Quarantine', hint: 'A vault flag set after a risk trigger', target: { kind: 'term', term: 'Quarantine' } },
]

describe('command palette search', () => {
  it('shows pages, actions and recent rows for an empty query, but not terms', () => {
    const groups = searchPalette(items, '').map((s) => s.group)
    expect(groups).toEqual(['Pages', 'Actions', 'Ledger'])
  })

  it('ranks a title prefix above a match in the description', () => {
    const ids = flatten(searchPalette(items, 'bank')).map((i) => i.id)
    expect(ids[0]).toBe('p-b')
    expect(ids).toContain('l-22')
  })

  it('needs every word to match somewhere', () => {
    expect(flatten(searchPalette(items, 'deposit vault b')).map((i) => i.id)).toEqual(['l-25'])
    expect(flatten(searchPalette(items, 'deposit zebra'))).toEqual([])
  })

  it('finds amounts typed without separators and hashes in keywords', () => {
    expect(flatten(searchPalette(items, '1000')).map((i) => i.id)).toEqual(['l-25'])
    expect(flatten(searchPalette(items, '0x69')).map((i) => i.id)).toEqual(['l-25'])
  })

  it('finds glossary terms by their definition', () => {
    expect(flatten(searchPalette(items, 'risk trigger')).map((i) => i.id)).toEqual(['t-q'])
  })

  it('keeps the fixed group order and caps each group', () => {
    const sections = searchPalette(items, 'r', 1)
    expect(sections.every((s) => s.items.length === 1)).toBe(true)
    const order = sections.map((s) => s.group)
    expect(order).toEqual([...order].sort((a, b) => ['Pages', 'Actions', 'Treasury', 'Ledger', 'Transactions', 'Terms'].indexOf(a) - ['Pages', 'Actions', 'Treasury', 'Ledger', 'Transactions', 'Terms'].indexOf(b)))
  })

  it('treats regex characters in the query as text', () => {
    expect(() => searchPalette(items, '(row')).not.toThrow()
  })
})

describe('palette keyboard movement', () => {
  it('wraps at both ends and starts from the first or last item', () => {
    expect(moveActive(-1, 1, 4)).toBe(0)
    expect(moveActive(-1, -1, 4)).toBe(3)
    expect(moveActive(3, 1, 4)).toBe(0)
    expect(moveActive(0, -1, 4)).toBe(3)
    expect(moveActive(2, 1, 0)).toBe(-1)
  })
})
