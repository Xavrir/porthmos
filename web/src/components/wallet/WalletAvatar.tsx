import { useMemo } from 'react'
import type { Address } from 'viem'
import { blockieDataUri } from '../../lib/identicon'

export function WalletAvatar({ address, size = 24, className }: { address: Address; size?: number; className?: string }) {
  const src = useMemo(() => blockieDataUri(address, size * 2), [address, size])
  return <img className={`wallet-avatar${className ? ` ${className}` : ''}`} src={src} width={size} height={size} alt="" />
}
