import { describe, expect, it } from 'vitest'
import { readShortcut, SEQUENCE_MS } from './shortcuts'

describe('keyboard shortcuts', () => {
  it('opens search with / and with Ctrl or Cmd K, even while typing for K', () => {
    expect(readShortcut({ key: '/' }, null, 0, false)).toEqual({ kind: 'palette' })
    expect(readShortcut({ key: 'k', ctrlKey: true }, null, 0, true)).toEqual({ kind: 'palette' })
    expect(readShortcut({ key: 'K', metaKey: true }, null, 0, false)).toEqual({ kind: 'palette' })
    expect(readShortcut({ key: '/' }, null, 0, true)).toBeNull()
  })

  it('opens help with ?', () => {
    expect(readShortcut({ key: '?' }, null, 0, false)).toEqual({ kind: 'help' })
  })

  it('reads g then a letter as go-to, inside the time window only', () => {
    expect(readShortcut({ key: 'g' }, null, 0, false)).toEqual({ kind: 'pending' })
    expect(readShortcut({ key: 'a' }, 1000, 1000 + SEQUENCE_MS - 1, false)).toEqual({ kind: 'go', to: '/audit' })
    expect(readShortcut({ key: 'b' }, 1000, 1500, false)).toEqual({ kind: 'go', to: '/bank' })
    expect(readShortcut({ key: 'a' }, 1000, 1000 + SEQUENCE_MS + 1, false)).toBeNull()
    expect(readShortcut({ key: 'x' }, 1000, 1100, false)).toBeNull()
  })

  it('ignores plain letters while typing and with modifiers', () => {
    expect(readShortcut({ key: 'g' }, null, 0, true)).toBeNull()
    expect(readShortcut({ key: 'g', altKey: true }, null, 0, false)).toBeNull()
  })
})
