import { decodeFunctionData, encodeFunctionData, getAddress, isAddress as viemIsAddress, parseAbi, zeroAddress, type Address, type Hex } from 'viem'
import { REPLAY_DEPLOYMENT } from '../replay/recorded'
import { prevalidatedSignature, SAFE_ABI } from './onboard/safe'
import { ERC20_ABI, ESCROW_ABI, MULTISEND_ABI } from './tradeflow/abi'
import { approveCall, createOrderCall, fundOrderData, refundData, unpackMultiSend, waiveData, type FundOrder } from './tradeflow/encode'
import { MILESTONES, type Issuers, type Terms } from './tradeflow/model'
import type { TxRequest } from './types'

const isAddress = (a: unknown): a is Address => typeof a === 'string' && viemIsAddress(a, { strict: false })
const isAddressEqual = (a: string, b: string) => a.toLowerCase() === b.toLowerCase()

type PinnedDeployment = {
  chainId: number
  registry: Address
  module: Address
  safe: Address
  usdc?: Address
  tradeEscrow?: Address
  multiSendCallOnly?: Address
  issuers?: Partial<Issuers>
}

// Compiled into the bundle at build time, so the API can never change which contracts the browser keys may call.
const FILES = import.meta.glob<PinnedDeployment>('../../public/deployments/*.json', { eager: true, import: 'default' })

function buildPinned(): Record<number, PinnedDeployment> {
  const out: Record<number, PinnedDeployment> = {}
  const replay = REPLAY_DEPLOYMENT as unknown as PinnedDeployment
  out[replay.chainId] = replay
  for (const d of Object.values(FILES)) {
    if (d && typeof d.chainId === 'number' && isAddress(d.registry) && isAddress(d.module)) out[d.chainId] = d
  }
  return out
}

export const PINNED: Readonly<Record<number, PinnedDeployment>> = buildPinned()

export const FLOOR_ABI = parseAbi(['function setReserveFloor(address safe, uint256 floor, bytes32 scheduleHash)'])

export class RefusedTx extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'RefusedTx'
  }
}

export function pinnedFor(chainId: number, pinned = PINNED): PinnedDeployment | null {
  return pinned[chainId] ?? null
}

export function pinnedRegistry(chainId: number, pinned = PINNED): Address {
  const d = pinnedFor(chainId, pinned)
  if (!d) throw new RefusedTx(`This build has no pinned contract addresses for chain ${chainId}, so it sends nothing there.`)
  return d.registry
}

// The Safe and its owner the browser key acts for. A Safe-targeted transaction is checked only against these.
export type GuardContext = { safe?: Address | null; owner?: Address | null }

export function assertPinnedTarget(chainId: number, tx: Pick<TxRequest, 'to' | 'value'> & { data?: Hex }, pinned = PINNED, ctx: GuardContext = {}): void {
  const d = pinnedFor(chainId, pinned)
  if (!d) throw new RefusedTx(`This build has no pinned contract addresses for chain ${chainId}, so it sends nothing there.`)
  if (BigInt(tx.value || '0') !== 0n) throw new RefusedTx('Refused: Porthmos never sends ETH with a contract call. Nothing was sent.')
  if (isAddress(tx.to) && [d.registry, d.module].some((a) => isAddressEqual(a, tx.to))) return
  if (isAddress(tx.to) && ctx.safe && isAddress(ctx.safe) && isAddressEqual(tx.to, ctx.safe)) {
    assertSafeTx(chainId, tx.data ?? '0x', ctx, pinned)
    return
  }
  throw new RefusedTx(`Refused: ${tx.to} is not a Porthmos contract on this chain. Nothing was sent.`)
}

export function guardedSend<T>(chainId: number, tx: TxRequest, send: (tx: TxRequest) => Promise<T>, pinned = PINNED, ctx: GuardContext = {}): Promise<T> {
  try {
    assertPinnedTarget(chainId, tx, pinned, ctx)
  } catch (e) {
    return Promise.reject(e)
  }
  return send(tx)
}

export type PinnedTradeFlow = { chainId: number; usdc: Address; tradeEscrow: Address; multiSendCallOnly: Address; issuers: Issuers }

