import { useEffect, useRef } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { Hex } from 'viem'
import { useAegis } from '../lib/source'
import { publicClientFor, waitForReceipt } from '../lib/onboard/chain'
import { Hash } from './bits'
import { explorerTx } from '../lib/wallet'
import { toast } from '../lib/toast'

export function useReceipt(hash: Hex | null | undefined) {
  const { chainId, rpcUrl } = useAegis()
  return useQuery({
    queryKey: ['receipt', chainId, hash],
    queryFn: () => waitForReceipt(publicClientFor(chainId, rpcUrl), hash!, 120_000),
    enabled: !!hash,
    staleTime: Infinity,
    retry: 1,
  })
}

export function TxStatus({ hash, label = 'transaction', onMined }: { hash: Hex; label?: string; onMined?: (ok: boolean) => void }) {
  const { chainId } = useAegis()
  const r = useReceipt(hash)
  const status = r.data?.status
  const told = useRef(false)
  useEffect(() => {
    if (!status || told.current) return
    told.current = true
    const ok = status === 'success'
    const href = explorerTx(chainId, hash)
    toast({ tone: ok ? 'ok' : 'refused', title: `${label.charAt(0).toUpperCase()}${label.slice(1)} ${ok ? 'confirmed' : 'reverted'}`, text: r.data ? `Block ${r.data.blockNumber.toLocaleString('en-US')}.` : undefined, href, linkLabel: href ? 'View on Basescan' : undefined })
    onMined?.(ok)
  }, [onMined, status, chainId, hash, label, r.data])
  return (
    <span className="tx-status">
      <Hash value={hash} label={label} />
      <span className={`tx-state${status === 'reverted' ? ' is-bad' : ''}`} aria-live="polite">
        {r.isLoading ? 'Waiting for the block…' : r.isError ? 'Not confirmed yet. Check the explorer.' : status === 'success' ? `Mined, block ${r.data!.blockNumber.toLocaleString('en-US')}` : `Reverted on-chain, block ${r.data!.blockNumber.toLocaleString('en-US')}`}
      </span>
    </span>
  )
}
