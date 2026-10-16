import { tokens } from './table'

export const PALETTE_GROUPS = ['Pages', 'Actions', 'Treasury', 'Ledger', 'Transactions', 'Terms'] as const
export type PaletteGroup = (typeof PALETTE_GROUPS)[number]

export type PaletteTarget =
  | { kind: 'route'; to: string }
  | { kind: 'external'; href: string }
  | { kind: 'term'; term: string }
  | { kind: 'action'; action: 'shortcuts' | 'terms' | 'copy-safe' }

export type PaletteItem = {
  id: string
  group: PaletteGroup
  title: string
  hint?: string
  keywords?: string
  target: PaletteTarget
}

export type PaletteSection = { group: PaletteGroup; items: PaletteItem[] }

const EMPTY_GROUPS: PaletteGroup[] = ['Pages', 'Actions', 'Treasury', 'Ledger']

function score(item: PaletteItem, words: string[], whole: string): number | null {
  const title = item.title.toLowerCase()
  const rest = `${item.hint ?? ''} ${item.keywords ?? ''}`.toLowerCase().replace(/(\d),(?=\d)/g, '$1')
  const titleFlat = title.replace(/(\d),(?=\d)/g, '$1')
  let total = 0
  for (const w of words) {
    if (titleFlat.startsWith(w)) total += 0
    else if (new RegExp(`(^|[^a-z0-9])${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`).test(titleFlat)) total += 1
    else if (titleFlat.includes(w)) total += 2
    else if (rest.includes(w)) total += 4
    else return null
  }
  if (titleFlat === whole) total -= 2
  return total
}

export function searchPalette(items: readonly PaletteItem[], query: string, perGroup = 6): PaletteSection[] {
  const words = tokens(query)
  const whole = words.join(' ')
  const scored = items
    .map((item, i) => ({ item, i, s: words.length ? score(item, words, whole) : EMPTY_GROUPS.includes(item.group) ? 0 : null }))
    .filter((x): x is { item: PaletteItem; i: number; s: number } => x.s !== null)
  scored.sort((a, b) => a.s - b.s || a.i - b.i)
  return PALETTE_GROUPS.map((group) => ({ group, items: scored.filter((x) => x.item.group === group).slice(0, perGroup).map((x) => x.item) }))
    .filter((s) => s.items.length)
}

export function flatten(sections: readonly PaletteSection[]): PaletteItem[] {
  return sections.flatMap((s) => s.items)
}

export function moveActive(current: number, delta: number, count: number): number {
  if (!count) return -1
  if (current < 0) return delta > 0 ? 0 : count - 1
  return (current + delta + count) % count
}
