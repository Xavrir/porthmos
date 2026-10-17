import { describe, expect, it, vi } from 'vitest'
import { concatHex, decodeFunctionData, encodeFunctionData, getAddress, hashTypedData, parseAbi, recoverTypedDataAddress, type Abi, type Address, type Hex } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { EVIDENCE_ORDER } from '../../replay/evidence'
import { prevalidatedSignature, SAFE_ABI } from '../onboard/safe'
import { toViemMessage } from '../eip712'
import { assertPinnedTarget, assertSafeTx, buildFundOrderTx, buildRefundTx, buildWaiveTx, guardedSend, PINNED, pinnedTradeFlow, RefusedTx } from '../txguard'
import { ERC20_ABI, ESCROW_ABI, MULTISEND_ABI } from './abi'
import { confirmationPayload } from './confirm'
import { E6A_FUND_INPUT, E6D_WAIVE_INPUT } from './e6vectors'
import { approveCall, createOrderCall, packMultiSend, safeExec, unpackMultiSend } from './encode'
import { buildTerms, canonicalJson, InputError, parseUsdc, splitTotal, termsHash, type Terms } from './model'
import { recordedOrder } from './replay'
import { conditionChecks, milestoneDisplay, orderDisplay } from './state'
import type { TxRequest } from '../types'

const CHAIN = 84532
const TF = pinnedTradeFlow(CHAIN)!
const SAFE = getAddress('0x2E1c2be3dD6BAa59344EdC6ee6A93D68e2295a0F')
const OWNER = getAddress('0x01c38dfC1Eb6D925E5e302910E1C83CED96c1663')
const EVIL = getAddress('0x000000000000000000000000000000000000dEaD')
const E6 = EVIDENCE_ORDER!
const E6_TERMS: Terms[] = E6.milestones.map((m) => ({ amount: BigInt(m.amount), issuer: getAddress(m.issuer), kind: m.kind, requireDoc: m.requireDoc, checkTemp: m.checkTemp, minTempCenti: m.minTempCenti, maxTempCenti: m.maxTempCenti, deadline: BigInt(m.deadline) }))
const E6_ORDER = { safe: SAFE, owner: OWNER, supplier: getAddress(E6.supplier), total: BigInt(E6.total), termsHash: E6.termsHash, terms: E6_TERMS }
const ctx = { safe: SAFE, owner: OWNER }

describe('split math', () => {
  it('splits 20/40/40 in integer units with the remainder on the last milestone', () => {
    expect(splitTotal(1000_000000n)).toEqual([200_000000n, 400_000000n, 400_000000n])
    expect(splitTotal(1n * 10n + 1n)).toEqual([2n, 4n, 5n])
    const odd = 1234_567891n
    const parts = splitTotal(odd)
    expect(parts.reduce((a, b) => a + b, 0n)).toBe(odd)
    expect(parts).toEqual([246_913578n, 493_827156n, 493_827157n])
  })

  it('refuses totals that leave a milestone at zero, and bad shares', () => {
    expect(() => splitTotal(2n)).toThrow(InputError)
    expect(() => splitTotal(0n)).toThrow(InputError)
    expect(() => splitTotal(100n, [5000n, 4000n, 2000n])).toThrow(/100%/)
  })

  it('parses USDC amounts exactly, without floats', () => {
    expect(parseUsdc('1000')).toBe(1000_000000n)
    expect(parseUsdc('1,250.5')).toBe(1250_500000n)
    expect(parseUsdc('0.000001')).toBe(1n)
    for (const bad of ['', '1e3', '-5', '1.0000001', '0', 'abc']) expect(() => parseUsdc(bad)).toThrow(InputError)
  })

  it('builds terms from the bundled issuers, conditions and deadlines', () => {
    const t = buildTerms(1000_000000n, TF.issuers, 1_000n)
    expect(t.map((x) => x.issuer)).toEqual([TF.issuers.carrier, TF.issuers.sensor, TF.issuers.surveyor])
    expect(t[1]).toMatchObject({ checkTemp: true, minTempCenti: 200, maxTempCenti: 800, kind: 1 })
    expect(t.map((x) => x.deadline)).toEqual([1_000n + 7n * 86400n, 1_000n + 21n * 86400n, 1_000n + 30n * 86400n])
  })
})

describe('terms hash', () => {
  it('reproduces the recorded E6 termsHash from the recorded purchase order', () => {
    const po = { buyer: E6.buyer, supplier: E6.supplier, token: E6.token, total: E6.total, terms: E6.terms, milestones: E6.milestones }
    expect(termsHash(po as never)).toBe(E6.termsHash)
  })

  it('escapes non-ASCII like Python json.dumps', () => {
    expect(canonicalJson({ b: 1, a: 'Café' })).toBe('{"a":"Caf\\u00e9","b":1}')
  })
})

