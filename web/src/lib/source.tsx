import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { zeroAddress, type Address } from 'viem'
import { useConnection } from 'wagmi'
import type { AegisApi, AuthRoles, Mode, StreamStatus } from './api/contract'
import { HttpApi } from './api/http'
import { ReplayApi } from '../replay/engine'
import { deploymentFromConfig, loadDeployment, REPLAY_DEPLOY, type Deployment } from './deployment'
import { demoIdentitiesAvailable } from './demo/allowed'
import { bankAddress, clearWallet, loadWallet, ownerAddress, saveWallet, type WalletFile } from './keys'
import type { OnboardConfig, OnboardStatus } from './onboard/types'
import { RPC_URLS } from './wallet'
import type { Health, StreamEvent } from './types'

type Phase = 'probing' | 'ready'

export type FeedItem = { id: number; at: number; event: StreamEvent }

// 'off': no API address on a static host, so nothing was called.
export type ServiceState = 'off' | 'down' | 'up'

export type SeatKey = 'key' | 'wallet' | null

// via 'file': the keys file in this browser names the owner; via 'wallet': the connected wallet's registry roles.
export type Tenant = { safe: Address; owner: Address; bank: Address; ownerKind: 'burner' | 'injected'; via: 'file' | 'wallet'; seats: { owner: SeatKey; bank: SeatKey } }

export type AccountSource = 'file' | 'wallet'

type ApiContextValue = {
  api: AegisApi
  mode: Mode
  phase: Phase
  reason: string | null
  health: Health | null
  chainId: number
  deployment: Deployment
  streamStatus: StreamStatus
  feed: FeedItem[]
  notices: FeedItem[]
  dismissNotice: (id: number) => void
  switchMode: (mode: Mode) => void
  apiBase: string
  connect: (url: string) => void
  forgetApi: () => void
  sessionEpoch: number
  bumpSession: () => void
  demoChanged: boolean
  resetDemo: () => void
  http: HttpApi
  service: ServiceState
  onboard: OnboardConfig | null
  onboardStatus: OnboardStatus | null
  rpcUrl: string
  wallet: WalletFile | null
  setWallet: (w: WalletFile | null) => void
  tenant: Tenant | null
  refresh: (prefer?: Mode | null) => void
  replayChosen: boolean
  forgetReplay: () => void
  walletRoles: AuthRoles | null
  rolesFor: Address | null
  rolesFailed: boolean
  accountSource: AccountSource
  chooseAccount: (source: AccountSource) => void
}

const ApiContext = createContext<ApiContextValue | null>(null)

const MODE_KEY = 'aegis.mode'
const API_KEY = 'aegis.api'
const ACCOUNT_KEY = 'porthmos.account'

function readAccount(): AccountSource | null {
  try {
    const v = sessionStorage.getItem(ACCOUNT_KEY)
    return v === 'file' || v === 'wallet' ? v : null
  } catch {
    return null
  }
}

export function tenantFromRoles(roles: AuthRoles, file: WalletFile | null): Tenant | null {
  const fileBank = file ? bankAddress(file).toLowerCase() : null
  if (roles.owner) {
    const bank = roles.owner.bank ?? zeroAddress
    return { safe: roles.owner.safe, owner: roles.address, bank, ownerKind: 'injected', via: 'wallet', seats: { owner: 'wallet', bank: fileBank && fileBank === bank.toLowerCase() ? 'key' : null } }
  }
  const b = roles.bank[0]
  if (b) return { safe: b.safe, owner: b.owner, bank: roles.address, ownerKind: 'injected', via: 'wallet', seats: { owner: null, bank: 'wallet' } }
  return null
}
export const DEFAULT_LIVE_URL = 'http://localhost:8787'

function cleanBase(url: string): string | null {
  try {
    const u = new URL(url)
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.origin + u.pathname.replace(/\/$/, '') : null
  } catch {
    return null
  }
}

function initialApiBase(): string {
  try {
    const q = new URLSearchParams(window.location.search).get('api')
    if (q !== null) {
      const clean = q ? cleanBase(q) : null
      if (clean) localStorage.setItem(API_KEY, clean)
      else localStorage.removeItem(API_KEY)
      return clean ?? ''
    }
    const stored = localStorage.getItem(API_KEY)
    if (stored && cleanBase(stored)) return stored
  } catch {
    /* storage blocked: fall through to the build-time default */
  }
  return (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, '') ?? ''
}

