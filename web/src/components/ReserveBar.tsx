import { money, num } from '../lib/format'
import type { TreasuryState } from '../lib/types'

export function reserveSegments(t: TreasuryState) {
  const safe = num(t.balances.safeUsdc)
  const floor = num(t.reserve.onchainFloor)
  const required = num(t.reserve.required)
  const reserve = Math.min(safe, Math.max(floor, required))
  const fees = Math.min(Math.max(0, safe - reserve), num(t.fees))
  const idle = Math.max(0, safe - reserve - fees)
  const shortfall = Math.max(0, Math.max(floor, required) - safe)
  return [
    { key: 'reserve', label: 'Reserve', sub: 'kept for obligations', value: reserve },
    { key: 'fees', label: 'Fees', sub: 'kept for gas', value: fees },
    { key: 'idle', label: 'Idle', sub: 'deployable cash', value: idle },
    ...t.balances.vaults.map((v, i) => ({ key: `vault-${i}`, label: v.name, sub: v.quarantined ? 'quarantined' : 'earning', value: num(v.assets), quarantined: !!v.quarantined })),
    ...(shortfall > 0 ? [{ key: 'short', label: 'Shortfall', sub: 'below the reserve', value: shortfall }] : []),
  ].filter((s) => s.value > 0.004)
}

export function ReserveBar({ t, labelled = true }: { t: TreasuryState; labelled?: boolean }) {
  const segs = reserveSegments(t)
  const total = segs.reduce((a, s) => a + s.value, 0) || 1
  return (
    <figure className="reserve-bar" data-ui>
      <div className="rb-track" role="img" aria-label={segs.map((s) => `${s.label} ${money(s.value)}`).join(', ')}>
        {segs.map((s, i) => (
          <span key={s.key} className={`rb-seg rb-${s.key.startsWith('vault') ? 'vault' : s.key}${'quarantined' in s && s.quarantined ? ' is-q' : ''}`} style={{ flexGrow: s.value / total, ['--i' as string]: i }} />
        ))}
      </div>
      {labelled ? (
        <figcaption className="rb-legend">
          {segs.map((s) => (
            <span key={s.key} className={`rb-key rb-k-${s.key.startsWith('vault') ? 'vault' : s.key}`}>
              <span className="rb-name">{s.label}</span>
              <span className="rb-val nums">{money(s.value)}</span>
              <span className="rb-sub">{s.sub}</span>
            </span>
          ))}
        </figcaption>
      ) : null}
    </figure>
  )
}
