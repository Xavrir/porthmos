import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { createWalletClient, encodeFunctionData, http, parseAbi, type Address, type Hex } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { foundry } from 'viem/chains'
import { useConnection } from 'wagmi'
import { readContract, sendTransaction, signMessage, signTypedData } from 'wagmi/actions'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { demoIdentitiesAvailable } from './demo/allowed'
import { toViemMessage } from './eip712'
import { REGISTRY_ABI } from './deployment'
import { assertPinnedTarget, guardedSend, pinnedRegistry, PINNED, type GuardContext } from './txguard'
import { bankAddress, ownerAddress } from './keys'
import { publicClientFor } from './onboard/chain'
import { localSender } from './onboard/signers'
import { buildSiwe, pageOrigin, siweExpiry, siweProblem } from './siwe'
import { RPC_URLS, wagmiConfig } from './wallet'
import { restoringSession } from './auth'
import { useAegis } from './source'
import type { Role, Session, TxRequest, TypedDataPayload } from './types'
import type { BankAction } from './api/contract'

export type Seat = Role | 'viewer'

export type Identity =
  | { kind: 'none' }
  | { kind: 'replay'; role: Role | null; address: Address | null }
  | { kind: 'demo'; role: Role; address: Address }
  | { kind: 'wallet'; role: Role | null; address: Address }
  | { kind: 'local'; role: Role; address: Address }

export type SessionState = 'none' | 'pending' | 'ready' | 'error'
export type WalletRole = { status: 'idle' | 'loading' | 'ready' | 'error'; role: Role | null }
export type ChooserIntent = 'visit' | 'hero' | 'switch'

// A SIWE message built and shown to the visitor, signed only if it is still valid when they confirm.
export type Prepared = { message: string; role: Role; address: Address; expiresAt: number }
export type LostSession = { why: 'account'; from: Address; to: Address } | { why: 'disconnected'; from: Address } | { why: 'expired' }
export type AdoptedSession = { token: string; role: Role; address: Address; expiresAt?: number }

export type RegistryFn =
  | 'bankFreeze' | 'bankUnfreeze' | 'revokeAuthorizer' | 'removeVault'
  | 'setAutoCap' | 'setDailyCap' | 'setMaxBandWidth' | 'setMaxOracleAge' | 'setReserveFloor'

type IdentityValue = {
  identity: Identity
  role: Role | null
  address: Address | null
  seat: Seat | null
  demoAvailable: boolean
  chooseSeat: (seat: Seat) => void
  chooseDemo: (role: Role | null, prepared?: Prepared) => void
  session: SessionState
  sessionError: string | null
  signedIn: boolean
  prepareSignIn: (role?: Role, address?: Address) => Promise<Prepared>
  signIn: (prepared: Prepared) => Promise<void>
  signOut: () => void
  adoptSession: (s: AdoptedSession) => void
  lost: LostSession | null
  clearLost: () => void
  walletRole: WalletRole
  chooser: { open: boolean; intent: ChooserIntent; wanted: Role | null; show: (intent?: ChooserIntent, wanted?: Role | null) => void; hide: () => void }
  sign: (payload: TypedDataPayload) => Promise<Hex>
  sendTx: (tx: TxRequest) => Promise<Hex>
  bankAction: (action: BankAction, safe: Address) => Promise<Hex | null>
  localAddress: (role: Role) => Address | null
  confirmed: (role: Role) => boolean
  signInLocal: (role: Role, prepared?: Prepared) => void
  sendAs: (role: Role, fn: RegistryFn, args: readonly unknown[]) => Promise<Hex>
  isLocal: boolean
  sessionReady: boolean
  storedSignIn: boolean
  restoring: boolean
}