describe('calldata encoding', () => {
  it('matches the recorded E6a funding transaction byte for byte', () => {
    const plan = buildFundOrderTx(CHAIN, E6_ORDER)
    expect(plan.tx).toEqual({ to: SAFE, data: E6A_FUND_INPUT, value: '0' })
    expect(plan.shape).toMatchObject({ kind: 'fund', total: 1000_000000n })
  })

  it('matches the recorded E6d waive transaction', () => {
    expect(buildWaiveTx(CHAIN, { safe: SAFE, owner: OWNER, orderId: 1n, index: 1 }).tx.data).toBe(E6D_WAIVE_INPUT)
  })

  const forge = Object.values(import.meta.glob<{ abi: Abi }>('../../../../contracts/out/TradeEscrow.sol/TradeEscrow.json', { eager: true, import: 'default' }))[0]
  it.skipIf(!forge)('encodes createOrder exactly as viem does with the forge ABI', () => {
    const abi = forge!.abi
    const viaForge = encodeFunctionData({ abi, functionName: 'createOrder', args: [E6_ORDER.supplier, E6_ORDER.total, E6_ORDER.termsHash, E6_TERMS] })
    expect(createOrderCall(E6_ORDER)).toBe(viaForge)
  })

  it('packs and unpacks MultiSendCallOnly batches', () => {
    const calls = [{ to: TF.usdc, data: approveCall(TF, 5n) }, { to: TF.tradeEscrow, data: '0x' as Hex }]
    expect(unpackMultiSend(packMultiSend(calls))).toEqual(calls.map((c) => ({ operation: 0, value: 0n, ...c })))
    expect(() => unpackMultiSend('0x00')).toThrow(/truncated/)
  })
})

function fundWith(inner: { to: Address; data: Hex; operation?: number }[], opts: { target?: Address; operation?: 0 | 1 } = {}): Hex {
  const packed = concatHex(inner.map((c) => {
    const p = packMultiSend([c])
    return c.operation ? (`0x01${p.slice(4)}` as Hex) : p
  }))
  const batch = encodeFunctionData({ abi: MULTISEND_ABI, functionName: 'multiSend', args: [packed] })
  return safeExec(opts.target ?? TF.multiSendCallOnly, batch, opts.operation ?? 1, OWNER)
}

const goodApprove = { to: TF.usdc, data: approveCall(TF, E6_ORDER.total) }
const goodCreate = { to: TF.tradeEscrow, data: createOrderCall(E6_ORDER) }

