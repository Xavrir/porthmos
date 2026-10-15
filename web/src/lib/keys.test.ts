import { beforeEach, describe, expect, it } from 'vitest'
import { bankAddress, clearWallet, loadWallet, newWallet, ownerAddress, parseWallet, saveWallet, serializeWallet, WALLET_KEY, WalletFileError } from './keys'

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
})
