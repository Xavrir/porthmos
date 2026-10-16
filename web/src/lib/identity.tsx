import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { createWalletClient, encodeFunctionData, http, parseAbi, type Address, type Hex } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { foundry } from 'viem/chains'
import { useConnection } from 'wagmi'
import { readContract, sendTransaction, signMessage, signTypedData, writeContract } from 'wagmi/actions'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { demoIdentitiesAvailable } from './demo/allowed'
import { toViemMessage } from './eip712'
import { REGISTRY_ABI } from './deployment'
import { assertPinnedTarget, guardedSend, pinnedRegistry } from './txguard'
import { bankAddress, ownerAddress } from './keys'
import { publicClientFor } from './onboard/chain'
import { localSender } from './onboard/signers'
import { sessionMessage } from './session'
import { RPC_URLS, wagmiConfig } from './wallet'
import { useAegis } from './source'
import type { Role, TxRequest, TypedDataPayload } from './types'
import type { BankAction, SessionProof } from './api/contract'

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
  chooseDemo: (role: Role | null) => void
  session: SessionState
  sessionError: string | null
  signedIn: boolean
  signIn: () => Promise<void>
  signOut: () => void
  walletRole: WalletRole
  chooser: { open: boolean; intent: ChooserIntent; wanted: Role | null; show: (intent?: ChooserIntent, wanted?: Role | null) => void; hide: () => void }
  sign: (payload: TypedDataPayload) => Promise<Hex>
  sendTx: (tx: TxRequest) => Promise<Hex>
  bankAction: (action: BankAction, safe: Address) => Promise<Hex | null>
  localAddress: (role: Role) => Address | null
  confirmed: (role: Role) => boolean
  signInLocal: (role: Role) => void
  sendAs: (role: Role, fn: RegistryFn, args: readonly unknown[]) => Promise<Hex>
  isLocal: boolean
  sessionReady: boolean
}

const IdentityContext = createContext<IdentityValue | null>(null)
const DEMO_KEY = 'aegis.demo-identity'
const SEAT_KEY = 'aegis.seat'
const CONFIRM_KEY = 'aegis.local-confirm'

const ROLE_ABI = parseAbi(['function owner(address) view returns (address)', 'function bank(address) view returns (address)'])

// The literal comparison must stay inline so a non-31337 build folds it and never emits the keys chunk.
const loadDemoKeys = import.meta.env.VITE_TARGET_CHAIN_ID && import.meta.env.VITE_TARGET_CHAIN_ID !== '31337' ? null : () => import('./demo/keys').then((m) => m.ANVIL_DEMO_KEYS)