export function pinnedTradeFlow(chainId: number, pinned = PINNED): PinnedTradeFlow | null {
  const d = pinnedFor(chainId, pinned)
  const i = d?.issuers
  if (!d || !isAddress(d.usdc) || !isAddress(d.tradeEscrow) || !isAddress(d.multiSendCallOnly) || !i || !isAddress(i.carrier) || !isAddress(i.sensor) || !isAddress(i.surveyor)) return null
  return {
    chainId, usdc: getAddress(d.usdc), tradeEscrow: getAddress(d.tradeEscrow), multiSendCallOnly: getAddress(d.multiSendCallOnly),
    issuers: { carrier: getAddress(i.carrier), sensor: getAddress(i.sensor), surveyor: getAddress(i.surveyor) },
  }
}

function requireTradeFlow(chainId: number, pinned: Record<number, PinnedDeployment>): PinnedTradeFlow {
  const tf = pinnedTradeFlow(chainId, pinned)
  if (!tf) throw new RefusedTx(`Refused: this build pins no TradeEscrow for chain ${chainId}. Nothing was sent.`)
  return tf
}

export type SafeTxShape =
  | { kind: 'fund'; supplier: Address; total: bigint; termsHash: Hex; terms: Terms[] }
  | { kind: 'waive'; orderId: bigint; index: number }
  | { kind: 'refund'; orderId: bigint }

const refuse = (why: string): never => { throw new RefusedTx(`Refused: ${why}. Nothing was sent.`) }

// The only Safe transactions a browser key may send: the funding batch, waive and refund, each against pinned addresses.
// Each decoded call is re-encoded and compared byte for byte, so trailing or non-canonical data is refused too.
export function assertSafeTx(chainId: number, data: Hex, ctx: GuardContext, pinned: Record<number, PinnedDeployment> = PINNED): SafeTxShape {
  const tf = requireTradeFlow(chainId, pinned)
  if (!ctx.safe || !ctx.owner || !isAddress(ctx.owner)) refuse('a Safe transaction needs the session Safe and its owner key')
  const owner = getAddress(ctx.owner!)
  let exec: readonly [Address, bigint, Hex, number, bigint, bigint, bigint, Address, Address, Hex]
  try {
    const d = decodeFunctionData({ abi: SAFE_ABI, data })
    if (d.functionName !== 'execTransaction') refuse('only Safe execTransaction is allowed on the Safe')
    exec = d.args as typeof exec
  } catch (e) {
    if (e instanceof RefusedTx) throw e
    return refuse('the Safe call is not an execTransaction')
  }
  const [to, value, inner, operation, safeTxGas, baseGas, gasPrice, gasToken, refundReceiver, signatures] = exec
  if (value !== 0n) refuse('the Safe transaction moves ETH')
  if (safeTxGas !== 0n || baseGas !== 0n || gasPrice !== 0n || !isAddressEqual(gasToken, zeroAddress) || !isAddressEqual(refundReceiver, zeroAddress)) refuse('the Safe transaction pays a gas refund')
  if (signatures.toLowerCase() !== prevalidatedSignature(owner).toLowerCase()) refuse('the Safe transaction is not signed by the session owner')

  let shape: SafeTxShape
  if (operation === 1) {
    if (!isAddressEqual(to, tf.multiSendCallOnly)) refuse(`the delegatecall target ${to} is not the pinned MultiSendCallOnly ${tf.multiSendCallOnly}`)
    shape = fundShape(tf, inner, ctx.safe!)
  } else if (operation === 0) {
    if (!isAddressEqual(to, tf.tradeEscrow)) refuse(`the Safe would call ${to}, not the pinned TradeEscrow ${tf.tradeEscrow}`)
    let call: { functionName: string; args: readonly unknown[] }
    try {
      call = decodeFunctionData({ abi: ESCROW_ABI, data: inner }) as typeof call
    } catch {
      return refuse('the TradeEscrow call is not waive or refund')
    }
    if (call.functionName === 'waive') shape = { kind: 'waive', orderId: call.args[0] as bigint, index: Number(call.args[1]) }
    else if (call.functionName === 'refund') shape = { kind: 'refund', orderId: call.args[0] as bigint }
    else return refuse(`the Safe may call only waive or refund on TradeEscrow, not ${call.functionName}`)
  } else {
    return refuse('unknown Safe operation')
  }
  const expected = shape.kind === 'fund'
    ? fundOrderData(tf, { safe: ctx.safe!, owner, supplier: shape.supplier, total: shape.total, termsHash: shape.termsHash, terms: shape.terms }).exec
    : shape.kind === 'waive' ? waiveData(tf.tradeEscrow, owner, shape.orderId, shape.index) : refundData(tf.tradeEscrow, owner, shape.orderId)
  if (expected.toLowerCase() !== data.toLowerCase()) refuse('the Safe transaction is not in the exact form Porthmos builds')
  return shape
}

