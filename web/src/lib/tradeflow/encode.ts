import { concatHex, encodeFunctionData, getAddress, hexToBigInt, numberToHex, size, sliceHex, zeroAddress, type Address, type Hex } from 'viem'
import { prevalidatedSignature, SAFE_ABI } from '../onboard/safe'
import { ERC20_ABI, ESCROW_ABI, MULTISEND_ABI } from './abi'
import type { Terms } from './model'

export type InnerCall = { operation: number; to: Address; value: bigint; data: Hex }

// MultiSendCallOnly v1.4.1 packing per call: operation uint8, to address, value uint256, data length uint256, data.
export function packMultiSend(calls: { to: Address; data: Hex }[]): Hex {
  return concatHex(calls.map((c) => concatHex([
    '0x00', getAddress(c.to).toLowerCase() as Hex, numberToHex(0n, { size: 32 }), numberToHex(BigInt(size(c.data)), { size: 32 }), c.data,
  ])))
}

export function unpackMultiSend(packed: Hex): InnerCall[] {
  const out: InnerCall[] = []
  const total = size(packed)
  let at = 0
  while (at < total) {
    if (total - at < 85) throw new Error('truncated MultiSend entry')
    const operation = Number(hexToBigInt(sliceHex(packed, at, at + 1)))
    const to = getAddress(sliceHex(packed, at + 1, at + 21))
    const value = hexToBigInt(sliceHex(packed, at + 21, at + 53))
    const len = hexToBigInt(sliceHex(packed, at + 53, at + 85))
    if (len > BigInt(total - at - 85)) throw new Error('MultiSend entry data overruns the batch')
    const n = Number(len)
    const data = n ? sliceHex(packed, at + 85, at + 85 + n) : '0x'
    out.push({ operation, to, value, data })
    at += 85 + n
  }
  return out
}

export function safeExec(to: Address, data: Hex, operation: 0 | 1, owner: Address): Hex {
  return encodeFunctionData({
    abi: SAFE_ABI, functionName: 'execTransaction',
    args: [getAddress(to), 0n, data, operation, 0n, 0n, 0n, zeroAddress, zeroAddress, prevalidatedSignature(owner)],
  })
}

export type FundAddresses = { usdc: Address; tradeEscrow: Address; multiSendCallOnly: Address }

export type FundOrder = {
  safe: Address
  owner: Address
  supplier: Address
  total: bigint
  termsHash: Hex
  terms: Terms[]
}

export function approveCall(a: FundAddresses, total: bigint): Hex {
  return encodeFunctionData({ abi: ERC20_ABI, functionName: 'approve', args: [getAddress(a.tradeEscrow), total] })
}

export function createOrderCall(o: Pick<FundOrder, 'supplier' | 'total' | 'termsHash' | 'terms'>): Hex {
  const ms = o.terms.map((t) => ({ ...t, issuer: getAddress(t.issuer) }))
  return encodeFunctionData({ abi: ESCROW_ABI, functionName: 'createOrder', args: [getAddress(o.supplier), o.total, o.termsHash, ms as never] })
}

export function fundOrderData(a: FundAddresses, o: FundOrder): { exec: Hex; batch: Hex; approve: Hex; create: Hex } {
  const approve = approveCall(a, o.total)
  const create = createOrderCall(o)
  const batch = encodeFunctionData({ abi: MULTISEND_ABI, functionName: 'multiSend', args: [packMultiSend([{ to: a.usdc, data: approve }, { to: a.tradeEscrow, data: create }])] })
  return { exec: safeExec(a.multiSendCallOnly, batch, 1, o.owner), batch, approve, create }
}

export function waiveData(escrow: Address, owner: Address, orderId: bigint, index: number): Hex {
  return safeExec(escrow, encodeFunctionData({ abi: ESCROW_ABI, functionName: 'waive', args: [orderId, index] }), 0, owner)
}

export function refundData(escrow: Address, owner: Address, orderId: bigint): Hex {
  return safeExec(escrow, encodeFunctionData({ abi: ESCROW_ABI, functionName: 'refund', args: [orderId] }), 0, owner)
}