async function demoAccount(role: Role) {
  if (!loadDemoKeys) throw new Error('Local test keys are not part of this build.')
  const keys = await loadDemoKeys()
  return privateKeyToAccount(keys[role])
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

export function IdentityProvider({ children }: { children: ReactNode }) {
  const { api, mode, phase, chainId, deployment, bumpSession, wallet, tenant, refresh, rpcUrl } = useAegis()
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

  const roles = useQuery({
    queryKey: ['registry-roles', chainId, deployment.registry, deployment.safe],
    queryFn: async () => {
      const [owner, bank] = await Promise.all([
        readContract(wagmiConfig, { address: deployment.registry, abi: ROLE_ABI, functionName: 'owner', args: [deployment.safe], chainId: chainId as 31337 | 84532 }),
        readContract(wagmiConfig, { address: deployment.registry, abi: ROLE_ABI, functionName: 'bank', args: [deployment.safe], chainId: chainId as 31337 | 84532 }),
      ])
      return { owner, bank }
    },
    enabled: mode === 'live' && phase === 'ready' && !!conn.address && (chainId === 31337 || chainId === 84532),
    staleTime: 60_000,
    retry: 1,
  })

  const walletRole: WalletRole = useMemo(() => {
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
    if (tenant && wallet) {
      if (seat === 'bank') return { kind: 'local', role: 'bank', address: bankAddress(wallet) }
      if (seat === 'owner') {
        if (wallet.owner.type === 'burner') return { kind: 'local', role: 'owner', address: ownerAddress(wallet) }
        if (conn.address && conn.address.toLowerCase() === tenant.owner.toLowerCase()) return { kind: 'wallet', role: walletRole.role, address: conn.address }
      }
      return { kind: 'none' }
    }
    if (conn.address) return { kind: 'wallet', role: walletRole.role, address: conn.address }
    return { kind: 'none' }
  }, [conn.address, demoAvailable, demoChoice, deployment.roles, mode, seat, tenant, wallet, walletRole.role])

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
  const localTx = useCallback((r: Role, tx: TxRequest): Promise<Hex> => {
    assertPinnedTarget(chainId, tx)
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
  }, [chainId, rpcUrl, wallet])

  const finish = useCallback((p: Promise<{ token: string }>, signed: boolean, forKey: string) => {
    setSession('pending')
    p.then(
      (s) => {
        if (keyRef.current !== forKey) return
        api.setSession(s.token)
        setSession('ready')
        setSessionError(null)
        setSignedFor(signed ? forKey : null)
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

  useEffect(() => {
    if (phase !== 'ready') return
    if (identity.kind === 'wallet' && signedFor === key) return
    api.setSession(null)
    setSignedFor(null)
    setSessionError(null)
    if (!role || !address || identity.kind === 'wallet' || (identity.kind === 'local' && !isConfirmed)) {
      setSession('none')
      bumpSession()
      return
    }
    if (identity.kind === 'demo' || identity.kind === 'local') {
      const r = role
      const a = address
      const account = identity.kind === 'demo' ? demoAccount(r) : Promise.resolve(localAccount(r))
      finish(account.then(async (acct) => {
        const issuedAt = new Date().toISOString()
        const signature = await acct.signMessage({ message: sessionMessage(r, a, chainId, issuedAt) })
        return api.createSession(r, a, { signature, issuedAt })
      }), true, key)
      return
    }
    finish(api.createSession(role, address), false, key)
    // bumpSession, finish, localAccount and signedFor are deliberately left out: only a change of who is acting reopens the session
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, phase, key])

  const signIn = useCallback(async () => {
    if (identity.kind !== 'wallet') throw new Error('Connect a wallet first.')
    if (!identity.role) throw new Error('This wallet holds no Porthmos role, so there is nothing to sign in to. You can still look around read-only.')
    const r = identity.role
    const a = identity.address
    const issuedAt = new Date().toISOString()
    setSessionError(null)
    const run = (async () => {
      const signature = await signMessage(wagmiConfig, { message: sessionMessage(r, a, chainId, issuedAt) })
      const proof: SessionProof = { signature, issuedAt }
      return api.createSession(r, a, proof)
    })()
    finish(run, true, key)
    await run.then(() => undefined, () => undefined)
  }, [api, chainId, finish, identity, key])

  const signOut = useCallback(() => {
    api.setSession(null)
    setSignedFor(null)
    setSession('none')
    if (identity.kind === 'local') {
      const next = confirmedList.filter((c) => c !== `${identity.role}:${identity.address.toLowerCase()}`)
      setConfirmedList(next)
      write(CONFIRM_KEY, JSON.stringify(next))
    }
    bumpSession()
    qc.invalidateQueries()
  }, [api, bumpSession, confirmedList, identity, qc])

  const chooseSeat = useCallback((s: Seat) => {
    setSeat(s)
    write(SEAT_KEY, s)
  }, [])

  const chooseDemo = useCallback((r: Role | null) => {
    const v = r ?? 'off'
    setDemoChoice(v)
    write(DEMO_KEY, v)
    if (r) chooseSeat(r)
  }, [chooseSeat])

  const confirmed = useCallback((r: Role) => {
    const a = localAddress(r)
    return !!a && confirmedList.includes(`${r}:${a.toLowerCase()}`)
  }, [confirmedList, localAddress])

  const signInLocal = useCallback((r: Role) => {
    const a = localAddress(r)
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
    if (identity.kind === 'wallet') return signTypedData(wagmiConfig, args as unknown as Parameters<typeof signTypedData>[1])
    if (identity.kind === 'replay') throw new Error('Replay holds no keys. Use the recorded or simulated approval.')
    throw new Error('Sign in with a wallet to sign.')
  }, [identity, localAccount])

  const sendTx = useCallback((tx: TxRequest): Promise<Hex> => guardedSend(chainId, tx, async (t) => {
    if (identity.kind === 'demo') {
      const account = await demoAccount(identity.role)
      const client = createWalletClient({ account, chain: foundry, transport: http(RPC_URLS[foundry.id]) })
      return client.sendTransaction({ to: t.to, data: t.data, value: 0n })
    }
    if (identity.kind === 'local') return localTx(identity.role, t)
    if (identity.kind === 'wallet') return sendTransaction(wagmiConfig, { to: t.to, data: t.data, value: 0n })
    throw new Error('Sign in with a wallet to send this transaction.')
  }), [chainId, identity, localTx])

  const sendAs = useCallback(async (r: Role, fn: RegistryFn, args: readonly unknown[]): Promise<Hex> => {
    const data = encodeFunctionData({ abi: REGISTRY_ABI, functionName: fn, args } as never)
    return localTx(r, { to: pinnedRegistry(chainId), data, value: '0' })
  }, [chainId, localTx])

  const bankAction = useCallback(async (action: BankAction, safe: Address): Promise<Hex | null> => {
    if (!address) throw new Error('Switch to the bank officer first.')
    if (mode === 'replay') {
      await api.simulateBankAction?.(action, safe, address)
      return null
    }
    if (identity.kind === 'local') return sendAs('bank', action, [safe])
    if (identity.kind === 'demo') {
      const account = await demoAccount(identity.role)
      const client = createWalletClient({ account, chain: foundry, transport: http(RPC_URLS[foundry.id]) })
      return client.writeContract({ address: pinnedRegistry(chainId), abi: REGISTRY_ABI, functionName: action, args: [safe] })
    }
    return writeContract(wagmiConfig, { address: pinnedRegistry(chainId), abi: REGISTRY_ABI, functionName: action, args: [safe] })
  }, [address, api, chainId, identity, mode, sendAs])

  const chooser = useMemo(() => ({
    open: chooserOpen,
    intent: chooserIntent,
    wanted: chooserWanted,
    show: (intent: ChooserIntent = 'switch', wanted: Role | null = null) => { setChooserIntent(intent); setChooserWanted(wanted); setChooserOpen(true) },
    hide: () => { setChooserOpen(false); setChooserWanted(null) },
  }), [chooserIntent, chooserOpen, chooserWanted])

  const signedIn = session === 'ready' && signedFor === key
  // Right after a seat change the old session is still 'ready' for one render; only a session opened for this key counts.
  const sessionReady = session === 'ready' && (signedFor === null ? identity.kind !== 'local' && identity.kind !== 'wallet' : signedFor === key)
  const value: IdentityValue = {
    identity, role, address, seat, demoAvailable, chooseSeat, chooseDemo, session, sessionError, signedIn, signIn, signOut, walletRole, chooser, sign, sendTx, bankAction,
    localAddress, confirmed, signInLocal, sendAs, isLocal: identity.kind === 'local', sessionReady,
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
