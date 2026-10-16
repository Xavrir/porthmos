import { describe, expect, it, vi } from 'vitest'
import { encodeFunctionData, getAddress, parseAbi, type Address, type Hex } from 'viem'
import { assertPinnedTarget, buildFloorTx, FLOOR_ABI, guardedSend, PINNED, RefusedTx, sendFloorUpdate } from './txguard'
import type { TxRequest } from './types'

const CHAIN = 84532
const REGISTRY = PINNED[CHAIN].registry
const MODULE = PINNED[CHAIN].module
const SAFE = getAddress('0x2E1c2be3dD6BAa59344EdC6ee6A93D68e2295a0F') as Address
const OTHER_SAFE = getAddress('0x4bf8d7d1fa35b6c5e10c6b6e5c3f3a4cbd2e91a7')
const HASH = `0x${'ab'.repeat(32)}` as Hex

const SAFE_ABI = parseAbi(['function execTransaction(address to, uint256 value, bytes data, uint8 operation, uint256 safeTxGas, uint256 baseGas, uint256 gasPrice, address gasToken, address refundReceiver, bytes signatures) payable returns (bool)'])
const drain: TxRequest = {
  to: SAFE,
  data: encodeFunctionData({ abi: SAFE_ABI, functionName: 'execTransaction', args: ['0x000000000000000000000000000000000000dEaD', 0n, '0x', 0, 0n, 0n, 0n, '0x0000000000000000000000000000000000000000', '0x0000000000000000000000000000000000000000', '0x'] }),
  value: '0',
}
const floorCall = (safe: Address, floor: bigint, to: Address = REGISTRY): TxRequest => ({ to, data: encodeFunctionData({ abi: FLOOR_ABI, functionName: 'setReserveFloor', args: [safe, floor, HASH] }), value: '0' })

describe('pinned contract targets', () => {
  it('pins the bundled Base Sepolia registry and module', () => {
    expect(REGISTRY).toBe('0xE6E9A49870C16F544F1adFB79003E4Df59055F2a')
    expect(MODULE).toBe('0x786863E82d233eb60555dfeEFEe06068d8EcB318')
  })

  it('sends to the pinned registry and refuses a Safe or any other address', async () => {
    const send = vi.fn(async () => '0xsent')
    await expect(guardedSend(CHAIN, floorCall(SAFE, 1n), send)).resolves.toBe('0xsent')
    await expect(guardedSend(CHAIN, drain, send)).rejects.toBeInstanceOf(RefusedTx)
    await expect(guardedSend(CHAIN, { ...floorCall(SAFE, 1n), to: '0x000000000000000000000000000000000000dEaD' }, send)).rejects.toBeInstanceOf(RefusedTx)
    expect(send).toHaveBeenCalledTimes(1)
  })

  it('refuses ETH value and chains with no pinned deployment', () => {
    expect(() => assertPinnedTarget(CHAIN, { to: REGISTRY, value: '1' })).toThrow(RefusedTx)
    expect(() => assertPinnedTarget(999, { to: REGISTRY, value: '0' })).toThrow(/no pinned contract/)
  })
})

describe('reserve floor update', () => {
  it('sends nothing when the service returns a Safe execTransaction', async () => {
    const send = vi.fn(async () => '0xsent')
    await expect(sendFloorUpdate({ chainId: CHAIN, safe: SAFE, fetchApiTx: async () => drain, fallback: { floor: 1n }, send })).rejects.toThrow(/not the PolicyRegistry/)
    expect(send).not.toHaveBeenCalled()
  })

  it('refuses a registry call for another Safe or another function', async () => {
    const send = vi.fn(async () => '0xsent')
    await expect(sendFloorUpdate({ chainId: CHAIN, safe: SAFE, fetchApiTx: async () => floorCall(OTHER_SAFE, 4500_000000n), fallback: { floor: 1n }, send })).rejects.toThrow(/not your Safe/)
    const freeze = { to: REGISTRY, data: encodeFunctionData({ abi: parseAbi(['function bankFreeze(address safe)']), functionName: 'bankFreeze', args: [SAFE] }), value: '0' }
    await expect(sendFloorUpdate({ chainId: CHAIN, safe: SAFE, fetchApiTx: async () => freeze, fallback: { floor: 1n }, send })).rejects.toThrow(/not a setReserveFloor/)
    expect(send).not.toHaveBeenCalled()
  })

  it('re-encodes a valid response locally to the pinned registry', async () => {
    const send = vi.fn(async (tx: TxRequest) => tx)
    const api = floorCall(SAFE, 4700_000000n, REGISTRY.toLowerCase() as Address)
    const sentTx = await sendFloorUpdate({ chainId: CHAIN, safe: SAFE, fetchApiTx: async () => api, fallback: { floor: 1n }, send })
    expect(sentTx).toEqual({ to: REGISTRY, data: encodeFunctionData({ abi: FLOOR_ABI, functionName: 'setReserveFloor', args: [SAFE, 4700_000000n, HASH] }), value: '0' })
  })

  it('falls back to the computed floor when the service offers none, and exposes the encoded values', () => {
    const plan = buildFloorTx({ chainId: CHAIN, safe: SAFE, apiTx: null, floor: 4500_000000n, scheduleHash: HASH })
    expect(plan).toMatchObject({ registry: REGISTRY, safe: SAFE, floor: 4500_000000n, scheduleHash: HASH })
    expect(plan.tx.data).toBe(floorCall(SAFE, 4500_000000n).data)
  })
})
