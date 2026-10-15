import { useEffect, useRef } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { Hex } from 'viem'
import { useAegis } from '../lib/source'
import { publicClientFor, waitForReceipt } from '../lib/onboard/chain'
import { Hash } from './bits'

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
  const r = useReceipt(hash)
  const status = r.data?.status
  const told = useRef(false)
  useEffect(() => {
    if (!status || told.current) return
    told.current = true
    onMined?.(status === 'success')
  }, [onMined, status])
  return (
    <span className="tx-status">
      <Hash value={hash} label={label} />
      <span className={`tx-state${status === 'reverted' ? ' is-bad' : ''}`} aria-live="polite">
        {r.isLoading ? 'Waiting for the block…' : r.isError ? 'Not confirmed yet. Check the explorer.' : status === 'success' ? `Mined, block ${r.data!.blockNumber.toLocaleString('en-US')}` : `Reverted on-chain, block ${r.data!.blockNumber.toLocaleString('en-US')}`}
      </span>
    </span>
  )
}