const IdentityContext = createContext<IdentityValue | null>(null)
const DEMO_KEY = 'aegis.demo-identity'
const SEAT_KEY = 'aegis.seat'
const CONFIRM_KEY = 'aegis.local-confirm'
const WALLET_SESSION_KEY = 'porthmos.session'
const WRONG_NETWORK = 'Your wallet is on another network. Switch it to the Porthmos network first. Nothing was sent.'
// A prepared message must outlive the walk from the confirm button to the server.
const PREPARED_MARGIN_MS = 30_000
// How long a reload waits for wagmi to reconnect the wallet of a stored session before showing sign in.
const RECONNECT_GRACE_MS = 8_000

const ROLE_ABI = parseAbi(['function owner(address) view returns (address)', 'function bank(address) view returns (address)'])

// The literal comparison must stay inline so a non-31337 build folds it and never emits the keys chunk.
const loadDemoKeys = import.meta.env.VITE_TARGET_CHAIN_ID && import.meta.env.VITE_TARGET_CHAIN_ID !== '31337' ? null : () => import('./demo/keys').then((m) => m.ANVIL_DEMO_KEYS)

async function demoAccount(role: Role) {
  if (!loadDemoKeys) throw new Error('Local test keys are not part of this build.')
  const keys = await loadDemoKeys()
  return privateKeyToAccount(keys[role])
}

const same = (a?: string | null, b?: string | null) => !!a && !!b && a.toLowerCase() === b.toLowerCase()

function usable(p: Prepared | null, r: Role, a: Address): p is Prepared {
  return !!p && p.role === r && same(p.address, a) && p.expiresAt - Date.now() > PREPARED_MARGIN_MS
}

function read<T extends string>(key: string, allowed: readonly T[]): T | null {
  try {
    const v = sessionStorage.getItem(key)
    return v && (allowed as readonly string[]).includes(v) ? (v as T) : null
  } catch {
    return null
  }
}

function write(key: string, value: string) {
  try { sessionStorage.setItem(key, value) } catch { /* storage blocked: the choice lasts for this page */ }
}

function readConfirmed(): string[] {
  try {
    const v = JSON.parse(sessionStorage.getItem(CONFIRM_KEY) ?? '[]')
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []
  } catch {
    return []
  }
}

type StoredSession = { token: string; role: Role; address: Address; chainId: number; api: string; expiresAt: number }

// A wallet session survives a reload of this tab only, and only for the same address, role, chain and service.
function readStored(): StoredSession | null {
  try {
    const v = JSON.parse(sessionStorage.getItem(WALLET_SESSION_KEY) ?? 'null') as StoredSession | null
    return v && typeof v.token === 'string' && typeof v.address === 'string' && v.expiresAt * 1000 > Date.now() ? v : null
  } catch {
    return null
  }
}

function writeStored(s: StoredSession | null) {
  try {
    if (s) sessionStorage.setItem(WALLET_SESSION_KEY, JSON.stringify(s))
    else sessionStorage.removeItem(WALLET_SESSION_KEY)
  } catch { /* the session lasts for this page */ }
}

