import { useEffect, useState } from 'react'
import { createPublicClient, http, parseAbi, parseAbiItem, type Address, type Hex } from 'viem'
import { baseSepolia } from 'viem/chains'
import { REPLAY_DEPLOY } from '../deployment'
import { EVIDENCE_SCENARIOS } from '../../replay/evidence'

export type LiveExecution = { op: number; vault: Address; assets: number; block: number; tx: Hex }

export type LiveVault = { name: string; address: Address; assets: number; quarantined: boolean }

export type LiveChain = {
  status: 'loading' | 'live' | 'unreachable'
  block: number | null
  safeUsdc: number | null
  price: number | null
  ageSeconds: number | null
  vaults: LiveVault[] | null
  floor: number | null
  frozen: { owner: boolean; bank: boolean } | null
  policyVersion: number | null
  executions: LiveExecution[]
  addresses: { safe: Address; module: Address; vaultA: Address; vaultB: Address }
}

const RPC = (import.meta.env.VITE_RPC_URL_84532 as string | undefined) ?? 'https://sepolia.base.org'
const CHUNK = 200n
const POLL_MS = 15000
const CACHE_KEY = 'aegis.live-84532'

const ERC20 = parseAbi(['function balanceOf(address) view returns (uint256)'])
const VAULT = parseAbi(['function balanceOf(address) view returns (uint256)', 'function convertToAssets(uint256) view returns (uint256)'])
const REGISTRY = parseAbi([
  'function reserveFloor(address) view returns (uint256)',
  'function ownerFrozen(address) view returns (bool)',
  'function bankFrozen(address) view returns (bool)',
  'function policyVersion(address) view returns (uint64)',
  'function quarantined(address, address) view returns (bool)',
])
const FEED = parseAbi(['function latestRoundData() view returns (uint80, int256, uint256, uint256, uint80)'])
const EXECUTED = parseAbiItem('event AegisExecuted(address indexed safe, bytes32 indexed darHash, uint8 op, address indexed vault, uint256 assets, uint256 shares, uint8 tier, bytes32 evidenceHash)')

type Deployment = { usdc: Address; priceFeed: Address; module: Address; registry: Address; safe: Address; vaultA: Address; vaultB: Address }

let shared: { state: LiveChain; listeners: Set<(s: LiveChain) => void>; timer: number | null; scannedTo: bigint | null; busy: boolean } | null = null

function readCache(): Pick<LiveChain, 'executions'> | null {
  try {
    const raw = sessionStorage.getItem(CACHE_KEY)
    return raw ? (JSON.parse(raw) as Pick<LiveChain, 'executions'>) : null
  } catch {
    return null
  }
}

function writeCache(executions: LiveExecution[]) {
  try { sessionStorage.setItem(CACHE_KEY, JSON.stringify({ executions })) } catch { /* cache is optional */ }
}

async function loadDeployment(): Promise<Deployment> {
  try {
    const res = await fetch('/deployments/84532.json', { cache: 'no-store' })
    if (res.ok) return (await res.json()) as Deployment
  } catch { /* fall back to the bundled copy */ }
  return REPLAY_DEPLOY as unknown as Deployment
}

function evidenceWindow(): [bigint, bigint] | null {
  const blocks = EVIDENCE_SCENARIOS.flatMap((s) => s.txs.map((t) => t.block)).filter(Boolean).sort((a, b) => b - a)
  if (!blocks.length) return null
  const to = BigInt(blocks[0])
  return [to - CHUNK + 1n, to]
}

function publish(patch: Partial<LiveChain>) {
  if (!shared) return
  shared.state = { ...shared.state, ...patch }
  for (const l of shared.listeners) l(shared.state)
}

