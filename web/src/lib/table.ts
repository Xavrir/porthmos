export type TableQuery = { text: string; status: string | null }

export type TableAccessors<T> = {
  text: (row: T) => string
  status?: (row: T) => string
}

function normalise(s: string): string {
  return s.toLowerCase().replace(/(\d),(?=\d)/g, '$1')
}

export function tokens(query: string): string[] {
  return normalise(query).split(/\s+/).filter(Boolean)
}

export function matchesText(haystack: string, query: string): boolean {
  const words = tokens(query)
  if (!words.length) return true
  const hay = normalise(haystack)
  return words.every((w) => hay.includes(w))
}

export function filterRows<T>(rows: readonly T[], query: TableQuery, acc: TableAccessors<T>): T[] {
  return rows.filter((r) => (!query.status || !acc.status || acc.status(r) === query.status) && matchesText(acc.text(r), query.text))
}

export function countByStatus<T>(rows: readonly T[], status: (row: T) => string): Record<string, number> {
  const out: Record<string, number> = {}
  for (const r of rows) {
    const s = status(r)
    out[s] = (out[s] ?? 0) + 1
  }
  return out
}

export type Page<T> = { rows: T[]; page: number; pages: number; from: number; to: number; total: number }

export function paginate<T>(rows: readonly T[], page: number, size: number): Page<T> {
  const total = rows.length
  const pages = Math.max(1, Math.ceil(total / size))
  const p = Math.min(Math.max(0, page), pages - 1)
  const start = p * size
  const slice = rows.slice(start, start + size)
  return { rows: slice, page: p, pages, from: total ? start + 1 : 0, to: start + slice.length, total }
}
