import { baseSepolia, foundry } from 'viem/chains'
import { numberToHex } from 'viem'
import { RPC_URLS } from './wallet'

export type ConnectorLike = { id: string; name: string; type: string; icon?: string; rdns?: string | readonly string[] }

export type WalletKind = 'injected' | 'smart' | 'walletconnect'

export type WalletOption = {
  id: string
  name: string
  icon: string | null
  kind: WalletKind
  detail: string
  last: boolean
}

export const INSTALL_LINKS = [
  { name: 'MetaMask', href: 'https://metamask.io/download/' },
  { name: 'Coinbase Wallet', href: 'https://www.coinbase.com/wallet/downloads' },
] as const

// EIP-6963 says icons are data URIs; anything else could load a third-party URL or script, so it is not rendered.
export function safeIcon(icon: string | undefined): string | null {
  if (!icon) return null
  return /^data:image\/(svg\+xml|png|webp|jpeg|gif)[;,]/i.test(icon.trim()) ? icon.trim() : null
}

const GENERIC_INJECTED = 'injected'
const SMART = 'coinbaseWalletSDK'
const WALLETCONNECT = 'walletConnect'

// Builds the picker list from wagmi's connectors: one entry per EIP-6963 wallet with its own name and icon, the
// legacy window.ethereum entry only when no wallet announced itself, then Smart Wallet and WalletConnect.
export function walletOptions(connectors: readonly ConnectorLike[], opts: { lastId?: string | null; legacyInjected: boolean }): WalletOption[] {
  const seen = new Set<string>()
  const announced: WalletOption[] = []
  let smart: WalletOption | null = null
  let wc: WalletOption | null = null
  let legacy: WalletOption | null = null
  for (const c of connectors) {
    if (c.id === SMART || c.type === 'coinbaseWallet') {
      smart ??= { id: c.id, name: 'Coinbase Smart Wallet', icon: null, kind: 'smart', detail: 'Passkey wallet. No extension needed.', last: false }
      continue
    }
    if (c.id === WALLETCONNECT || c.type === 'walletConnect') {
      wc ??= { id: c.id, name: 'WalletConnect', icon: null, kind: 'walletconnect', detail: 'Scan a QR code with a phone wallet.', last: false }
      continue
    }
    if (c.type !== 'injected') continue
    if (c.id === GENERIC_INJECTED) {
      legacy ??= { id: c.id, name: 'Browser wallet', icon: null, kind: 'injected', detail: 'The wallet in this browser.', last: false }
      continue
    }
    const key = (typeof c.rdns === 'string' ? c.rdns : c.id).toLowerCase()
    const nameKey = `name:${c.name.trim().toLowerCase()}`
    if (seen.has(key) || seen.has(nameKey)) continue
    seen.add(key)
    seen.add(nameKey)
    announced.push({ id: c.id, name: c.name.trim() || 'Browser wallet', icon: safeIcon(c.icon), kind: 'injected', detail: 'Installed', last: false })
  }
  const list = [...announced]
  if (!announced.length && legacy && opts.legacyInjected) list.push(legacy)
  if (smart) list.push(smart)
  if (wc) list.push(wc)
  const i = opts.lastId ? list.findIndex((w) => w.id === opts.lastId) : -1
  if (i >= 0) {
    const [hit] = list.splice(i, 1)
    list.unshift({ ...hit, last: true })
  }
  return list
}

export function hasInstalledWallet(options: readonly WalletOption[]): boolean {
  return options.some((o) => o.kind === 'injected')
}

const LAST_KEY = 'porthmos.last-wallet'

export function readLastWallet(): string | null {
  try { return localStorage.getItem(LAST_KEY) } catch { return null }
}

export function rememberWallet(id: string): void {
  try { localStorage.setItem(LAST_KEY, id) } catch { /* the list just shows no "last used" badge */ }
}

export type NetworkStatus = 'ok' | 'wrong' | 'unknown'

export function networkStatus(walletChainId: number | undefined, target: number): NetworkStatus {
  if (!walletChainId) return 'unknown'
  return walletChainId === target ? 'ok' : 'wrong'
}

