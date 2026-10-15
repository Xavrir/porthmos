import {
  createPublicClient, createWalletClient, defineChain, http, TransactionReceiptNotFoundError,
  type Account, type Chain, type Hex, type PublicClient, type TransactionReceipt,
} from 'viem'
import { baseSepolia, foundry } from 'viem/chains'

export function chainFor(chainId: number, rpcUrl: string, explorer?: string): Chain {
  const known = chainId === baseSepolia.id ? baseSepolia : chainId === foundry.id ? foundry : null
  if (known) return { ...known, rpcUrls: { default: { http: [rpcUrl] } } } as Chain
  return defineChain({
    id: chainId,
    name: `Chain ${chainId}`,
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
    rpcUrls: { default: { http: [rpcUrl] } },
    blockExplorers: explorer ? { default: { name: 'Explorer', url: explorer } } : undefined,
  })
}

const clients = new Map<string, PublicClient>()

export function publicClientFor(chainId: number, rpcUrl: string): PublicClient {
  const k = `${chainId}@${rpcUrl}`
  let c = clients.get(k)
  if (!c) {
    c = createPublicClient({ chain: chainFor(chainId, rpcUrl), transport: http(rpcUrl, { timeout: 15000, retryCount: 2 }) }) as PublicClient
    clients.set(k, c)
  }
  return c
}

export function walletClientFor(account: Account, chainId: number, rpcUrl: string) {
  return createWalletClient({ account, chain: chainFor(chainId, rpcUrl), transport: http(rpcUrl, { timeout: 20000, retryCount: 1 }) })
}

export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

export class ReceiptTimeout extends Error {
  constructor(readonly hash: Hex) {
    super('The network has not confirmed this transaction yet.')
  }
}

// Public RPCs are load-balanced, so a just-mined receipt can be missing on the next node for a few seconds.
export async function waitForReceipt(client: PublicClient, hash: Hex, timeoutMs = 90_000): Promise<TransactionReceipt> {
  const until = Date.now() + timeoutMs
  let delay = 1000
  for (;;) {
    try {
      return await client.getTransactionReceipt({ hash })
    } catch (e) {
      if (!(e instanceof TransactionReceiptNotFoundError) && !/not found|could not be found/i.test((e as Error).message ?? '')) {
        if (Date.now() > until) throw e
      }
    }
    if (Date.now() > until) throw new ReceiptTimeout(hash)
    await sleep(delay)
    delay = Math.min(Math.round(delay * 1.5), 6000)
  }
}

export async function pollUntil(check: () => Promise<boolean>, timeoutMs = 12_000): Promise<boolean> {
  const until = Date.now() + timeoutMs
  let delay = 700
  for (;;) {
    try {
      if (await check()) return true
    } catch { /* a lagging node may not know the contract yet */ }
    if (Date.now() > until) return false
    await sleep(delay)
    delay = Math.min(Math.round(delay * 1.6), 4000)
  }
}