function fundShape(tf: PinnedTradeFlow, inner: Hex, safe: Address): SafeTxShape {
  let packed: Hex
  try {
    const d = decodeFunctionData({ abi: MULTISEND_ABI, data: inner })
    packed = d.args[0] as Hex
  } catch {
    return refuse('the delegatecall is not a MultiSendCallOnly multiSend')
  }
  let calls
  try {
    calls = unpackMultiSend(packed)
  } catch (e) {
    return refuse(`the MultiSend batch is malformed (${(e as Error).message})`)
  }
  if (calls.length !== 2) refuse(`the MultiSend batch has ${calls.length} calls, not approve and createOrder`)
  const [a, c] = calls
  if (calls.some((x) => x.operation !== 0 || x.value !== 0n)) refuse('a batched call is a delegatecall or moves ETH')
  if (!isAddressEqual(a.to, tf.usdc)) refuse(`the first call goes to ${a.to}, not the pinned USDC ${tf.usdc}`)
  if (!isAddressEqual(c.to, tf.tradeEscrow)) refuse(`the second call goes to ${c.to}, not the pinned TradeEscrow ${tf.tradeEscrow}`)
  let spender: Address, allowance: bigint
  try {
    const d = decodeFunctionData({ abi: ERC20_ABI, data: a.data })
    if (d.functionName !== 'approve') throw new Error()
    ;[spender, allowance] = d.args as readonly [Address, bigint]
  } catch {
    return refuse('the first call is not USDC approve')
  }
  if (!isAddressEqual(spender, tf.tradeEscrow)) refuse(`the approval names spender ${spender}, not the pinned TradeEscrow`)
  let args: readonly [Address, bigint, Hex, readonly Terms[]]
  try {
    const d = decodeFunctionData({ abi: ESCROW_ABI, data: c.data })
    if (d.functionName !== 'createOrder') throw new Error()
    args = d.args as unknown as typeof args
  } catch {
    return refuse('the second call is not TradeEscrow.createOrder')
  }
  const [supplier, total, termsHash, ms] = args
  if (allowance !== total) refuse(`the approval (${allowance}) differs from the order total (${total})`)
  if (isAddressEqual(supplier, zeroAddress) || isAddressEqual(supplier, safe)) refuse('the supplier is empty or the Safe itself')
  if (ms.length !== 3 || ms.reduce((s, m) => s + m.amount, 0n) !== total) refuse('the milestone amounts do not add up to the total')
  ms.forEach((m, i) => {
    const want = tf.issuers[MILESTONES[i].role]
    if (!isAddressEqual(m.issuer, want)) refuse(`milestone ${i + 1} names issuer ${m.issuer}, not the bundled ${MILESTONES[i].issuerLabel.toLowerCase()} ${want}`)
  })
  if (approveCall(tf, total).toLowerCase() !== a.data.toLowerCase() || createOrderCall({ supplier, total, termsHash, terms: [...ms] }).toLowerCase() !== c.data.toLowerCase()) {
    refuse('a batched call is not in the exact form Porthmos builds')
  }
  return { kind: 'fund', supplier: getAddress(supplier), total, termsHash, terms: ms.map((m) => ({ ...m, issuer: getAddress(m.issuer) })) }
}

export type SafePlan = { tx: TxRequest; shape: SafeTxShape; safe: Address; tradeFlow: PinnedTradeFlow }

