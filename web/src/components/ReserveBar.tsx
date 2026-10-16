import { useState } from 'react'
import { money, num, pct } from '../lib/format'
import type { TreasuryState } from '../lib/types'
import { Icon } from './icons'

type Segment = { key: string; label: string; value: number; mark: string; quarantined?: boolean }

export function reserveSegments(t: TreasuryState): Segment[] {
  const safe = num(t.balances.safeUsdc)
  const floor = num(t.reserve.onchainFloor)
  const required = num(t.reserve.required)
  const reserve = Math.min(safe, Math.max(floor, required))
  const fees = Math.min(Math.max(0, safe - reserve), num(t.fees))
  const idle = Math.max(0, safe - reserve - fees)
  const shortfall = Math.max(0, Math.max(floor, required) - safe)
  return [
    { key: 'reserve', label: 'Reserve', value: reserve, mark: 'c1' },
    ...t.balances.vaults.slice(0, 2).map((v, i) => ({ key: `vault-${i}`, label: v.quarantined ? `${v.name}, quarantined` : v.name, value: num(v.assets), mark: `c${i + 2}`, quarantined: !!v.quarantined })),
    { key: 'idle', label: 'Idle cash', value: idle, mark: 'c4' },
    { key: 'fees', label: 'Kept for gas', value: fees, mark: 'is-muted' },
    ...(shortfall > 0 ? [{ key: 'short', label: 'Shortfall', value: shortfall, mark: 'is-critical' }] : []),
  ].filter((s) => s.value > 0.004)
}

export function ReserveBar({ t }: { t: TreasuryState }) {
  const segs = reserveSegments(t)
  const total = segs.reduce((a, s) => a + s.value, 0) || 1
  const [on, setOn] = useState<string | null>(null)
  return (
    <figure className={`alloc${on ? ' has-on' : ''}`} data-ui>
      <div className="alloc-track" aria-hidden="true">
        {segs.map((s) => (
          <span key={s.key} className={`alloc-seg ${s.mark}${s.quarantined ? ' is-q' : ''}${on === s.key ? ' is-on' : ''}`} style={{ flexGrow: s.value / total }}
            onPointerEnter={() => setOn(s.key)} onPointerLeave={() => setOn(null)} />
        ))}
      </div>
      <figcaption>
        <ul className="alloc-list">
          {segs.map((s) => (
            <li key={s.key} className={on === s.key ? 'is-on' : undefined} onPointerEnter={() => setOn(s.key)} onPointerLeave={() => setOn(null)}>
              <span className={`viz-swatch ${s.mark}`} aria-hidden="true" />
              <span className="alloc-name">{s.key === 'short' ? <Icon name="alert" className="alloc-icon" /> : null}{s.label}</span>
              <span className="alloc-val nums">{money(s.value)}</span>
              <span className="alloc-share nums">{pct(s.value / total)}</span>
            </li>
          ))}
        </ul>
      </figcaption>
    </figure>
  )
}