function onLocalHost(): boolean {
  const h = window.location.hostname
  return h === 'localhost' || h === '127.0.0.1' || h === '[::1]' || h.endsWith('.localhost')
}

function forcedMode(): Mode | null {
  try {
    const q = new URLSearchParams(window.location.search).get('mode')
    if (q === 'replay' || q === 'live') {
      sessionStorage.setItem(MODE_KEY, q)
      return q
    }
    const s = sessionStorage.getItem(MODE_KEY)
    return s === 'replay' || s === 'live' ? s : null
  } catch {
    return null
  }
}

export function ApiProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient()
  const [apiBase, setApiBase] = useState<string>(initialApiBase)
  const http = useMemo(() => new HttpApi(apiBase), [apiBase])
  const replay = useMemo(() => new ReplayApi(), [])
  const [mode, setMode] = useState<Mode>('replay')
  const [phase, setPhase] = useState<Phase>('probing')
  const [reason, setReason] = useState<string | null>(null)
  const [health, setHealth] = useState<Health | null>(null)
  const [deployment, setDeployment] = useState<Deployment>(REPLAY_DEPLOY)
  const [streamStatus, setStreamStatus] = useState<StreamStatus>('connecting')
  const [feed, setFeed] = useState<FeedItem[]>([])
  const [notices, setNotices] = useState<FeedItem[]>([])
  const [sessionEpoch, setSessionEpoch] = useState(0)
  const counter = useRef(0)

  const [service, setService] = useState<ServiceState>('off')
  const [onboard, setOnboard] = useState<OnboardConfig | null>(null)
  const [onboardStatus, setOnboardStatus] = useState<OnboardStatus | null>(null)
  const [wallet, setWalletState] = useState<WalletFile | null>(loadWallet)
  const [tenant, setTenant] = useState<Tenant | null>(null)
  // Only a replay the visitor asked for (View the demo, ?mode=replay, a switch) opens the app without a session.
  const [replayChosen, setReplayChosen] = useState(() => forcedMode() === 'replay')
  const conn = useConnection()
  const connected = conn.address ?? null
  const connectedRef = useRef<Address | null>(connected)
  const [accountPref, setAccountPref] = useState<AccountSource | null>(readAccount)
  const accountRef = useRef(accountPref)
  useLayoutEffect(() => { connectedRef.current = connected; accountRef.current = accountPref }, [connected, accountPref])
  const seq = useRef(0)
  const probedAddr = useRef<Address | null>(null)
  const [walletRoles, setWalletRoles] = useState<AuthRoles | null>(null)
  const [rolesFor, setRolesFor] = useState<Address | null>(null)
  const [rolesFailed, setRolesFailed] = useState(false)

  const probe = useCallback(async (prefer: Mode | null, base: string = apiBase) => {
    const my = ++seq.current
    const stale = () => seq.current !== my
    setPhase('probing')
    let w = loadWallet()
    setWalletState(w)
    probedAddr.current = connectedRef.current
    const toReplay = async (why: string, svc: ServiceState) => {
      const rh = await replay.health()
      if (stale()) return
      setService(svc); setMode('replay'); setReason(why); setHealth(rh); setDeployment(REPLAY_DEPLOY); setPhase('ready')
    }
    if (!base && !onLocalHost() && prefer !== 'live') {
      setOnboard(null); setTenant(null)
      return toReplay('No live service is configured for this deployment', 'off')
    }
    const client = base === apiBase ? http : new HttpApi(base)
    let h: Health
    try {
      h = await client.health()
      if (!h.ok) throw new Error('Service reported not ok')
    } catch (e) {
      if (stale()) return
      const where = base || 'this site'
      setOnboard(null); setTenant(null)
      return toReplay(prefer === 'live' ? `The service at ${where} did not answer (${(e as Error).message || 'no response'})` : `The service at ${where} did not answer`, 'down')
    }
    const chainId = h.chainId ?? Number(import.meta.env.VITE_CHAIN_ID ?? 31337)
    const cfg = await client.onboardConfig().catch(() => null)
    let found: Tenant | null = null
    let st: OnboardStatus | null = null
    const addr = connectedRef.current
    const fileOwner = w ? ownerAddress(w).toLowerCase() : null
    // The connected wallet wins when it was chosen at sign-in, or when no keys file in this browser names an owner.
    const viaWallet = !!cfg && !!addr && (accountRef.current === 'wallet' || !w || w.chainId !== cfg.chainId || fileOwner === addr.toLowerCase())
    let roles: AuthRoles | null = null
    // A failed lookup is not "no account": one retry, then the sign-in page says the check failed.
    if (cfg && addr) roles = await client.authRoles(addr).catch(() => client.authRoles(addr)).catch(() => null)
    if (stale()) return
    setWalletRoles(roles)
    setRolesFor(addr)
    setRolesFailed(!!cfg && !!addr && roles === null)
    if (cfg && w && w.chainId === cfg.chainId && !(viaWallet && fileOwner !== addr?.toLowerCase())) {
      const owner = ownerAddress(w)
      st = await client.onboardStatus(owner).catch(() => null)
      if (stale()) return
      const safe = st?.safe ?? w.safe
      if (st?.safe && st.safe !== w.safe) {
        w = { ...w, safe: st.safe }
        saveWallet(w)
        setWalletState(w)
      }
      if (st?.steps.activated && safe) {
        found = { safe, owner, bank: bankAddress(w), ownerKind: w.owner.type, via: 'file', seats: { owner: w.owner.type === 'burner' ? 'key' : 'wallet', bank: 'key' } }
      }
    }
    if (!found && viaWallet && roles) found = tenantFromRoles(roles, w)
    setOnboard(cfg)
    setOnboardStatus(st)
    setTenant(found)
    setService('up')
    const fileDep = (await loadDeployment(chainId)) ?? (chainId === REPLAY_DEPLOY.chainId ? REPLAY_DEPLOY : null)
    if (stale()) return
    const canLive = !cfg || !!found || demoIdentitiesAvailable(chainId)
    if (prefer === 'replay' || !canLive) {
      return toReplay(prefer === 'replay' ? 'Replay chosen' : w ? 'Your treasury is not set up yet' : 'No treasury in this browser yet', 'up')
    }
    setHealth({ ...h, chainId })
    setDeployment(cfg ? deploymentFromConfig(cfg, found, fileDep) : fileDep ?? { ...REPLAY_DEPLOY, chainId })
    setMode('live')
    setReason(cfg || fileDep ? null : `No deployments/${chainId}.json found; contract addresses shown may be wrong`)
    setPhase('ready')
  }, [apiBase, http, replay])

  // wagmi starts reconnecting the last wallet while it renders; the first probe waits for that (at most 1.5 s), so a
  // returning wallet user is not sent to sign in before the wallet is back.
  const settled = conn.status !== 'connecting' && conn.status !== 'reconnecting'
  const [waitedOut, setWaitedOut] = useState(false)
  useEffect(() => {
    const t = setTimeout(() => setWaitedOut(true), 1500)
    return () => clearTimeout(t)
  }, [])
  const started = useRef(false)
  useEffect(() => {
    if (!settled && !waitedOut) return
    if (!started.current) {
      started.current = true
      void probe(forcedMode())
      return
    }
    if (!settled || (probedAddr.current ?? '').toLowerCase() === (connected ?? '').toLowerCase()) return
    void probe(forcedMode())
  }, [settled, waitedOut, connected, probe])

  const api: AegisApi = mode === 'live' ? http : replay

  useEffect(() => {
    if (phase !== 'ready') return
    if (mode === 'live' && api.hasSession?.() === false) return
    const invalidate = (keys: string[]) => keys.forEach((k) => qc.invalidateQueries({ queryKey: [k] }))
    const stop = api.stream((event) => {
      const item = { id: ++counter.current, at: Date.now(), event }
      setFeed((f) => [item, ...f].slice(0, 40))
      switch (event.type) {
        // The service's stream payloads are summaries, not the full GET shapes, so live mode refetches instead.
        case 'treasury': if (mode === 'live') invalidate(['treasury']); else qc.setQueryData(['treasury', mode], event.data); break
        case 'risk': if (mode === 'live') invalidate(['risk']); else qc.setQueryData(['risk', mode], event.data); break
        case 'oracle': if (mode === 'live') invalidate(['oracle']); else qc.setQueryData(['oracle', mode], event.data); break
        case 'ledger': invalidate(['ledger', 'reconciliation', 'bank-clients']); break
        case 'execution': invalidate(['events', 'treasury', 'reconciliation']); break
        case 'state': invalidate(['request', 'approvals', 'requests']); break
        case 'policy': invalidate(['treasury', 'bank-clients', 'request', 'approvals']); break
        case 'notice': setNotices((n) => [item, ...n].slice(0, 4)); invalidate(['bank-clients', 'obligations', 'treasury']); break
        default:
          if ((event as { type: string }).type === 'attack') invalidate(['ledger', 'events'])
          if ((event as { type: string }).type === 'market') invalidate(['market'])
      }
    }, setStreamStatus)
    return stop
  }, [api, mode, phase, qc, sessionEpoch, tenant])

  useEffect(() => {
    qc.invalidateQueries()
  }, [mode, qc])

  const value: ApiContextValue = {
    api, mode, phase, reason, health,
    chainId: health?.chainId ?? deployment.chainId,
    deployment, streamStatus, feed, notices,
    dismissNotice: (id) => setNotices((n) => n.filter((x) => x.id !== id)),
    switchMode: (m) => {
      try { sessionStorage.setItem(MODE_KEY, m) } catch { /* storage may be blocked; the switch still applies this visit */ }
      setReplayChosen(m === 'replay')
      void probe(m)
    },
    sessionEpoch,
    bumpSession: () => setSessionEpoch((e) => e + 1),
    demoChanged: mode === 'replay' && replay.isChanged(),
    resetDemo: () => { replay.reset(); qc.invalidateQueries() },
    apiBase,
    connect: (url) => {
      const clean = cleanBase(url.trim())
      if (!clean) { setReason('That is not an http(s) address'); return }
      try { localStorage.setItem(API_KEY, clean); sessionStorage.setItem(MODE_KEY, 'live') } catch { /* the choice still applies to this visit */ }
      setReplayChosen(false)
      setApiBase(clean)
      void probe('live', clean)
    },
    forgetApi: () => {
      try { localStorage.removeItem(API_KEY); sessionStorage.setItem(MODE_KEY, 'replay') } catch { /* nothing stored */ }
      setReplayChosen(true)
      setApiBase('')
      void probe('replay', '')
    },
    http,
    service,
    onboard,
    onboardStatus,
    rpcUrl: onboard?.rpcUrl ?? RPC_URLS[health?.chainId ?? deployment.chainId] ?? RPC_URLS[84532],
    wallet,
    setWallet: (w) => {
      if (w) saveWallet(w)
      else clearWallet()
      setWalletState(w)
    },
    tenant,
    refresh: (prefer = null) => {
      if (prefer) {
        try { sessionStorage.setItem(MODE_KEY, prefer) } catch { /* the choice still applies to this visit */ }
        setReplayChosen(prefer === 'replay')
      }
      void probe(prefer ?? forcedMode())
    },
    replayChosen,
    walletRoles: rolesFor && connected && rolesFor.toLowerCase() === connected.toLowerCase() ? walletRoles : null,
    rolesFor,
    rolesFailed: rolesFailed && !!rolesFor && !!connected && rolesFor.toLowerCase() === connected.toLowerCase(),
    accountSource: accountPref ?? (wallet ? 'file' : 'wallet'),
    chooseAccount: (src) => {
      try { sessionStorage.setItem(ACCOUNT_KEY, src) } catch { /* the choice lasts for this page */ }
      accountRef.current = src
      setAccountPref(src)
      void probe(forcedMode())
    },
    forgetReplay: () => {
      try { sessionStorage.removeItem(MODE_KEY) } catch { /* nothing stored */ }
      setReplayChosen(false)
    },
  }
  return <ApiContext.Provider value={value}>{children}</ApiContext.Provider>
}

export function useAegis(): ApiContextValue {
  const ctx = useContext(ApiContext)
  if (!ctx) throw new Error('useAegis outside ApiProvider')
  return ctx
}