function safePlan(chainId: number, safe: Address, owner: Address, data: Hex, pinned: Record<number, PinnedDeployment>): SafePlan {
  const tx: TxRequest = { to: getAddress(safe), data, value: '0' }
  const shape = assertSafeTx(chainId, data, { safe, owner }, pinned)
  return { tx, shape, safe: getAddress(safe), tradeFlow: requireTradeFlow(chainId, pinned) }
}

export function buildFundOrderTx(chainId: number, o: FundOrder, pinned = PINNED): SafePlan {
  const tf = requireTradeFlow(chainId, pinned)
  return safePlan(chainId, o.safe, o.owner, fundOrderData(tf, o).exec, pinned)
}

export function buildWaiveTx(chainId: number, p: { safe: Address; owner: Address; orderId: bigint; index: number }, pinned = PINNED): SafePlan {
  const tf = requireTradeFlow(chainId, pinned)
  return safePlan(chainId, p.safe, p.owner, waiveData(tf.tradeEscrow, p.owner, p.orderId, p.index), pinned)
}

export function buildRefundTx(chainId: number, p: { safe: Address; owner: Address; orderId: bigint }, pinned = PINNED): SafePlan {
  const tf = requireTradeFlow(chainId, pinned)
  return safePlan(chainId, p.safe, p.owner, refundData(tf.tradeEscrow, p.owner, p.orderId), pinned)
}


export type FloorPlan = { tx: TxRequest; registry: Address; safe: Address; floor: bigint; scheduleHash: Hex }

// Only the floor and schedule hash are taken from the service; the target and the Safe are ours.
export function buildFloorTx(p: { chainId: number; safe: Address; apiTx?: TxRequest | null; floor?: bigint; scheduleHash?: Hex; pinned?: Record<number, PinnedDeployment> }): FloorPlan {
  const registry = pinnedRegistry(p.chainId, p.pinned)
  let floor = p.floor
  let scheduleHash = p.scheduleHash
  if (p.apiTx) {
    if (!isAddress(p.apiTx.to) || !isAddressEqual(p.apiTx.to, registry)) {
      throw new RefusedTx(`Refused: the service asked to send the floor update to ${p.apiTx.to}, not the PolicyRegistry ${registry}. Nothing was sent.`)
    }
    if (BigInt(p.apiTx.value || '0') !== 0n) throw new RefusedTx('Refused: the service floor update carries ETH. Nothing was sent.')
    let args: readonly [Address, bigint, Hex]
    try {
      const d = decodeFunctionData({ abi: FLOOR_ABI, data: p.apiTx.data })
      args = d.args as readonly [Address, bigint, Hex]
    } catch {
      throw new RefusedTx('Refused: the service floor update is not a setReserveFloor call. Nothing was sent.')
    }
    if (!isAddress(p.safe) || !isAddressEqual(args[0], p.safe)) {
      throw new RefusedTx(`Refused: the service floor update names Safe ${args[0]}, not your Safe ${p.safe}. Nothing was sent.`)
    }
    floor = args[1]
    scheduleHash = args[2]
  }
  if (floor === undefined || floor < 0n) throw new RefusedTx('Refused: no reserve floor to sign. Nothing was sent.')
  const hash = scheduleHash ?? (`0x${'0'.repeat(64)}` as Hex)
  const data = encodeFunctionData({ abi: FLOOR_ABI, functionName: 'setReserveFloor', args: [p.safe, floor, hash] })
  return { tx: { to: registry, data, value: '0' }, registry, safe: p.safe, floor, scheduleHash: hash }
}

export async function sendFloorUpdate<T>(p: {
  chainId: number
  safe: Address
  fetchApiTx: () => Promise<TxRequest | null>
  fallback: { floor: bigint; scheduleHash?: Hex }
  send: (tx: TxRequest) => Promise<T>
  pinned?: Record<number, PinnedDeployment>
}): Promise<T> {
  const apiTx = await p.fetchApiTx()
  const plan = buildFloorTx({ chainId: p.chainId, safe: p.safe, apiTx, floor: p.fallback.floor, scheduleHash: p.fallback.scheduleHash, pinned: p.pinned })
  return guardedSend(p.chainId, plan.tx, p.send, p.pinned)
}
