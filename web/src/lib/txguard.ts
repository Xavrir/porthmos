import { decodeFunctionData, encodeFunctionData, isAddress as viemIsAddress, parseAbi, type Address, type Hex } from 'viem'
import { REPLAY_DEPLOYMENT } from '../replay/recorded'
import type { TxRequest } from './types'

const isAddress = (a: unknown): a is Address => typeof a === 'string' && viemIsAddress(a, { strict: false })
const isAddressEqual = (a: string, b: string) => a.toLowerCase() === b.toLowerCase()

type PinnedDeployment = { chainId: number; registry: Address; module: Address; safe: Address }

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

export function assertPinnedTarget(chainId: number, tx: Pick<TxRequest, 'to' | 'value'>, pinned = PINNED): void {
  const d = pinnedFor(chainId, pinned)
  if (!d) throw new RefusedTx(`This build has no pinned contract addresses for chain ${chainId}, so it sends nothing there.`)
  if (!isAddress(tx.to) || ![d.registry, d.module].some((a) => isAddressEqual(a, tx.to))) {
    throw new RefusedTx(`Refused: ${tx.to} is not a Porthmos contract on this chain. Nothing was sent.`)
  }
  if (BigInt(tx.value || '0') !== 0n) throw new RefusedTx('Refused: Porthmos never sends ETH with a contract call. Nothing was sent.')
}

export function guardedSend<T>(chainId: number, tx: TxRequest, send: (tx: TxRequest) => Promise<T>, pinned = PINNED): Promise<T> {
  try {
    assertPinnedTarget(chainId, tx, pinned)
  } catch (e) {
    return Promise.reject(e)
  }
  return send(tx)
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
