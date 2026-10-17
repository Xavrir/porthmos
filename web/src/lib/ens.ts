import { useQuery } from '@tanstack/react-query'
import { createPublicClient, http, type Address } from 'viem'
import { mainnet } from 'viem/chains'

const CACHE_KEY = 'porthmos.ens.v1'
const HIT_TTL = 24 * 3600_000
const MISS_TTL = 6 * 3600_000
const TIMEOUT = 2500
const MAINNET_RPC = 'https://ethereum-rpc.publicnode.com'

type Entry = { name: string | null; at: number }

function readCache(): Record<string, Entry> {
  try {
    const v = JSON.parse(localStorage.getItem(CACHE_KEY) ?? '{}')
    return v && typeof v === 'object' ? v : {}
  } catch {
    return {}
  }
}

export function cachedEns(address: Address, now = Date.now()): Entry | null {
  const e = readCache()[address.toLowerCase()]
  if (!e || typeof e.at !== 'number') return null
  return now - e.at < (e.name ? HIT_TTL : MISS_TTL) ? e : null
}

function writeCache(address: Address, name: string | null) {
  try {
    const all = readCache()
    all[address.toLowerCase()] = { name, at: Date.now() }
    const keys = Object.keys(all)
    for (const k of keys.slice(0, Math.max(0, keys.length - 50))) delete all[k]
    localStorage.setItem(CACHE_KEY, JSON.stringify(all))
  } catch { /* uncached: the next visit asks again */ }
}

// Reverse lookup on Ethereum mainnet through a public RPC; a slow or failing lookup shows no name.
export async function lookupEns(address: Address): Promise<string | null> {
  const hit = cachedEns(address)
  if (hit) return hit.name
  const client = createPublicClient({ chain: mainnet, transport: http(MAINNET_RPC, { timeout: TIMEOUT, retryCount: 0 }) })
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    const name = await Promise.race([
      client.getEnsName({ address }),
      new Promise<null>((resolve) => { timer = setTimeout(() => resolve(null), TIMEOUT) }),
    ])
    writeCache(address, name ?? null)
    return name ?? null
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

export function useEnsName(address: Address | null | undefined, enabled: boolean) {
  return useQuery({
    queryKey: ['ens', address?.toLowerCase()],
    queryFn: () => lookupEns(address!),
    enabled: enabled && !!address,
    staleTime: HIT_TTL,
    retry: false,
    initialData: () => (address ? cachedEns(address)?.name ?? undefined : undefined),
  })
}