function start() {
  const client = createPublicClient({ chain: baseSepolia, transport: http(RPC, { timeout: 8000, retryCount: 1 }) })
  let dep: Deployment | null = null

  const logs = async (from: bigint, to: bigint): Promise<LiveExecution[]> => {
    const out: LiveExecution[] = []
    for (let a = from; a <= to; a += CHUNK) {
      const b = a + CHUNK - 1n < to ? a + CHUNK - 1n : to
      const found = await client.getLogs({ address: dep!.module, event: EXECUTED, args: { safe: dep!.safe }, fromBlock: a, toBlock: b })
      for (const l of found) out.push({ op: Number(l.args.op), vault: l.args.vault!, assets: Number(l.args.assets) / 1e6, block: Number(l.blockNumber), tx: l.transactionHash })
    }
    return out
  }

  const merge = (found: LiveExecution[]) => {
    const all = new Map(shared!.state.executions.map((e) => [e.tx, e]))
    for (const e of found) all.set(e.tx, e)
    const sorted = [...all.values()].sort((x, y) => y.block - x.block).slice(0, 6)
    writeCache(sorted)
    return sorted
  }

  const poll = async () => {
    if (!shared || shared.busy || document.hidden) return
    shared.busy = true
    try {
      dep ??= await loadDeployment()
      const latest = await client.getBlock()
      const d = dep
      const [bal, round] = await Promise.all([
        client.readContract({ address: d.usdc, abi: ERC20, functionName: 'balanceOf', args: [d.safe] }),
        client.readContract({ address: d.priceFeed, abi: FEED, functionName: 'latestRoundData' }),
      ])
      const policy = await Promise.all([
        client.readContract({ address: d.registry, abi: REGISTRY, functionName: 'reserveFloor', args: [d.safe] }),
        client.readContract({ address: d.registry, abi: REGISTRY, functionName: 'ownerFrozen', args: [d.safe] }),
        client.readContract({ address: d.registry, abi: REGISTRY, functionName: 'bankFrozen', args: [d.safe] }),
        client.readContract({ address: d.registry, abi: REGISTRY, functionName: 'policyVersion', args: [d.safe] }),
      ]).catch(() => null)
      const vaults = await Promise.all(([['Vault A', d.vaultA], ['Vault B', d.vaultB]] as const).map(async ([name, address]) => {
        const shares = await client.readContract({ address, abi: VAULT, functionName: 'balanceOf', args: [d.safe] })
        const [assets, quarantined] = await Promise.all([
          shares > 0n ? client.readContract({ address, abi: VAULT, functionName: 'convertToAssets', args: [shares] }) : Promise.resolve(0n),
          client.readContract({ address: d.registry, abi: REGISTRY, functionName: 'quarantined', args: [d.safe, address] }),
        ])
        return { name, address, assets: Number(assets) / 1e6, quarantined }
      })).catch(() => null)
      let executions = shared.state.executions
      if (shared.scannedTo === null) {
        const recent = await logs(latest.number - CHUNK * 3n + 1n, latest.number)
        const win = !recent.length && !executions.length ? evidenceWindow() : null
        executions = merge([...recent, ...(win ? await logs(win[0], win[1]) : [])])
      } else if (latest.number > shared.scannedTo) {
        const from = latest.number - shared.scannedTo > CHUNK ? latest.number - CHUNK + 1n : shared.scannedTo + 1n
        executions = merge(await logs(from, latest.number))
      }
      shared.scannedTo = latest.number
      publish({
        status: 'live',
        block: Number(latest.number),
        safeUsdc: Number(bal) / 1e6,
        price: Number(round[1]) / 1e8,
        ageSeconds: Math.max(0, Number(latest.timestamp - round[3])),
        vaults,
        floor: policy ? Number(policy[0]) / 1e6 : null,
        frozen: policy ? { owner: policy[1], bank: policy[2] } : null,
        policyVersion: policy ? Number(policy[3]) : null,
        executions,
        addresses: { safe: dep.safe, module: dep.module, vaultA: dep.vaultA, vaultB: dep.vaultB },
      })
    } catch {
      if (shared.state.status !== 'live') publish({ status: 'unreachable' })
    } finally {
      shared.busy = false
    }
  }

  void poll()
  shared!.timer = window.setInterval(poll, POLL_MS)
  document.addEventListener('visibilitychange', () => { if (!document.hidden) void poll() })
}

export function useBaseSepoliaLive(): LiveChain {
  if (!shared) {
    shared = {
      state: {
        status: 'loading', block: null, safeUsdc: null, price: null, ageSeconds: null, vaults: null, floor: null, frozen: null, policyVersion: null,
        executions: readCache()?.executions ?? [],
        addresses: { safe: REPLAY_DEPLOY.safe, module: REPLAY_DEPLOY.module, vaultA: REPLAY_DEPLOY.vaultA, vaultB: REPLAY_DEPLOY.vaultB },
      },
      listeners: new Set(), timer: null, scannedTo: null, busy: false,
    }
  }
  const [state, setState] = useState<LiveChain>(shared.state)
  useEffect(() => {
    const s = shared!
    s.listeners.add(setState)
    if (s.timer === null) start()
    return () => { s.listeners.delete(setState) }
  }, [])
  return state
}