export function IdentityProvider({ children }: { children: ReactNode }) {
  const { api, http: httpApi, apiBase, mode, phase, chainId, deployment, bumpSession, wallet, tenant, refresh, rpcUrl } = useAegis()
  const qc = useQueryClient()
  const conn = useConnection()
  const demoAvailable = demoIdentitiesAvailable(chainId)
  const [seat, setSeat] = useState<Seat | null>(() => read(SEAT_KEY, ['owner', 'bank', 'viewer'] as const))
  const [demoChoice, setDemoChoice] = useState<Role | 'off' | null>(() => read(DEMO_KEY, ['owner', 'bank', 'off'] as const))
  const [session, setSession] = useState<SessionState>('none')
  const [sessionError, setSessionError] = useState<string | null>(null)
  const [signedFor, setSignedFor] = useState<string | null>(null)
  const [chooserOpen, setChooserOpen] = useState(false)
  const [chooserIntent, setChooserIntent] = useState<ChooserIntent>('visit')
  const [chooserWanted, setChooserWanted] = useState<Role | null>(null)
  const [confirmedList, setConfirmedList] = useState<string[]>(readConfirmed)
  const [lost, setLost] = useState<LostSession | null>(null)
  const adopted = useRef<AdoptedSession | null>(null)
  const pendingPrep = useRef<Prepared | null>(null)
  const [graceOver, setGraceOver] = useState(false)
  useEffect(() => {
    const t = setTimeout(() => setGraceOver(true), RECONNECT_GRACE_MS)
    return () => clearTimeout(t)
  }, [])

  const roles = useQuery({
    queryKey: ['registry-roles', chainId, deployment.registry, deployment.safe],
    queryFn: async () => {
      const [owner, bank] = await Promise.all([
        readContract(wagmiConfig, { address: deployment.registry, abi: ROLE_ABI, functionName: 'owner', args: [deployment.safe], chainId: chainId as 31337 | 84532 }),
        readContract(wagmiConfig, { address: deployment.registry, abi: ROLE_ABI, functionName: 'bank', args: [deployment.safe], chainId: chainId as 31337 | 84532 }),
      ])
      return { owner, bank }
    },
    enabled: mode === 'live' && phase === 'ready' && !tenant && !!conn.address && (chainId === 31337 || chainId === 84532),
    staleTime: 60_000,
    retry: 1,
  })

  const legacyRole: WalletRole = useMemo(() => {
    if (!conn.address || mode !== 'live') return { status: 'idle', role: null }
    if (roles.isLoading) return { status: 'loading', role: null }
    const r = roles.data ?? (roles.isError ? deployment.roles : null)
    if (!r) return { status: 'loading', role: null }
    const a = conn.address.toLowerCase()
    const role: Role | null = a === r.owner.toLowerCase() ? 'owner' : a === r.bank.toLowerCase() ? 'bank' : null
    return { status: roles.isError ? 'error' : 'ready', role }
  }, [conn.address, deployment.roles, mode, roles.data, roles.isError, roles.isLoading])

  const localAddress = useCallback((r: Role): Address | null => {
    if (!wallet) return null
    if (r === 'bank') return bankAddress(wallet)
    return wallet.owner.type === 'burner' ? ownerAddress(wallet) : null
  }, [wallet])

  const identity: Identity = useMemo(() => {
    if (mode === 'replay') {
      if (seat === 'owner' || seat === 'bank') return { kind: 'replay', role: seat, address: seat === 'bank' ? deployment.roles.bank : deployment.roles.owner }
      if (seat === 'viewer') return { kind: 'replay', role: null, address: null }
      return { kind: 'none' }
    }
    if (demoAvailable && (demoChoice === 'owner' || demoChoice === 'bank')) return { kind: 'demo', role: demoChoice, address: demoChoice === 'bank' ? deployment.roles.bank : deployment.roles.owner }
    if (tenant) {
      const r: Role | null = seat === 'owner' || seat === 'bank' ? seat : tenant.via === 'wallet' ? (tenant.seats.owner ? 'owner' : tenant.seats.bank ? 'bank' : null) : null
      if (!r) return { kind: 'none' }
      const how = tenant.seats[r]
      const local = localAddress(r)
      if (how === 'key' && local) return { kind: 'local', role: r, address: local }
      const holder = r === 'owner' ? tenant.owner : tenant.bank
      if (how === 'wallet' && conn.address && same(conn.address, holder)) return { kind: 'wallet', role: r, address: conn.address }
      return { kind: 'none' }
    }
    if (conn.address) return { kind: 'wallet', role: legacyRole.role, address: conn.address }
    return { kind: 'none' }
  }, [conn.address, demoAvailable, demoChoice, deployment.roles, legacyRole.role, localAddress, mode, seat, tenant])

  const walletRole: WalletRole = identity.kind === 'wallet' && tenant ? { status: 'ready', role: identity.role } : legacyRole

  const role = identity.kind === 'none' ? null : identity.role
  const address = identity.kind === 'none' ? null : identity.address
  const isConfirmed = identity.kind === 'local' && confirmedList.includes(`${identity.role}:${identity.address.toLowerCase()}`)
  const key = `${mode}:${identity.kind}:${role}:${address}:${isConfirmed ? 'c' : ''}`
  const keyRef = useRef(key)
  useLayoutEffect(() => { keyRef.current = key }, [key])

  const localAccount = useCallback((r: Role) => {
    if (!wallet) throw new Error('No keys in this browser. Create your treasury first.')
    if (r === 'bank') return privateKeyToAccount(wallet.bank.pk)
    if (wallet.owner.type !== 'burner') throw new Error('Your owner key is your browser wallet.')
    return privateKeyToAccount(wallet.owner.pk)
  }, [wallet])

  const senders = useRef(new Map<string, ReturnType<typeof localSender>>())
  // Only the owner key may send a Safe transaction, and only to this session's Safe; the guard checks its exact shape.
  const guardFor = useCallback((r: Role | null, signer: Address | null): GuardContext => ({
    safe: tenant?.safe ?? deployment.safe, owner: r === 'owner' ? signer : null,
  }), [deployment.safe, tenant?.safe])
  const localTx = useCallback((r: Role, tx: TxRequest): Promise<Hex> => {
    assertPinnedTarget(chainId, tx, PINNED, guardFor(r, localAddress(r)))
    if (!wallet) throw new Error('No keys in this browser. Create your treasury first.')
    const pk = r === 'bank' ? wallet.bank.pk : wallet.owner.type === 'burner' ? wallet.owner.pk : null
    if (!pk) throw new Error('Your owner key is your browser wallet.')
    const k = `${pk}@${chainId}@${rpcUrl}`
    let sender = senders.current.get(k)
    if (!sender) {
      sender = localSender(pk, { chainId, rpcUrl }, publicClientFor(chainId, rpcUrl))
      senders.current.set(k, sender)
    }
    return sender.send({ to: tx.to, data: tx.data })
  }, [chainId, guardFor, localAddress, rpcUrl, wallet])

  const prepare = useCallback(async (r: Role, a: Address): Promise<Prepared> => {
    const { nonce } = await httpApi.authNonce()
    const message = buildSiwe({ purpose: { kind: 'session', role: r }, address: a, chainId, nonce, origin: pageOrigin() })
    return { message, role: r, address: a, expiresAt: siweExpiry(message) ?? Date.now() }
  }, [chainId, httpApi])

  const checked = useCallback((p: Prepared): string => {
    const problem = siweProblem(p.message, { purpose: { kind: 'session', role: p.role }, address: p.address, chainId, origin: pageOrigin() })
    if (problem) throw new Error(`Porthmos refused to sign this message: ${problem}.`)
    return p.message
  }, [chainId])

  const finish = useCallback((p: Promise<Session>, signed: boolean, forKey: string, onOk?: (s: Session) => void) => {
    setSession('pending')
    p.then(
      (s) => {
        if (keyRef.current !== forKey) return
        api.setSession(s.token)
        setSession('ready')
        setSessionError(null)
        setSignedFor(signed ? forKey : null)
        onOk?.(s)
        bumpSession()
        qc.invalidateQueries()
      },
      (e: Error) => {
        if (keyRef.current !== forKey) return
        setSession('error')
        setSessionError(e.message)
        bumpSession()
      },
    )
  }, [api, bumpSession, qc])

  const store = useCallback((s: Session, r: Role, a: Address) => {
    writeStored({ token: s.token, role: r, address: a, chainId, api: apiBase, expiresAt: s.expiresAt ?? Math.floor(Date.now() / 1000) + 3600 })
  }, [apiBase, chainId])

  const takeOver = useCallback((token: string, forKey: string) => {
    api.setSession(token)
    setSession('ready')
    setSessionError(null)
    setSignedFor(forKey)
    bumpSession()
    qc.invalidateQueries()
  }, [api, bumpSession, qc])

  useEffect(() => {
    if (phase !== 'ready') return
    if (identity.kind === 'wallet' && signedFor === key) return
    api.setSession(null)
    setSignedFor(null)
    setSessionError(null)
    const fresh = adopted.current
    const fits = (r: Role, a: Address) => (fresh && fresh.role === r && same(fresh.address, a) ? fresh : null)
    if (identity.kind === 'wallet' && role && address) {
      const kept = fits(role, address) ?? (() => {
        const st = readStored()
        return st && st.role === role && same(st.address, address) && st.chainId === chainId && st.api === apiBase ? st : null
      })()
      if (kept) { adopted.current = null; takeOver(kept.token, key); return }
      setSession('none')
      bumpSession()
      return
    }
    if (!role || !address || (identity.kind === 'local' && !isConfirmed)) {
      setSession('none')
      bumpSession()
      return
    }
    if (identity.kind === 'demo' || identity.kind === 'local') {
      const kept = identity.kind === 'local' ? fits(role, address) : null
      if (kept) { adopted.current = null; takeOver(kept.token, key); return }
      const r = role
      const a = address
      const prep = pendingPrep.current
      pendingPrep.current = null
      finish((async () => {
        const acct = identity.kind === 'demo' ? await demoAccount(r) : localAccount(r)
        const message = checked(usable(prep, r, a) ? prep : await prepare(r, a))
        const signature = await acct.signMessage({ message })
        return api.createSession(r, a, { message, signature })
      })(), true, key)
      return
    }
    finish(api.createSession(role, address), false, key)
    // bumpSession, finish, localAccount, prepare and signedFor are deliberately left out: only a change of who is acting reopens the session
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, phase, key])

  const lastSigned = useRef<{ address: Address; role: Role } | null>(null)
  const signedInNow = session === 'ready' && signedFor === key
  useEffect(() => {
    if (identity.kind === 'wallet' && signedInNow && identity.role) {
      lastSigned.current = { address: identity.address, role: identity.role }
      setLost(null)
      return
    }
    const prev = lastSigned.current
    if (!prev || conn.status === 'connecting' || conn.status === 'reconnecting') return
    if (!conn.address) {
      lastSigned.current = null
      writeStored(null)
      setLost({ why: 'disconnected', from: prev.address })
    } else if (!same(conn.address, prev.address)) {
      lastSigned.current = null
      writeStored(null)
      setLost({ why: 'account', from: prev.address, to: conn.address })
    }
  }, [conn.address, conn.status, identity, signedInNow])

  useEffect(() => {
    httpApi.onSessionLost = () => {
      writeStored(null)
      lastSigned.current = null
      httpApi.setSession(null)
      setSignedFor(null)
      setSession('none')
      setLost({ why: 'expired' })
      bumpSession()
    }
    return () => { httpApi.onSessionLost = null }
  }, [bumpSession, httpApi])

  const prepareSignIn = useCallback(async (r?: Role, given?: Address): Promise<Prepared> => {
    if (r && given) return prepare(r, given)
    if (identity.kind === 'wallet') {
      const want = r ?? identity.role
      if (!want) throw new Error('This wallet holds no Porthmos role, so there is nothing to sign in to.')
      return prepare(want, identity.address)
    }
    const want = r ?? role
    if (!want) throw new Error('Choose the owner or the bank seat first.')
    const a = identity.kind === 'demo' ? (want === 'bank' ? deployment.roles.bank : deployment.roles.owner) : localAddress(want)
    if (!a) throw new Error('No key for this seat in this browser.')
    return prepare(want, a)
  }, [deployment.roles, identity, localAddress, prepare, role])

  const signIn = useCallback(async (prepared: Prepared) => {
    if (identity.kind !== 'wallet') throw new Error('Connect a wallet first.')
    if (!identity.role) throw new Error('This wallet holds no Porthmos role, so there is nothing to sign in to. You can still look around read-only.')
    const r = identity.role
    const a = identity.address
    setSessionError(null)
    setLost(null)
    const run = (async () => {
      // Only the exact text the visitor saw is ever sent to the wallet; an expired one is refused, not silently rebuilt.
      if (!usable(prepared, r, a)) throw new Error('The sign-in message expired or is for another seat. Review the new one and sign again.')
      const message = checked(prepared)
      const signature = await signMessage(wagmiConfig, { account: a, message })
      return api.createSession(r, a, { message, signature })
    })()
    finish(run, true, key, (s) => store(s, r, a))
    await run.then(() => undefined, () => undefined)
  }, [api, checked, finish, identity, key, store])

  const adoptSession = useCallback((s: AdoptedSession) => {
    adopted.current = s
    if (s.role === 'owner' && wallet && wallet.owner.type === 'burner' && same(ownerAddress(wallet), s.address)) {
      const next = [...new Set([...readConfirmed(), `owner:${s.address.toLowerCase()}`])]
      setConfirmedList(next)
      write(CONFIRM_KEY, JSON.stringify(next))
    } else {
      writeStored({ token: s.token, role: s.role, address: s.address, chainId, api: apiBase, expiresAt: s.expiresAt ?? Math.floor(Date.now() / 1000) + 3600 })
    }
    setSeat(s.role)
    write(SEAT_KEY, s.role)
  }, [apiBase, chainId, wallet])

  const signOut = useCallback(() => {
    api.setSession(null)
    setSignedFor(null)
    setSession('none')
    setConfirmedList([])
    write(CONFIRM_KEY, '[]')
    writeStored(null)
    adopted.current = null
    lastSigned.current = null
    setLost(null)
    if (demoChoice === 'owner' || demoChoice === 'bank') { setDemoChoice('off'); write(DEMO_KEY, 'off') }
    bumpSession()
    qc.invalidateQueries()
  }, [api, bumpSession, demoChoice, qc])

  const chooseSeat = useCallback((s: Seat) => {
    setSeat(s)
    write(SEAT_KEY, s)
  }, [])

  const chooseDemo = useCallback((r: Role | null, prepared?: Prepared) => {
    if (prepared) pendingPrep.current = prepared
    const v = r ?? 'off'
    setDemoChoice(v)
    write(DEMO_KEY, v)
    if (r) chooseSeat(r)
  }, [chooseSeat])

  const confirmed = useCallback((r: Role) => {
    const a = localAddress(r)
    return !!a && confirmedList.includes(`${r}:${a.toLowerCase()}`)
  }, [confirmedList, localAddress])

  const signInLocal = useCallback((r: Role, prepared?: Prepared) => {
    const a = localAddress(r)
    if (prepared) pendingPrep.current = prepared
    if (a) {
      const next = [...new Set([...confirmedList, `${r}:${a.toLowerCase()}`])]
      setConfirmedList(next)
      write(CONFIRM_KEY, JSON.stringify(next))
    }
    if (demoChoice === 'owner' || demoChoice === 'bank') { setDemoChoice('off'); write(DEMO_KEY, 'off') }
    chooseSeat(r)
    if (mode !== 'live') refresh('live')
  }, [chooseSeat, confirmedList, demoChoice, localAddress, mode, refresh])

  const sign = useCallback(async (payload: TypedDataPayload): Promise<Hex> => {
    const args = { domain: payload.domain, types: payload.types, primaryType: payload.primaryType, message: toViemMessage(payload.message) }
    if (identity.kind === 'demo' || identity.kind === 'local') {
      const account = identity.kind === 'demo' ? await demoAccount(identity.role) : localAccount(identity.role)
      return account.signTypedData(args as unknown as Parameters<typeof account.signTypedData>[0])
    }
    if (identity.kind === 'wallet') {
      if (conn.chainId !== chainId) throw new Error(WRONG_NETWORK)
      return signTypedData(wagmiConfig, { ...(args as unknown as Parameters<typeof signTypedData>[1]), account: identity.address })
    }
    if (identity.kind === 'replay') throw new Error('Replay holds no keys. Use the recorded or simulated approval.')
    throw new Error('Sign in with a wallet to sign.')
  }, [chainId, conn.chainId, identity, localAccount])

  const sendTx = useCallback((tx: TxRequest): Promise<Hex> => guardedSend(chainId, tx, async (t) => {
    if (identity.kind === 'demo') {
      const account = await demoAccount(identity.role)
      const client = createWalletClient({ account, chain: foundry, transport: http(RPC_URLS[foundry.id]) })
      return client.sendTransaction({ to: t.to, data: t.data, value: 0n })
    }
    if (identity.kind === 'local') return localTx(identity.role, t)
    if (identity.kind === 'wallet') {
      if (conn.chainId !== chainId) throw new Error(WRONG_NETWORK)
      return sendTransaction(wagmiConfig, { account: identity.address, chainId: chainId as 31337 | 84532, to: t.to, data: t.data, value: 0n })
    }
    throw new Error('Sign in with a wallet to send this transaction.')
  }, PINNED, guardFor(identity.kind === 'none' ? null : identity.role, identity.kind === 'none' ? null : identity.address)), [chainId, conn.chainId, guardFor, identity, localTx])

  const sendAs = useCallback(async (r: Role, fn: RegistryFn, args: readonly unknown[]): Promise<Hex> => {
    const data = encodeFunctionData({ abi: REGISTRY_ABI, functionName: fn, args } as never)
    const tx: TxRequest = { to: pinnedRegistry(chainId), data, value: '0' }
    if (identity.kind === 'wallet' && identity.role === r) return sendTx(tx)
    return localTx(r, tx)
  }, [chainId, identity, localTx, sendTx])

  const bankAction = useCallback(async (action: BankAction, safe: Address): Promise<Hex | null> => {
    if (!address) throw new Error('Switch to the bank officer first.')
    if (mode === 'replay') {
      await api.simulateBankAction?.(action, safe, address)
      return null
    }
    if (identity.kind === 'local') return sendAs('bank', action, [safe])
    return sendTx({ to: pinnedRegistry(chainId), data: encodeFunctionData({ abi: REGISTRY_ABI, functionName: action, args: [safe] }), value: '0' })
  }, [address, api, chainId, identity, mode, sendAs, sendTx])

  const chooser = useMemo(() => ({
    open: chooserOpen,
    intent: chooserIntent,
    wanted: chooserWanted,
    show: (intent: ChooserIntent = 'switch', wanted: Role | null = null) => { setChooserIntent(intent); setChooserWanted(wanted); setChooserOpen(true) },
    hide: () => { setChooserOpen(false); setChooserWanted(null) },
  }), [chooserIntent, chooserOpen, chooserWanted])

  const signedIn = signedInNow
  const stored = readStored()
  const restoring = restoringSession({
    stored, walletPending: conn.status === 'connecting' || conn.status === 'reconnecting', graceOver,
    identity: identity.kind, role, address, chainId, api: apiBase, taken: signedFor === key,
  })
  // Right after a seat change the old session is still 'ready' for one render; only a session opened for this key counts.
  const sessionReady = session === 'ready' && (signedFor === null ? identity.kind !== 'local' && identity.kind !== 'wallet' : signedFor === key)
  const value: IdentityValue = {
    identity, role, address, seat, demoAvailable, chooseSeat, chooseDemo, session, sessionError, signedIn, prepareSignIn, signIn, signOut, adoptSession,
    lost, clearLost: () => setLost(null), walletRole, chooser, sign, sendTx, bankAction,
    localAddress, confirmed, signInLocal, sendAs, isLocal: identity.kind === 'local', sessionReady,
    storedSignIn: confirmedList.length > 0 || demoChoice === 'owner' || demoChoice === 'bank' || !!stored,
    restoring,
  }
  return <IdentityContext.Provider value={value}>{children}</IdentityContext.Provider>
}

export function useIdentity(): IdentityValue {
  const ctx = useContext(IdentityContext)
  if (!ctx) throw new Error('useIdentity outside IdentityProvider')
  return ctx
}

export function seatName(role: Role | null): string {
  return role === 'owner' ? 'Owner' : role === 'bank' ? 'Bank officer' : 'Read-only'
}
