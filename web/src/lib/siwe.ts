import { getAddress, isAddressEqual, type Address } from 'viem'
import { createSiweMessage, parseSiweMessage } from 'viem/siwe'
import type { Role } from './types'

// The service accepts a message for at most 10 minutes after Issued At and refuses an Expiration Time beyond 1 hour.
export const SIWE_TTL_MS = 10 * 60_000

export const ACTIVATION_STATEMENT = 'Activate my Porthmos treasury and sign in as owner.'

export const roleResource = (role: Role) => `urn:porthmos:role:${role}`
export const safeResource = (safe: Address) => `urn:porthmos:safe:${getAddress(safe)}`
export const sessionStatement = (role: Role) => `Sign in to Porthmos as ${role}.`

export type SiweOrigin = { domain: string; uri: string }
export type SiwePurpose = { kind: 'session'; role: Role } | { kind: 'activate'; safe: Address }
export type AuthNonce = { nonce: string; issuedAt?: string; expiresAt?: string }

export function pageOrigin(): SiweOrigin {
  return { domain: window.location.host, uri: window.location.origin }
}

export function buildSiwe(p: { purpose: SiwePurpose; address: Address; chainId: number; nonce: string; origin: SiweOrigin; now?: Date }): string {
  const now = p.now ?? new Date()
  return createSiweMessage({
    domain: p.origin.domain,
    uri: p.origin.uri,
    address: getAddress(p.address),
    chainId: p.chainId,
    nonce: p.nonce,
    version: '1',
    issuedAt: now,
    expirationTime: new Date(now.getTime() + SIWE_TTL_MS),
    statement: p.purpose.kind === 'activate' ? ACTIVATION_STATEMENT : sessionStatement(p.purpose.role),
    resources: p.purpose.kind === 'activate' ? [roleResource('owner'), safeResource(p.purpose.safe)] : [roleResource(p.purpose.role)],
  })
}

// Checked again right before a key signs, so a bug elsewhere can never get a different text signed.
export function siweProblem(message: string, want: { purpose: SiwePurpose; address: Address; chainId: number; origin: SiweOrigin; now?: Date }): string | null {
  const m = parseSiweMessage(message)
  const now = (want.now ?? new Date()).getTime()
  if (m.domain !== want.origin.domain) return `the message names ${m.domain ?? 'no domain'}, not ${want.origin.domain}`
  if (m.uri !== want.origin.uri) return 'the message URI is not this site'
  if (!m.address || !isAddressEqual(m.address, want.address)) return 'the message is for a different address'
  if (m.chainId !== want.chainId) return `the message is for chain ${m.chainId}, not ${want.chainId}`
  if (m.version !== '1') return 'the message is not SIWE version 1'
  const expected = want.purpose.kind === 'activate' ? ACTIVATION_STATEMENT : sessionStatement(want.purpose.role)
  if (m.statement !== expected) return 'the statement is not the Porthmos one'
  const res = want.purpose.kind === 'activate' ? [roleResource('owner'), safeResource(want.purpose.safe)] : [roleResource(want.purpose.role)]
  if (JSON.stringify(m.resources ?? []) !== JSON.stringify(res)) return 'the resources do not name this role'
  if (!m.expirationTime || m.expirationTime.getTime() <= now) return 'the message has expired'
  if (!m.issuedAt || m.issuedAt.getTime() > now + 60_000) return 'the message is dated in the future'
  if (!m.nonce || !/^[a-zA-Z0-9]{8,}$/.test(m.nonce)) return 'the message has no valid nonce'
  return null
}

export function siweExpiry(message: string): number | null {
  return parseSiweMessage(message).expirationTime?.getTime() ?? null
}
