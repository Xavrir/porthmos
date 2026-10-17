export const GO_TO: Record<string, string> = { t: '/treasury', c: '/copilot', r: '/risk', a: '/audit', b: '/bank', o: '/orders' }

export const SHORTCUTS: { keys: string[]; what: string }[] = [
  { keys: ['/'], what: 'Search' },
  { keys: ['Ctrl', 'K'], what: 'Search (Cmd K on a Mac)' },
  { keys: ['?'], what: 'Show keyboard shortcuts' },
  { keys: ['g', 't'], what: 'Go to Treasury' },
  { keys: ['g', 'c'], what: 'Go to Copilot' },
  { keys: ['g', 'r'], what: 'Go to Risk' },
  { keys: ['g', 'a'], what: 'Go to Audit' },
  { keys: ['g', 'b'], what: 'Go to Bank desk' },
  { keys: ['g', 'o'], what: 'Go to Orders' },
  { keys: ['Esc'], what: 'Close a panel, menu or dialog' },
]

export type KeyInput = { key: string; ctrlKey?: boolean; metaKey?: boolean; altKey?: boolean }

export type ShortcutResult =
  | { kind: 'palette' }
  | { kind: 'help' }
  | { kind: 'go'; to: string }
  | { kind: 'pending' }
  | null

export const SEQUENCE_MS = 1200

// Returns what a key press means, given the time of a pending "g" (or null).
export function readShortcut(e: KeyInput, pendingG: number | null, now: number, typing: boolean): ShortcutResult {
  const key = e.key
  if ((e.ctrlKey || e.metaKey) && !e.altKey && key.toLowerCase() === 'k') return { kind: 'palette' }
  if (typing || e.ctrlKey || e.metaKey || e.altKey) return null
  if (pendingG !== null && now - pendingG <= SEQUENCE_MS) {
    const to = GO_TO[key.toLowerCase()]
    return to ? { kind: 'go', to } : null
  }
  if (key === '/') return { kind: 'palette' }
  if (key === '?') return { kind: 'help' }
  if (key === 'g' || key === 'G') return { kind: 'pending' }
  return null
}
