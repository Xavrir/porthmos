import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import type { AegisApi, Mode, StreamStatus } from './api/contract'
import { HttpApi } from './api/http'
import { ReplayApi } from '../replay/engine'
import { loadDeployment, REPLAY_DEPLOY, type Deployment } from './deployment'
import type { Health, StreamEvent } from './types'

type Phase = 'probing' | 'ready'

export type FeedItem = { id: number; at: number; event: StreamEvent }

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
}

const ApiContext = createContext<ApiContextValue | null>(null)

const MODE_KEY = 'aegis.mode'
const API_KEY = 'aegis.api'
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

  const probe = useCallback(async (prefer: Mode | null, base: string = apiBase) => {
    setPhase('probing')
    const toReplay = async (why: string) => {
      setMode('replay'); setReason(why); setHealth(await replay.health()); setDeployment(REPLAY_DEPLOY); setPhase('ready')
    }
    if (prefer === 'replay') return toReplay('Replay chosen')
    if (!base && !onLocalHost() && prefer !== 'live') return toReplay('No live service is configured for this deployment')
    const client = base === apiBase ? http : new HttpApi(base)
    try {
      const h = await client.health()
      if (!h.ok) throw new Error('Service reported not ok')
      const chainId = h.chainId ?? Number(import.meta.env.VITE_CHAIN_ID ?? 31337)
      const dep = (await loadDeployment(chainId)) ?? (chainId === REPLAY_DEPLOY.chainId ? REPLAY_DEPLOY : null)
      setHealth({ ...h, chainId })
      setDeployment(dep ?? { ...REPLAY_DEPLOY, chainId })
      setMode('live')
      setReason(dep ? null : `No deployments/${chainId}.json found; contract addresses shown may be wrong`)
      setPhase('ready')
    } catch (e) {
      const where = base || 'this site'
      await toReplay(prefer === 'live' ? `The service at ${where} did not answer (${(e as Error).message || 'no response'})` : `The service at ${where} did not answer`)
    }
  }, [apiBase, http, replay])

  useEffect(() => {
    void probe(forcedMode())
  }, [probe])

  const api: AegisApi = mode === 'live' ? http : replay

  useEffect(() => {
    if (phase !== 'ready') return
    const invalidate = (keys: string[]) => keys.forEach((k) => qc.invalidateQueries({ queryKey: [k] }))
    const stop = api.stream((event) => {
      const item = { id: ++counter.current, at: Date.now(), event }
      setFeed((f) => [item, ...f].slice(0, 40))
      switch (event.type) {
        case 'treasury': qc.setQueryData(['treasury', mode], event.data); break
        case 'risk': qc.setQueryData(['risk', mode], event.data); break
        case 'oracle': qc.setQueryData(['oracle', mode], event.data); break
        case 'ledger': invalidate(['ledger', 'reconciliation', 'bank-clients']); break
        case 'execution': invalidate(['events', 'treasury', 'reconciliation']); break
        case 'state': invalidate(['request', 'approvals', 'requests']); break
        case 'policy': invalidate(['treasury', 'bank-clients', 'request', 'approvals']); break
        case 'notice': setNotices((n) => [item, ...n].slice(0, 4)); invalidate(['bank-clients', 'obligations', 'treasury']); break
      }
    }, setStreamStatus)
    return stop
  }, [api, mode, phase, qc])

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
      setApiBase(clean)
      void probe('live', clean)
    },
    forgetApi: () => {
      try { localStorage.removeItem(API_KEY); sessionStorage.setItem(MODE_KEY, 'replay') } catch { /* nothing stored */ }
      setApiBase('')
      void probe('replay', '')
    },
  }
  return <ApiContext.Provider value={value}>{children}</ApiContext.Provider>
}

export function useAegis(): ApiContextValue {
  const ctx = useContext(ApiContext)
  if (!ctx) throw new Error('useAegis outside ApiProvider')
  return ctx
}
