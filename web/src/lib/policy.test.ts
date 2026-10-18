import { describe, expect, it } from 'vitest'
import { expectFreeze, FREEZE_EXPECT_MS, freezeSettled, withExpectedFreeze } from './policy'
import type { BankClient } from './types'

const A = '0x00000000000000000000000000000000000000a1'
const B = '0x00000000000000000000000000000000000000b2'
const client = (safe: `0x${string}`, bank = false): BankClient => ({ safe, name: safe.slice(-2), riskScore: 0, frozen: { owner: false, bank }, pendingEscalations: 0, mismatches: 0 })

describe('bank freeze right after the transaction is mined', () => {
  it('shows the mined freeze while the service still reads the old block', () => {
    const e = expectFreeze('bankFreeze', A, 1_000)
    const shown = withExpectedFreeze([client(A), client(B)], e, 2_000)
    expect(shown.map((c) => c.frozen.bank)).toEqual([true, false])
    expect(freezeSettled([client(A), client(B)], e, 2_000)).toBe(false)
  })

  it('stops overriding once the service agrees or the wait runs out', () => {
    const e = expectFreeze('bankFreeze', A, 1_000)
    expect(freezeSettled([client(A, true)], e, 2_000)).toBe(true)
    expect(freezeSettled([client(A)], e, 1_000 + FREEZE_EXPECT_MS)).toBe(true)
    expect(withExpectedFreeze([client(A)], e, 1_000 + FREEZE_EXPECT_MS)[0].frozen.bank).toBe(false)
  })

  it('treats an unfreeze the same way and a revoke as a freeze', () => {
    expect(withExpectedFreeze([client(A, true)], expectFreeze('bankUnfreeze', A, 0), 1)[0].frozen.bank).toBe(false)
    expect(expectFreeze('revokeAuthorizer', A, 0).bank).toBe(true)
  })
})
