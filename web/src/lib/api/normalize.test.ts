import { describe, expect, it } from 'vitest'
import { marketFrom } from './http'
import { eventsFrom, ledgerFrom, pendingFrom, requestFrom } from './normalize'

describe('service shapes', () => {
  it('reads the v2.1 market state', () => {
    expect(marketFrom({ price: '98500000', pegDeviationPct: -1.5, stale: false, active: ['depeg'], scenario: { name: 'depeg', at: 10, by: 'admin' }, vaults: [] })).toMatchObject({ active: true, label: 'Depeg', since: 10, detail: 'The shared price feed reads 0.9850, 1.50% off the peg.' })
    expect(marketFrom({ price: '100000000', active: [], scenario: null }).active).toBe(false)
  })

  it('maps request ids and transition history', () => {
    const r = requestFrom({ requestId: 'req_1', state: 'CONFIRMED', message: 'hi', createdAt: 5, reply: 'done', history: [{ from: null, to: 'REQUEST_RECEIVED', at: 5, note: 'chat message' }], dar: { safe: '0x1', amount: 7 }, darHash: '0xab' })
    expect(r.id).toBe('req_1')
    expect(r.origin).toBe('owner')
    expect(r.history[0]).toEqual({ state: 'REQUEST_RECEIVED', at: 5, note: 'chat message' })
    expect(r.explanation).toBe('done')
    expect(r.dar).toMatchObject({ primaryType: 'DAR', signature: null, signatureWithheld: true })
  })

  it('maps pending approvals, ledger rows and events', () => {
    const card = { requestId: 'req_1', tier: 3, approvalTypedData: { message: { approvalExpiry: '99' } } }
    expect(pendingFrom({ role: 'owner', pending: [{ requestId: 'req_1', safe: '0x1', createdAt: 1, actionCard: card }] })[0]).toMatchObject({ requestId: 'req_1', role: 'owner', expiresAt: 99 })
    const rows = ledgerFrom({ rows: [{ id: 3, ts: 1, kind: 'CONFIRMED', payload: { action: { op: 'DEPOSIT', amount: '1200000000', amountDisplay: '1,200.00', vault: 'Vault B', tier: 3 } }, tx_hash: '0xaa', prev_hash: '00', row_hash: 'ff' }], integrity: { ok: false, broken: [3] } })
    expect(rows[0]).toMatchObject({ seq: 3, kind: 'execution', state: 'CONFIRMED', summary: 'Deposit 1,200.00 into Vault B', txHash: '0xaa', rowHash: '0xff', linkOk: false })
    expect(rows[0].amount?.display).toBe('1,200.00')
    expect(eventsFrom({ events: [{ event: 'AegisExecuted', blockNumber: 9, txHash: '0xbb', logIndex: 0, op: 0, assets: 5 }] })[0]).toMatchObject({ name: 'AegisExecuted', blockNumber: 9, args: { op: 0, assets: 5 } })
  })
})
