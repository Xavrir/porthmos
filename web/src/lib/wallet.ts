import { createConfig, http } from 'wagmi'
import { injected } from 'wagmi/connectors'
import { baseSepolia, foundry } from 'wagmi/chains'

export const RPC_URLS: Record<number, string> = {
  [foundry.id]: (import.meta.env.VITE_RPC_URL_31337 as string | undefined) ?? 'http://127.0.0.1:8545',
  [baseSepolia.id]: (import.meta.env.VITE_RPC_URL_84532 as string | undefined) ?? 'https://sepolia.base.org',
}

export const wagmiConfig = createConfig({
  chains: [foundry, baseSepolia],
  connectors: [injected()],
  transports: {
    [foundry.id]: http(RPC_URLS[foundry.id]),
    [baseSepolia.id]: http(RPC_URLS[baseSepolia.id]),
  },
})

export const EXPLORERS: Record<number, string | undefined> = {
  [baseSepolia.id]: 'https://sepolia.basescan.org',
}

export function explorerTx(chainId: number | undefined, hash: string | undefined): string | undefined {
  const base = chainId ? EXPLORERS[chainId] : undefined
  return base && hash ? `${base}/tx/${hash}` : undefined
}

export function explorerAddress(chainId: number | undefined, address: string | undefined): string | undefined {
  const base = chainId ? EXPLORERS[chainId] : undefined
  return base && address ? `${base}/address/${address}` : undefined
}

export function chainName(chainId: number | undefined): string {
  if (chainId === foundry.id) return 'Local Anvil (31337)'
  if (chainId === baseSepolia.id) return 'Base Sepolia (84532)'
  return chainId ? `Chain ${chainId}` : 'Unknown chain'
}
