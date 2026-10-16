import { describe, expect, it } from 'vitest'
import { buildBaseModel, DEMO_CLIENT } from './fixtures'
import { isRecordedTx } from './hashes'

describe('replay data', () => {
  const m = buildBaseModel()

  it('shows only the reference treasury', () => {
    expect(DEMO_CLIENT).toBe('Reference treasury')
    expect(new Set(m.pending.map((p) => p.client))).toEqual(new Set([DEMO_CLIENT]))
    const text = JSON.stringify(m)
    for (const name of ['Kestrel', 'Tidewater', 'Orchard Street', 'Pinecrest', 'Harbour Lane']) expect(text).not.toContain(name)
  })

  it('carries no placeholder transaction hashes', () => {
    const hashes = [
      ...m.ledger.map((r) => r.txHash),
      ...m.events.map((e) => e.txHash),
      ...Object.values(m.requests).map((r) => r.txHash),
    ].filter(Boolean)
    expect(hashes.length).toBeGreaterThan(0)
    for (const h of hashes) expect(isRecordedTx(h)).toBe(true)
  })
})
