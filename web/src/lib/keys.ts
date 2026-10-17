import { getAddress, isAddress, isHex, type Address, type Hex } from 'viem'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'

export const WALLET_KEY = 'aegis.wallet.v1'

export type OwnerKey = { type: 'burner'; pk: Hex } | { type: 'injected'; address: Address }

export type WalletFile = {
  version: 1
  chainId: number
  owner: OwnerKey
  bank: { pk: Hex }
  safe: Address | null
  // Optional third burner key that plays the TradeFlow supplier, so a visitor can watch the supplier side (TD 02).
  supplier?: { pk: Hex }
}

export function newWallet(chainId: number, owner?: OwnerKey): WalletFile {
  return { version: 1, chainId, owner: owner ?? { type: 'burner', pk: generatePrivateKey() }, bank: { pk: generatePrivateKey() }, safe: null }
}

export function ownerAddress(w: WalletFile): Address {
  return w.owner.type === 'burner' ? privateKeyToAccount(w.owner.pk).address : getAddress(w.owner.address)
}

export function bankAddress(w: WalletFile): Address {
  return privateKeyToAccount(w.bank.pk).address
}

export function supplierAddress(w: WalletFile): Address | null {
  return w.supplier ? privateKeyToAccount(w.supplier.pk).address : null
}

export function withSupplier(w: WalletFile): WalletFile {
  return w.supplier ? w : { ...w, supplier: { pk: generatePrivateKey() } }
}

function isKey(v: unknown): v is Hex {
  return typeof v === 'string' && isHex(v) && v.length === 66
}

export class WalletFileError extends Error {}

export function parseWallet(input: unknown): WalletFile {
  const data = typeof input === 'string' ? safeParse(input) : input
  if (!data || typeof data !== 'object') throw new WalletFileError('This is not an Porthmos key file.')
  const d = data as Record<string, unknown>
  if (d.version !== 1) throw new WalletFileError('This key file has an unknown version.')
  if (typeof d.chainId !== 'number' || !Number.isInteger(d.chainId)) throw new WalletFileError('The key file has no chain id.')
  const o = d.owner as Record<string, unknown> | undefined
  let owner: OwnerKey
  if (o?.type === 'burner' && isKey(o.pk)) owner = { type: 'burner', pk: o.pk }
  else if (o?.type === 'injected' && typeof o.address === 'string' && isAddress(o.address)) owner = { type: 'injected', address: getAddress(o.address) }
  else throw new WalletFileError('The owner key in this file is not valid.')
  const b = d.bank as Record<string, unknown> | undefined
  if (!b || !isKey(b.pk)) throw new WalletFileError('The bank key in this file is not valid.')
  const safe = d.safe == null ? null : typeof d.safe === 'string' && isAddress(d.safe) ? getAddress(d.safe) : undefined
  if (safe === undefined) throw new WalletFileError('The Safe address in this file is not valid.')
  const sp = d.supplier as Record<string, unknown> | undefined
  if (sp !== undefined && sp !== null && !isKey(sp.pk)) throw new WalletFileError('The supplier key in this file is not valid.')
  const w: WalletFile = { version: 1, chainId: d.chainId, owner, bank: { pk: b.pk }, safe, ...(sp && isKey(sp.pk) ? { supplier: { pk: sp.pk } } : {}) }
  if (bankAddress(w).toLowerCase() === ownerAddress(w).toLowerCase()) throw new WalletFileError('The owner and the bank must be different keys.')
  const sup = supplierAddress(w)?.toLowerCase()
  if (sup && (sup === ownerAddress(w).toLowerCase() || sup === bankAddress(w).toLowerCase())) throw new WalletFileError('The supplier key must differ from the owner and bank keys.')
  return w
}

function safeParse(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

export function serializeWallet(w: WalletFile): string {
  return JSON.stringify(w, null, 2)
}

export function loadWallet(): WalletFile | null {
  try {
    const raw = localStorage.getItem(WALLET_KEY)
    return raw ? parseWallet(raw) : null
  } catch {
    return null
  }
}

export function saveWallet(w: WalletFile): boolean {
  try {
    localStorage.setItem(WALLET_KEY, JSON.stringify(w))
    return true
  } catch {
    return false
  }
}

export function clearWallet(): void {
  try { localStorage.removeItem(WALLET_KEY) } catch { /* nothing stored */ }
}

export function keyFileName(w: WalletFile): string {
  return `porthmos-keys-${ownerAddress(w).slice(2, 8).toLowerCase()}.json`
}