describe('txguard: Safe transactions', () => {
  it('allows the exact funding batch, waive and refund', () => {
    expect(assertSafeTx(CHAIN, fundWith([goodApprove, goodCreate]), ctx).kind).toBe('fund')
    expect(assertSafeTx(CHAIN, buildWaiveTx(CHAIN, { ...ctx, orderId: 3n, index: 2 }).tx.data, ctx)).toEqual({ kind: 'waive', orderId: 3n, index: 2 })
    expect(assertSafeTx(CHAIN, buildRefundTx(CHAIN, { ...ctx, orderId: 3n }).tx.data, ctx)).toEqual({ kind: 'refund', orderId: 3n })
  })

  it('refuses a tampered inner call', () => {
    const otherSupplier = { to: TF.tradeEscrow, data: createOrderCall({ ...E6_ORDER, total: E6_ORDER.total + 1n }) }
    expect(() => assertSafeTx(CHAIN, fundWith([goodApprove, otherSupplier]), ctx)).toThrow(/approval .* differs|do not add up/)
    const transfer = { to: TF.usdc, data: encodeFunctionData({ abi: parseAbi(['function transfer(address to, uint256 amount)']), functionName: 'transfer', args: [EVIL, 1n] }) }
    expect(() => assertSafeTx(CHAIN, fundWith([transfer, goodCreate]), ctx)).toThrow(/not USDC approve/)
    expect(() => assertSafeTx(CHAIN, fundWith([goodApprove, goodCreate, transfer]), ctx)).toThrow(/3 calls/)
    expect(() => assertSafeTx(CHAIN, fundWith([goodApprove, { ...goodCreate, to: EVIL }]), ctx)).toThrow(/pinned TradeEscrow/)
    expect(() => assertSafeTx(CHAIN, fundWith([goodApprove, { ...goodCreate, operation: 1 }]), ctx)).toThrow(/delegatecall/)
    const badIssuer = { to: TF.tradeEscrow, data: createOrderCall({ ...E6_ORDER, terms: E6_TERMS.map((t, i) => (i === 2 ? { ...t, issuer: EVIL } : t)) }) }
    expect(() => assertSafeTx(CHAIN, fundWith([goodApprove, badIssuer]), ctx)).toThrow(/bundled demo surveyor/)
    const trailing = { ...goodCreate, data: `${goodCreate.data}00` as Hex }
    expect(() => assertSafeTx(CHAIN, fundWith([goodApprove, trailing]), ctx)).toThrow(/exact form/)
  })

  it('refuses a different delegatecall target', () => {
    expect(() => assertSafeTx(CHAIN, fundWith([goodApprove, goodCreate], { target: EVIL }), ctx)).toThrow(/not the pinned MultiSendCallOnly/)
    expect(() => assertSafeTx(CHAIN, safeExec(TF.tradeEscrow, encodeFunctionData({ abi: ESCROW_ABI, functionName: 'refund', args: [1n] }), 1, OWNER), ctx)).toThrow(/not the pinned MultiSendCallOnly/)
  })

  it('refuses a different spender', () => {
    const spender = { to: TF.usdc, data: encodeFunctionData({ abi: ERC20_ABI, functionName: 'approve', args: [EVIL, E6_ORDER.total] }) }
    expect(() => assertSafeTx(CHAIN, fundWith([spender, goodCreate]), ctx)).toThrow(/spender/)
  })

  it('refuses any other Safe call, a plain call elsewhere, a foreign signer and a gas refund', () => {
    const enable = encodeFunctionData({ abi: SAFE_ABI, functionName: 'enableModule', args: [EVIL] })
    expect(() => assertSafeTx(CHAIN, enable, ctx)).toThrow(/execTransaction/)
    expect(() => assertSafeTx(CHAIN, safeExec(EVIL, '0x', 0, OWNER), ctx)).toThrow(/pinned TradeEscrow/)
    expect(() => assertSafeTx(CHAIN, safeExec(SAFE, enable, 0, OWNER), ctx)).toThrow(/pinned TradeEscrow/)
    const createDirect = safeExec(TF.tradeEscrow, createOrderCall(E6_ORDER), 0, OWNER)
    expect(() => assertSafeTx(CHAIN, createDirect, ctx)).toThrow(/only waive or refund/)
    expect(() => assertSafeTx(CHAIN, buildWaiveTx(CHAIN, { ...ctx, orderId: 1n, index: 0 }).tx.data, { safe: SAFE, owner: EVIL })).toThrow(/session owner/)
    const refund = encodeFunctionData({ abi: SAFE_ABI, functionName: 'execTransaction', args: [TF.tradeEscrow, 0n, encodeFunctionData({ abi: ESCROW_ABI, functionName: 'refund', args: [1n] }), 0, 0n, 0n, 1n, TF.usdc, EVIL, prevalidatedSignature(OWNER)] })
    expect(() => assertSafeTx(CHAIN, refund, ctx)).toThrow(/gas refund/)
  })

  it('sends a Safe transaction only to the session Safe, and only for the owner', async () => {
    const send = vi.fn(async (tx: TxRequest) => tx.to)
    const fund = buildFundOrderTx(CHAIN, E6_ORDER).tx
    await expect(guardedSend(CHAIN, fund, send, PINNED, ctx)).resolves.toBe(SAFE)
    await expect(guardedSend(CHAIN, fund, send)).rejects.toBeInstanceOf(RefusedTx)
    await expect(guardedSend(CHAIN, fund, send, PINNED, { safe: EVIL, owner: OWNER })).rejects.toThrow(/not a Porthmos contract/)
    await expect(guardedSend(CHAIN, fund, send, PINNED, { safe: SAFE, owner: null })).rejects.toThrow(/owner key/)
    await expect(guardedSend(CHAIN, { ...fund, value: '1' }, send, PINNED, ctx)).rejects.toThrow(/ETH/)
    expect(send).toHaveBeenCalledTimes(1)
    expect(() => assertPinnedTarget(CHAIN, { to: TF.tradeEscrow, value: '0' }, PINNED, ctx)).toThrow(/not a Porthmos contract/)
  })
})

