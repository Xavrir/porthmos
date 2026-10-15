import type { LiveChain } from '../lib/chain/live'
import { useOracle, useTreasury } from '../lib/queries'
import { money, shortHex } from '../lib/format'
import { CountText } from './Count'

const BASESCAN = 'https://sepolia.basescan.org'

function age(s: number): string {
  if (s < 90) return `${s} s`
  if (s < 5400) return `${Math.round(s / 60)} min`
  if (s < 172800) return `${Math.round(s / 3600)} h`
  return `${Math.round(s / 86400)} d`
}

export function ChainStrip({ live }: { live: LiveChain }) {
  const t = useTreasury()
  const o = useOracle()
  const isLive = live.status === 'live'
  const loading = live.status === 'loading'
  const last = live.executions[0]
  const vaultName = (v: string) => (v.toLowerCase() === live.addresses.vaultA.toLowerCase() ? 'Vault A' : v.toLowerCase() === live.addresses.vaultB.toLowerCase() ? 'Vault B' : shortHex(v))

  const safe = loading ? '…' : isLive && live.safeUsdc !== null ? money(live.safeUsdc) : t.data ? t.data.balances.safeUsdc.display : '…'
  const price = loading ? '…' : isLive && live.price !== null ? live.price.toFixed(4) : o.data?.price.display ?? '…'
  const priceAge = loading ? '' : isLive && live.ageSeconds !== null ? age(live.ageSeconds) : o.data ? age(o.data.ageSeconds) : ''
  const heading = loading ? 'Reading Base Sepolia…' : isLive ? 'Base Sepolia right now (real chain)' : 'Base Sepolia unreachable, showing replay'

  return (
    <section className={`chainstrip cs-${live.status}`} aria-label={heading}>
      <div className="cs-cell cs-head">
        <span className="cs-label" aria-live="polite">{heading}</span>
        <span className="cs-status">
          {loading ? 'One moment' : isLive ? <>Block <a className="link-plain" href={`${BASESCAN}/block/${live.block}`} target="_blank" rel="noreferrer"><CountText text={live.block!.toLocaleString('en-US')} /></a></> : <span className="cs-tag">Replay values</span>}
        </span>
        <span className="cs-sub cs-note">{isLive ? 'The coloured rail reads the chain too. The app pages replay a recorded run.' : loading ? '' : 'Everything on this page is the recorded run.'}</span>
      </div>
      <div className="cs-cell">
        <span className="cs-label">Safe holds{isLive ? '' : ' (replay)'}</span>
        <a className="cs-value link-plain" href={`${BASESCAN}/address/${live.addresses.safe}`} target="_blank" rel="noreferrer"><CountText text={safe === '…' ? '…' : `${safe} USDC`} /></a>
      </div>
      <div className="cs-cell">
        <span className="cs-label">Price feed{isLive ? '' : ' (replay)'}</span>
        <span className="cs-value"><CountText text={price} />{priceAge ? <span className="cs-sub">, updated {priceAge} ago</span> : null}</span>
      </div>
      <div className="cs-cell cs-wide">
        <span className="cs-label">Latest AegisExecuted</span>
        {last ? (
          <a className="cs-value link-plain" href={`${BASESCAN}/tx/${last.tx}`} target="_blank" rel="noreferrer">
            {last.op === 0 ? 'Deposit' : 'Redeem'} {money(last.assets)} {last.op === 0 ? 'into' : 'from'} {vaultName(last.vault)}<span className="cs-sub">, block {last.block.toLocaleString('en-US')}</span>
          </a>
        ) : (
          <span className="cs-value">{loading ? 'Searching recent blocks…' : isLive ? 'None found in recent blocks' : 'Not available without the chain'}</span>
        )}
      </div>
    </section>
  )
}
