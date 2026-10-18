import type { Address } from 'viem'
import type { Mode } from './api/contract'
import type { Role } from './types'

export type Gate = 'allow' | 'wait' | 'signin'

export type GateInput = {
  phase: 'probing' | 'ready'
  mode: Mode
  replayChosen: boolean
  identity: 'none' | 'replay' | 'demo' | 'wallet' | 'local'
  localConfirmed: boolean
  signedIn: boolean
  storedSignIn: boolean
  restoring: boolean
}

export function gate(i: GateInput): Gate {
  const g = baseGate(i)
  // A stored wallet session is taken over by an effect after this render, and wagmi may still be reconnecting the
  // wallet; redirecting now would drop a valid session on every reload.
  return g === 'signin' && i.restoring ? 'wait' : g
}

function baseGate(i: GateInput): Gate {
  // While the service is probed, wait only if something stored in this tab can still open a session.
  if (i.phase === 'probing') return i.replayChosen || i.storedSignIn || i.signedIn ? 'wait' : 'signin'
  if (i.mode === 'replay') return i.replayChosen ? 'allow' : 'signin'
  if (i.identity === 'demo') return 'allow'
  if (i.identity === 'local') return i.localConfirmed ? 'allow' : 'signin'
  if (i.identity === 'wallet') return i.signedIn ? 'allow' : 'signin'
  return 'signin'
}

export type StoredWalletSession = { role: Role; address: Address; chainId: number; api: string }

export type RestoreInput = {
  stored: StoredWalletSession | null
  walletPending: boolean
  graceOver: boolean
  identity: GateInput['identity']
  role: Role | null
  address: Address | null
  chainId: number
  api: string
  taken: boolean
}

// Whether a wallet session stored in this tab may still be restored: the wallet is reconnecting (for a bounded
// time), or it is back as the stored address and role and the session has not been taken over yet.
export function restoringSession(i: RestoreInput): boolean {
  const s = i.stored
  if (!s) return false
  if (i.walletPending && !i.graceOver) return true
  return i.identity === 'wallet' && !i.taken && s.role === i.role && !!i.address &&
    s.address.toLowerCase() === i.address.toLowerCase() && s.chainId === i.chainId && s.api === i.api
}

export const APP_ROUTES = ['/treasury', '/copilot', '/risk', '/audit', '/bank', '/orders'] as const

export function isAppPath(path: string): boolean {
  return APP_ROUTES.some((r) => path === r || path.startsWith(`${r}/`))
}

export function homeFor(seat: Role): string {
  return seat === 'bank' ? '/bank' : '/treasury'
}

export function returnPath(from: unknown, fallback: string): string {
  if (typeof from !== 'string' || !from.startsWith('/') || from.startsWith('//')) return fallback
  return isAppPath(from.split(/[?#]/)[0]) ? from : fallback
}

export type DeviceInput = {
  phase: 'probing' | 'ready'
  serviceUp: boolean
  configChainId: number | null
  wallet: { chainId: number; owner: Address; ownerVia: 'key' | 'wallet'; safe: Address | null } | null
  tenant: { owner: Address; safe: Address } | null
}

export type Device =
  | { status: 'none' }
  | { status: 'checking'; owner: Address }
  | { status: 'offline'; owner: Address }
  | { status: 'wrong-chain'; owner: Address; chainId: number; want: number }
  | { status: 'unfinished'; owner: Address; safe: Address | null }
  | { status: 'ready'; owner: Address; safe: Address; ownerVia: 'key' | 'wallet' }

export function deviceStatus(i: DeviceInput): Device {
  const w = i.wallet
  if (!w) return { status: 'none' }
  if (i.phase === 'probing') return { status: 'checking', owner: w.owner }
  if (!i.serviceUp || i.configChainId === null) return { status: 'offline', owner: w.owner }
  if (w.chainId !== i.configChainId) return { status: 'wrong-chain', owner: w.owner, chainId: w.chainId, want: i.configChainId }
  if (i.tenant && i.tenant.owner.toLowerCase() === w.owner.toLowerCase()) return { status: 'ready', owner: w.owner, safe: i.tenant.safe, ownerVia: w.ownerVia }
  return { status: 'unfinished', owner: w.owner, safe: w.safe }
}

export const FORGET_WORD = 'FORGET'

export function forgetConfirmed(typed: string): boolean {
  return typed.trim().toUpperCase() === FORGET_WORD
}
