import { useQuery } from '@tanstack/react-query'
import type { Address } from 'viem'
import { useAegis } from './source'
import { useIdentity } from './identity'
import type { RequestRecord } from './types'
import type { ReplayApi } from '../replay/engine'

// The service answers these reads only within a session, so live queries wait for it instead of failing with 401.
function useBase() {
  const { api, mode, phase, sessionEpoch } = useAegis()
  const { sessionReady } = useIdentity()
  const ready = phase === 'ready' && (mode !== 'live' || sessionReady)
  return { api, mode, ready, sessionEpoch }
}

export function useTreasury() {
  const { api, mode, ready } = useBase()
  return useQuery({ queryKey: ['treasury', mode], queryFn: () => api.treasury(), enabled: ready, refetchInterval: mode === 'live' ? 15000 : false })
}

export function useOracle() {
  const { api, mode, ready } = useBase()
  return useQuery({ queryKey: ['oracle', mode], queryFn: () => api.oracle(), enabled: ready, refetchInterval: 10000 })
}

export function useRisk() {
  const { api, mode, ready } = useBase()
  return useQuery({ queryKey: ['risk', mode], queryFn: () => api.risk(), enabled: ready, refetchInterval: mode === 'live' ? 15000 : false })
}

export function useObligations() {
  const { api, mode, ready } = useBase()
  return useQuery({ queryKey: ['obligations', mode], queryFn: () => api.obligations(), enabled: ready })
}

export function usePendingApprovals() {
  const { api, mode, ready, sessionEpoch } = useBase()
  const { sessionReady } = useIdentity()
  return useQuery({ queryKey: ['approvals', mode, sessionEpoch], queryFn: () => api.pendingApprovals(), enabled: ready && sessionReady, refetchInterval: mode === 'live' ? 10000 : false })
}

export function useLedger(safe?: Address) {
  const { api, mode, ready } = useBase()
  return useQuery({ queryKey: ['ledger', mode, safe ?? 'own'], queryFn: () => api.ledger(safe), enabled: ready })
}

export function useChainEvents(safe?: Address) {
  const { api, mode, ready } = useBase()
  return useQuery({ queryKey: ['events', mode, safe ?? 'own'], queryFn: () => api.events(safe), enabled: ready })
}

export function useBankClients(pollMs: number | false = false) {
  const { api, mode, ready, sessionEpoch } = useBase()
  const { role, sessionReady } = useIdentity()
  return useQuery({ queryKey: ['bank-clients', mode, sessionEpoch], queryFn: () => api.bankClients(), enabled: ready && role === 'bank' && sessionReady, retry: false, refetchInterval: pollMs })
}

export function useRequest(id: string | null) {
  const { api, mode, ready } = useBase()
  return useQuery({ queryKey: ['request', mode, id], queryFn: () => api.request(id!), enabled: ready && !!id, refetchInterval: mode === 'live' && id ? 3000 : false })
}

export function useRequestHistory() {
  const { api, mode, ready } = useBase()
  return useQuery({
    queryKey: ['requests', mode],
    queryFn: async (): Promise<RequestRecord[]> => (mode === 'replay' ? (api as ReplayApi).listRequests() : []),
    enabled: ready,
  })
}

export function useReconciliation(safe: Address | null) {
  const { api, mode, ready } = useBase()
  return useQuery({
    queryKey: ['reconciliation', mode, safe],
    queryFn: () => api.reconciliation!(safe!),
    enabled: ready && !!safe && !!api.reconciliation,
  })
}

export function useMarket() {
  const { http, service } = useAegis()
  return useQuery({ queryKey: ['market', service], queryFn: () => http.market(), enabled: service === 'up', refetchInterval: 30000, retry: false })
}
