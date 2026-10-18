import { beforeEach, describe, expect, it } from 'vitest'
import { bankAddress, clearWallet, connectInjectedOwner, supplierAddress, withSupplier, loadWallet, newWallet, ownerAddress, parseWallet, saveWallet, serializeWallet, WALLET_KEY, WalletFileError } from './keys'

const store = new Map<string, string>()
Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  value: { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) },
})

describe('key storage', () => {
  beforeEach(() => store.clear())

  it('stores the spec shape under aegis.wallet.v1', () => {
    const w = newWallet(84532)
    expect(saveWallet(w)).toBe(true)
    const raw = JSON.parse(store.get(WALLET_KEY)!)
    expect(Object.keys(raw).sort()).toEqual(['bank', 'chainId', 'owner', 'safe', 'version'])
    expect(raw).toMatchObject({ version: 1, chainId: 84532, owner: { type: 'burner' }, safe: null })
    expect(raw.owner.pk).toMatch(/^0x[0-9a-f]{64}$/)
    expect(raw.bank.pk).toMatch(/^0x[0-9a-f]{64}$/)
    expect(ownerAddress(w)).not.toBe(bankAddress(w))
  })

  it('round-trips export and import', () => {
    const w = { ...newWallet(84532), safe: '0xE3BB581d18aaF6cB2fE9BfCa612861a31eEdCe79' as const }
    const back = parseWallet(serializeWallet(w))
    expect(back).toEqual(w)
    expect(ownerAddress(back)).toBe(ownerAddress(w))
    saveWallet(back)
    expect(loadWallet()).toEqual(w)
  })

  it('keeps an injected owner as an address only', () => {
    const w = newWallet(84532, { type: 'injected', address: '0x70997970c51812dc3a010c7d01b50e0d17dc79c8' })
    const back = parseWallet(serializeWallet(w))
    expect(back.owner).toEqual({ type: 'injected', address: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8' })
    expect(ownerAddress(back)).toBe('0x70997970C51812dc3A010C7d01b50e0d17dc79C8')
  })

  it('refuses broken files', () => {
    expect(() => parseWallet('not json')).toThrow(WalletFileError)
    expect(() => parseWallet({ version: 2 })).toThrow(WalletFileError)
    const w = newWallet(84532)
    expect(() => parseWallet({ ...w, bank: { pk: '0x12' } })).toThrow(WalletFileError)
    expect(() => parseWallet({ ...w, bank: { pk: (w.owner as { pk: string }).pk } })).toThrow(/different keys/)
  })

  it('survives blocked or corrupt storage', () => {
    store.set(WALLET_KEY, '{oops')
    expect(loadWallet()).toBeNull()
    clearWallet()
    expect(store.has(WALLET_KEY)).toBe(false)
  })

  it('keeps an optional supplier key in the same entry', () => {
    const w = withSupplier(newWallet(84532))
    expect(withSupplier(w)).toBe(w)
    const back = parseWallet(serializeWallet(w))
    expect(supplierAddress(back)).toBe(supplierAddress(w))
    expect(supplierAddress(newWallet(84532))).toBeNull()
    expect(() => parseWallet({ ...w, supplier: { pk: w.owner.type === 'burner' ? w.owner.pk : '0x' } })).toThrow(WalletFileError)
    expect(() => parseWallet({ ...w, supplier: { pk: '0x12' } })).toThrow(/supplier/)
  })
})

describe('connecting a wallet as the owner', () => {
  const picked = '0x14dC79964da2C08b23698B3D3cc7Ca32193d9955' as const
  const other = '0x976EA74026E726554dB657fA54763abd0C3a0aa9' as const
  const safe = '0x2E1c2be3dD6BAa59344EdC6ee6A93D68e2295a0F' as const

  it('resumes an interrupted setup with the stored, funded bank key', () => {
    const stored = { ...newWallet(84532, { type: 'injected', address: picked }), safe }
    const next = connectInjectedOwner(stored, picked.toLowerCase() as `0x${string}`, 84532, true)
    expect(next).toEqual({ wallet: stored })
    expect('wallet' in next && next.wallet.bank.pk).toBe(stored.bank.pk)
  })

  it('never replaces the keys of a setup another owner started', () => {
    const stored = newWallet(84532, { type: 'injected', address: other })
    expect(connectInjectedOwner(stored, picked, 84532, true)).toEqual({ keep: stored })
    const burner = { ...newWallet(84532), safe }
    expect(connectInjectedOwner(burner, picked, 84532, false)).toEqual({ keep: burner })
  })

  it('takes over unused keys, or makes new ones when none are stored', () => {
    const stored = newWallet(84532)
    const next = connectInjectedOwner(stored, picked, 84532, false)
    expect(next).toEqual({ wallet: { ...stored, owner: { type: 'injected', address: picked }, safe: null } })
    const fresh = connectInjectedOwner(null, picked, 84532, false)
    expect('wallet' in fresh && ownerAddress(fresh.wallet)).toBe(picked)
  })
})