describe('ReleaseConfirmation', () => {
  it('hashes and signs like the service encoder (vector from aegis.tradeflow.typed)', async () => {
    const p = confirmationPayload(CHAIN, TF.tradeEscrow, { orderId: '7', index: 1, proofHash: `0x${'ab'.repeat(32)}`, expiry: 1800000000 })
    const args = { domain: p.domain, types: p.types, primaryType: p.primaryType, message: toViemMessage(p.message) } as unknown as Parameters<typeof hashTypedData>[0]
    expect(hashTypedData(args)).toBe('0x245e010bcf7473bd8a665a9744bf62a9eb13133a1ca37f057a4d1a7d529d8ab3')
    const acct = privateKeyToAccount('0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d')
    const sig = await acct.signTypedData(args as never)
    expect(sig).toBe('0xad0637910fde7ffad6b85a9579528d7413a1af9019a0ac23100c600759e01eb34c802850892bfddfd53662395c7717d1f2d2d070b9d7867d603e07c2ef5e17f11c')
    expect(await recoverTypedDataAddress({ ...args, signature: sig } as never)).toBe(acct.address)
  })
})

describe('order state mapping', () => {
  it('lets the chain status win over the workflow state', () => {
    expect(milestoneDisplay({ status: 'RELEASED', state: 'HELD' })).toBe('released')
    expect(milestoneDisplay({ status: 'WAIVED' })).toBe('waived')
    expect(milestoneDisplay({ status: 'REFUNDED', state: 'AWAITING_PROOF' })).toBe('refunded')
  })

  it('maps open workflow states', () => {
    expect(milestoneDisplay({ status: 'PENDING', state: 'AWAITING_PROOF' })).toBe('pending')
    expect(milestoneDisplay({ status: 'PENDING' })).toBe('pending')
    expect(milestoneDisplay({ status: 'PENDING', state: 'HELD' })).toBe('held')
    expect(milestoneDisplay({ status: 'PENDING', state: 'WAITING' })).toBe('waiting')
    for (const s of ['PROOF_RECEIVED', 'PROOF_VERIFIED', 'RELEASE_SIGNED', 'RELEASE_SUBMITTED', 'RELEASE_FAILED', 'RELEASED'] as const) expect(milestoneDisplay({ status: 'PENDING', state: s })).toBe('releasing')
    expect(orderDisplay('ACTIVE')).toBe('active')
    expect(orderDisplay('COMPLETED')).toBe('completed')
    expect(orderDisplay('REFUNDED')).toBe('refunded')
  })

  it('recomputes the temperature condition from the signed proof', () => {
    const m = { requireDoc: true, checkTemp: true, minTempCenti: 200, maxTempCenti: 800 }
    const proof = E6.steps.find((s) => s.id === 'E6c')!.proof!
    expect(conditionChecks(m, proof)).toEqual([
      { name: 'Document hash', ok: true, detail: 'Present' },
      { name: 'Temperature', ok: false, detail: '3.50 to 9.40 °C over 96 samples, allowed 2.00 to 8.00 °C' },
    ])
    expect(conditionChecks(m, { ...proof, maxTempCenti: 700 }).every((c) => c.ok)).toBe(true)
  })

  it('replays the recorded E6 order with only recorded hashes', () => {
    const o = recordedOrder()!
    expect(o.order).toMatchObject({ orderId: '1', status: 'COMPLETED', released: { raw: '1000000000' } })
    expect(o.milestones.map((m) => milestoneDisplay(m))).toEqual(['released', 'waived', 'released'])
    expect(o.milestones[1].reason).toBe('ConditionNotMet')
    expect(o.transactions.created).toBe('0x63a8622b38aa631533900f5cea7b92699132b1d2e1e036bff2fc8f035c1a07f1')
    expect(o.transactions.milestones).toEqual({
      0: '0x86cbfd7e450b18d54448d7b28c57c20d3ddbeb7308faa5e2eba392fa67402281',
      1: '0xb7a2a4178f7cbb6cb865244e6bc4a2832f94cbc8d926b848834ff432ef2a6160',
      2: '0xf4a27910945cd6e6044bcd7973ee41e066c98762df15218802b70a60f1be1493',
    })
    expect(o.recorded!.attacks.map((a) => a.error)).toEqual(['ConditionNotMet', 'BadSignature', 'Frozen'])
  })

  it('decodes nothing the guard did not check', () => {
    const d = decodeFunctionData({ abi: SAFE_ABI, data: E6A_FUND_INPUT })
    expect(d.args[0]).toBe(TF.multiSendCallOnly)
  })
})

describe('exact amounts', () => {
  it('shows sub-cent milestone amounts without rounding', async () => {
    const { exactUnits } = await import('../format')
    expect(splitTotal(parseUsdc('500.01')).map((p) => exactUnits(p))).toEqual(['100.002', '200.004', '200.004'])
    expect(exactUnits(1234_500000n)).toBe('1,234.50')
  })
})