// EIP-3085 parameters for wallet_addEthereumChain when the wallet does not know the chain yet (error 4902).
export function addChainParams(chainId: number) {
  if (chainId === baseSepolia.id) {
    return {
      chainId: numberToHex(baseSepolia.id), chainName: 'Base Sepolia', nativeCurrency: { name: 'Sepolia Ether', symbol: 'ETH', decimals: 18 },
      rpcUrls: ['https://sepolia.base.org'], blockExplorerUrls: ['https://sepolia.basescan.org'],
    }
  }
  if (chainId === foundry.id) {
    return {
      chainId: numberToHex(foundry.id), chainName: 'Local Anvil', nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
      rpcUrls: [RPC_URLS[foundry.id]], blockExplorerUrls: undefined,
    }
  }
  return null
}

export type WalletErrorKind = 'rejected' | 'pending' | 'unsupported' | 'unknown-chain' | 'failed'

export function walletErrorKind(e: unknown): WalletErrorKind {
  const walk = (x: unknown, depth = 0): { code?: number; message: string } => {
    const o = (x ?? {}) as { code?: number; message?: string; shortMessage?: string; cause?: unknown; details?: string }
    const message = [o.shortMessage, o.message, o.details].filter(Boolean).join(' ')
    if (typeof o.code === 'number' || depth > 4 || !o.cause) return { code: o.code, message }
    const inner = walk(o.cause, depth + 1)
    return { code: inner.code, message: `${message} ${inner.message}` }
  }
  const { code, message } = walk(e)
  if (code === 4001 || /user (rejected|denied|closed)|rejected the request|request rejected|user cancel/i.test(message)) return 'rejected'
  if (code === -32002 || /already pending|request already/i.test(message)) return 'pending'
  if (code === 4902 || /unrecognized chain|unknown chain|chain .*not (been )?added/i.test(message)) return 'unknown-chain'
  if (code === 4200 || /not supported|unsupported/i.test(message)) return 'unsupported'
  return 'failed'
}

export type ConnectState =
  | { step: 'list' }
  | { step: 'connecting'; walletId: string }
  | { step: 'rejected'; walletId: string }
  | { step: 'error'; walletId: string; message: string }
  | { step: 'wrong-network'; address: string; chainId: number; note?: string }
  | { step: 'switching'; address: string; chainId: number }
  | { step: 'connected'; address: string; chainId: number }

export type ConnectEvent =
  | { type: 'pick'; walletId: string }
  | { type: 'connected'; address: string; chainId: number }
  | { type: 'failed'; error: unknown; message?: string }
  | { type: 'switch' }
  | { type: 'switched'; chainId: number }
  | { type: 'switch-failed'; error: unknown }
  | { type: 'chain'; chainId: number }
  | { type: 'back' }

export function connectReducer(target: number) {
  return (s: ConnectState, e: ConnectEvent): ConnectState => {
    switch (e.type) {
      case 'pick': return { step: 'connecting', walletId: e.walletId }
      case 'connected': return e.chainId === target ? { step: 'connected', address: e.address, chainId: e.chainId } : { step: 'wrong-network', address: e.address, chainId: e.chainId }
      case 'failed': {
        if (s.step !== 'connecting') return s
        const kind = walletErrorKind(e.error)
        if (kind === 'rejected') return { step: 'rejected', walletId: s.walletId }
        return { step: 'error', walletId: s.walletId, message: kind === 'pending' ? 'Your wallet already has a request open. Open the wallet and finish or close it, then try again.' : (e.message ?? 'The wallet did not connect.') }
      }
      case 'switch': return s.step === 'wrong-network' ? { step: 'switching', address: s.address, chainId: s.chainId } : s
      case 'switched':
      case 'chain':
        if (s.step !== 'wrong-network' && s.step !== 'switching' && s.step !== 'connected') return s
        return e.chainId === target ? { step: 'connected', address: s.address, chainId: e.chainId } : { step: 'wrong-network', address: s.address, chainId: e.chainId }
      case 'switch-failed': {
        if (s.step !== 'switching') return s
        const kind = walletErrorKind(e.error)
        const note = kind === 'rejected' ? 'You declined the switch in your wallet.' : kind === 'unsupported' ? 'This wallet cannot switch networks from a website. Switch it to the right network in the wallet itself.' : 'The wallet could not switch networks. Try again, or switch in the wallet itself.'
        return { step: 'wrong-network', address: s.address, chainId: s.chainId, note }
      }
      case 'back': return { step: 'list' }
    }
  }
}
