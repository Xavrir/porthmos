import { createConfig, http, type CreateConnectorFn } from 'wagmi'
import { coinbaseWallet, injected, walletConnect } from 'wagmi/connectors'
import { baseSepolia, foundry } from 'wagmi/chains'

export const RPC_URLS: Record<number, string> = {
  [foundry.id]: (import.meta.env.VITE_RPC_URL_31337 as string | undefined) ?? 'http://127.0.0.1:8545',
  [baseSepolia.id]: (import.meta.env.VITE_RPC_URL_84532 as string | undefined) ?? 'https://sepolia.base.org',
}

export const SITE_URL = 'https://porthmos.vercel.app'
export const SITE_ICON = `${SITE_URL}/brand/porthmos-mark.png`
export const WALLETCONNECT_PROJECT_ID = (import.meta.env.VITE_WALLETCONNECT_PROJECT_ID as string | undefined)?.trim() || ''

// Only connectors the visitor picks are ever loaded: the Coinbase and WalletConnect SDKs are dynamic imports inside wagmi.
const smartWallet = coinbaseWallet({ appName: 'Porthmos', appLogoUrl: SITE_ICON, preference: { options: 'smartWalletOnly' } })
const connectors: CreateConnectorFn[] = [
  injected(),
  // wagmi hides an EIP-6963 wallet whose rdns matches a configured connector; without the rdns the Coinbase
  // extension still appears as its own entry next to Smart Wallet.
  ((config) => ({ ...smartWallet(config), rdns: undefined })) as CreateConnectorFn,
]
if (WALLETCONNECT_PROJECT_ID) {
  connectors.push(walletConnect({
    projectId: WALLETCONNECT_PROJECT_ID,
    showQrModal: true,
    metadata: { name: 'Porthmos', description: 'Agent treasury with on-chain guardrails on Base Sepolia', url: SITE_URL, icons: [SITE_ICON] },
    qrModalOptions: { themeMode: 'dark' },
  }))
}

export const wagmiConfig = createConfig({
  chains: [foundry, baseSepolia],
  connectors,
  multiInjectedProviderDiscovery: true,
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
  if (chainId === 1) return 'Ethereum (1)'
  if (chainId === 8453) return 'Base (8453)'
  return chainId ? `Chain ${chainId}` : 'Unknown chain'
}
