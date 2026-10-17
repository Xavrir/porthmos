import { useQuery } from '@tanstack/react-query'
import { getAddress, isAddressEqual, type Address } from 'viem'
import { useAegis } from '../source'
import { useIdentity } from '../identity'
import { pinnedTradeFlow, type PinnedTradeFlow } from '../txguard'
import { publicClientFor } from '../onboard/chain'
import { FREEZE_ABI } from './abi'
import { recordedOrder } from './replay'
import type { OrderView, TradeFlowConfig } from './types'

export type TradeFlowState = {
  loading: boolean
  available: boolean
  replay: boolean
  pinned: PinnedTradeFlow | null
  config: TradeFlowConfig | null
  // Why owner actions are refused even though orders can be read (C1: API addresses must equal the bundled ones).
  blocked: string | null
}

export function configMismatch(pinned: PinnedTradeFlow | null, c: TradeFlowConfig | null): string | null {
  if (!pinned) return 'This build pins no TradeEscrow for this chain, so it builds no TradeFlow transaction.'
  if (!c || !c.enabled) return null
  const pairs: [string, Address | undefined, Address][] = [
    ['TradeEscrow', c.tradeEscrow, pinned.tradeEscrow], ['MultiSendCallOnly', c.multiSendCallOnly, pinned.multiSendCallOnly], ['USDC', c.token, pinned.usdc],
    ['demo carrier', c.issuers?.carrier, pinned.issuers.carrier], ['demo reefer sensor', c.issuers?.sensor, pinned.issuers.sensor], ['demo surveyor', c.issuers?.surveyor, pinned.issuers.surveyor],
  ]
  for (const [name, api, ours] of pairs) {
    if (api && !isAddressEqual(getAddress(api), ours)) return `The service reports ${name} ${api}, but this build pins ${ours}. Porthmos signs nothing for TradeFlow until they match.`
  }
  if (c.chainId && c.chainId !== pinned.chainId) return `The service runs chain ${c.chainId}, but this build pins chain ${pinned.chainId}.`
  return null
}

export function useTradeFlow(): TradeFlowState {
  const { http, mode, phase, service, chainId } = useAegis()
  const live = mode === 'live' && service === 'up'
  const cfg = useQuery({ queryKey: ['tradeflow-config', chainId, live], queryFn: () => http.tradeflowConfig(), enabled: phase === 'ready' && live, staleTime: 60_000, retry: 1 })
  if (mode === 'replay') return { loading: false, available: !!recordedOrder(), replay: true, pinned: pinnedTradeFlow(84532), config: null, blocked: 'Replay holds no keys.' }
  const pinned = pinnedTradeFlow(chainId)
  const config = cfg.data ?? null
  return { loading: cfg.isLoading, available: !!config?.enabled, replay: false, pinned, config, blocked: configMismatch(pinned, config) }
}

function useReady() {
  const { mode, phase, tenant } = useAegis()
  const { sessionReady, role } = useIdentity()
  return { mode, ready: phase === 'ready' && (mode === 'replay' || (sessionReady && !!role)), tenant }
}

export function useOrders() {
  const { http } = useAegis()
  const { mode, ready } = useReady()
  const tf = useTradeFlow()
  return useQuery({
    queryKey: ['orders', mode],
    queryFn: async (): Promise<OrderView[]> => {
      if (mode === 'replay') { const o = recordedOrder(); return o ? [o] : [] }
      return http.orders()
    },
    enabled: ready && (mode === 'replay' || tf.available),
    refetchInterval: mode === 'live' ? 4000 : false,
  })
}

export function useOrder(id: string | undefined, publicView: boolean) {
  const { http, mode, phase } = useAegis()
  const { ready } = useReady()
  const tf = useTradeFlow()
  return useQuery({
    queryKey: ['order', mode, id, publicView],
    queryFn: async (): Promise<OrderView | null> => {
      if (mode === 'replay') { const o = recordedOrder(); return o && o.order.orderId === id ? o : null }
      return http.order(id!, publicView)
    },
    enabled: !!id && phase === 'ready' && (publicView || ready) && (mode === 'replay' || tf.available),
    refetchInterval: mode === 'live' ? 3000 : false,
    retry: 1,
  })
}

export function useFreeze(safe: Address | undefined) {
  const { mode, chainId, rpcUrl, deployment } = useAegis()
  return useQuery({
    queryKey: ['freeze', chainId, safe],
    queryFn: async () => {
      const c = publicClientFor(chainId, rpcUrl)
      const [owner, bank] = await Promise.all([
        c.readContract({ address: deployment.registry, abi: FREEZE_ABI, functionName: 'ownerFrozen', args: [safe!] }),
        c.readContract({ address: deployment.registry, abi: FREEZE_ABI, functionName: 'bankFrozen', args: [safe!] }),
      ])
      return { owner, bank }
    },
    enabled: mode === 'live' && !!safe,
    refetchInterval: 10_000,
    retry: 1,
  })
}
