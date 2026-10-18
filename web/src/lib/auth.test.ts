import { describe, expect, it } from 'vitest'
import { deviceStatus, forgetConfirmed, gate, homeFor, isAppPath, restoringSession, returnPath, type DeviceInput, type GateInput, type RestoreInput } from './auth'

const base: GateInput = { phase: 'ready', mode: 'live', replayChosen: false, identity: 'none', localConfirmed: false, signedIn: false, storedSignIn: false, restoring: false }
const OWNER = '0x1111111111111111111111111111111111111111'
const SAFE = '0x2222222222222222222222222222222222222222'

describe('route guard', () => {
  it('sends a visitor with no session to sign in', () => {
    expect(gate(base)).toBe('signin')
    expect(gate({ ...base, mode: 'replay' })).toBe('signin')
  })

  it('redirects at once while probing when nothing in this tab can open a session', () => {
    expect(gate({ ...base, phase: 'probing' })).toBe('signin')
  })

  it('waits while probing when a stored sign-in, a chosen replay or a live wallet session may hold', () => {
    expect(gate({ ...base, phase: 'probing', storedSignIn: true })).toBe('wait')
    expect(gate({ ...base, phase: 'probing', replayChosen: true })).toBe('wait')
    expect(gate({ ...base, phase: 'probing', signedIn: true })).toBe('wait')
  })

  it('lets a replay through only when the visitor chose it', () => {
    expect(gate({ ...base, mode: 'replay', replayChosen: true, identity: 'replay' })).toBe('allow')
    expect(gate({ ...base, mode: 'replay', replayChosen: false, identity: 'replay' })).toBe('signin')
  })

  it('requires a confirmed local key in live mode', () => {
    expect(gate({ ...base, identity: 'local', localConfirmed: true })).toBe('allow')
    expect(gate({ ...base, identity: 'local', localConfirmed: false })).toBe('signin')
  })

  it('requires a signed session for a browser wallet', () => {
    expect(gate({ ...base, identity: 'wallet', signedIn: true })).toBe('allow')
    expect(gate({ ...base, identity: 'wallet', signedIn: false })).toBe('signin')
  })

  it('accepts a chosen local test key (chain 31337 only, decided by identity)', () => {
    expect(gate({ ...base, identity: 'demo' })).toBe('allow')
  })

  it('does not let a stale replay choice open a live app without a session', () => {
    expect(gate({ ...base, mode: 'live', replayChosen: true })).toBe('signin')
  })
})

describe('reload with a stored wallet session', () => {
  const API = 'https://api.example'
  const stored = { role: 'owner' as const, address: OWNER as `0x${string}`, chainId: 84532, api: API }
  const back: RestoreInput = { stored, walletPending: false, graceOver: false, identity: 'wallet', role: 'owner', address: OWNER, chainId: 84532, api: API, taken: false }

  it('waits on the render before the stored session is taken over instead of redirecting', () => {
    const restoring = restoringSession(back)
    expect(restoring).toBe(true)
    expect(gate({ ...base, identity: 'wallet', storedSignIn: true, restoring })).toBe('wait')
    expect(restoringSession({ ...back, taken: true })).toBe(false)
    expect(gate({ ...base, identity: 'wallet', signedIn: true, storedSignIn: true, restoring: false })).toBe('allow')
  })

  it('waits while wagmi reconnects the wallet, even after a probe that ran without it, but not forever', () => {
    const pending = { ...back, walletPending: true, identity: 'none' as const, role: null, address: null }
    expect(restoringSession(pending)).toBe(true)
    expect(gate({ ...base, mode: 'replay', storedSignIn: true, restoring: true })).toBe('wait')
    expect(restoringSession({ ...pending, graceOver: true })).toBe(false)
  })

  it('signs in again when nothing stored fits the wallet that came back', () => {
    expect(restoringSession({ ...back, stored: null })).toBe(false)
    expect(restoringSession({ ...back, address: SAFE })).toBe(false)
    expect(restoringSession({ ...back, role: 'bank' })).toBe(false)
    expect(restoringSession({ ...back, chainId: 31337 })).toBe(false)
    expect(restoringSession({ ...back, api: 'https://other.example' })).toBe(false)
    expect(gate({ ...base, identity: 'wallet', storedSignIn: true, restoring: false })).toBe('signin')
  })
})

describe('return path after sign in', () => {
  it('keeps app routes, with query and hash', () => {
    expect(returnPath('/orders/7?tab=x#m2', '/treasury')).toBe('/orders/7?tab=x#m2')
    expect(returnPath('/bank', '/treasury')).toBe('/bank')
  })

  it('falls back for anything else', () => {
    for (const bad of [undefined, null, 42, '', 'treasury', '//evil.example/treasury', 'https://evil.example', '/signin', '/signup', '/o/1', '/', '/treasuryx', '/\\evil.example']) {
      expect(returnPath(bad, '/treasury')).toBe('/treasury')
    }
  })

  it('maps each seat to its home and knows the app routes', () => {
    expect(homeFor('owner')).toBe('/treasury')
    expect(homeFor('bank')).toBe('/bank')
    expect(isAppPath('/orders')).toBe(true)
    expect(isAppPath('/orders/12')).toBe(true)
    expect(isAppPath('/o/12')).toBe(false)
  })
})

describe('sign in on this device', () => {
  const ready: DeviceInput = { phase: 'ready', serviceUp: true, configChainId: 84532, wallet: { chainId: 84532, owner: OWNER, ownerVia: 'key', safe: SAFE }, tenant: { owner: OWNER, safe: SAFE } }

  it('is ready only for keys of an activated treasury on this service', () => {
    expect(deviceStatus(ready)).toEqual({ status: 'ready', owner: OWNER, safe: SAFE, ownerVia: 'key' })
  })

  it('reports each reason it is not available', () => {
    expect(deviceStatus({ ...ready, wallet: null }).status).toBe('none')
    expect(deviceStatus({ ...ready, phase: 'probing' }).status).toBe('checking')
    expect(deviceStatus({ ...ready, serviceUp: false }).status).toBe('offline')
    expect(deviceStatus({ ...ready, configChainId: null }).status).toBe('offline')
    expect(deviceStatus({ ...ready, configChainId: 31337 })).toMatchObject({ status: 'wrong-chain', chainId: 84532, want: 31337 })
    expect(deviceStatus({ ...ready, tenant: null })).toMatchObject({ status: 'unfinished', safe: SAFE })
  })

  it('does not treat a tenant of other keys as this browser account', () => {
    expect(deviceStatus({ ...ready, tenant: { owner: '0x3333333333333333333333333333333333333333', safe: SAFE } }).status).toBe('unfinished')
  })

  it('matches the owner address without regard to case and keeps a wallet owner', () => {
    const w = { ...ready, wallet: { ...ready.wallet!, owner: OWNER.toUpperCase().replace('0X', '0x') as `0x${string}`, ownerVia: 'wallet' as const } }
    expect(deviceStatus(w)).toMatchObject({ status: 'ready', ownerVia: 'wallet' })
  })
})

describe('signing previews and confirmations', () => {
  it('forgets the device only after the typed word', () => {
    expect(forgetConfirmed('forget')).toBe(true)
    expect(forgetConfirmed(' FORGET ')).toBe(true)
    expect(forgetConfirmed('forge')).toBe(false)
    expect(forgetConfirmed('')).toBe(false)
  })
})
