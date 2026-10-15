import type { RiskComponents } from '../lib/types'
import { clock } from '../lib/format'

export function OracleChart({ history, price, stale }: { history: { t: number; price: number }[]; price: number; stale: boolean }) {
  const W = 800
  const H = 280
  const pad = { l: 64, r: 20, t: 18, b: 34 }
  const pts = history.length ? history : [{ t: 0, price }]
  const t0 = pts[0].t
  const t1 = Math.max(pts[pts.length - 1].t, t0 + 1)
  const lo = Math.min(0.978, ...pts.map((p) => p.price))
  const hi = Math.max(1.022, ...pts.map((p) => p.price))
  const x = (t: number) => pad.l + ((t - t0) / (t1 - t0)) * (W - pad.l - pad.r)
  const y = (p: number) => pad.t + (1 - (p - lo) / (hi - lo)) * (H - pad.t - pad.b)
  const path = pts.map((p, i) => `${i ? 'L' : 'M'}${x(p.t).toFixed(1)},${y(p.price).toFixed(1)}`).join(' ')
  const last = pts[pts.length - 1]
  const ticks = [0.98, 0.99, 1.0, 1.01, 1.02].filter((v) => v >= lo && v <= hi)
  return (
    <figure className="chart" data-ui>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Oracle price over the last ${Math.round((t1 - t0) / 60)} minutes, now ${price.toFixed(4)}${stale ? ', stale' : ''}. Exit zone below 0.9900 and above 1.0100.`}>
        <rect x={pad.l} y={pad.t} width={W - pad.l - pad.r} height={Math.max(0, y(1.01) - pad.t)} className="zone" />
        <rect x={pad.l} y={y(0.99)} width={W - pad.l - pad.r} height={Math.max(0, H - pad.b - y(0.99))} className="zone" />
        {ticks.map((v) => (
          <g key={v}>
            <line x1={pad.l} x2={W - pad.r} y1={y(v)} y2={y(v)} className={v === 1 ? 'grid strong' : 'grid'} />
            <text x={pad.l - 10} y={y(v) + 5} textAnchor="end" className="tick">{v.toFixed(2)}</text>
          </g>
        ))}
        <text x={pad.l + 8} y={y(0.99) + 20} className="zone-label">Peg trigger: exit below 0.9900</text>
        <path d={path} className={`line${stale ? ' is-stale' : ''}`} />
        <circle cx={x(last.t)} cy={y(last.price)} r={6} className={`dot${Math.abs(last.price - 1) > 0.01 ? ' is-alert' : ''}`} />
        <text x={pad.l} y={H - 8} className="tick">{clock(t0)}</text>
        <text x={W - pad.r} y={H - 8} textAnchor="end" className="tick">{clock(t1)}</text>
      </svg>
    </figure>
  )
}

const AXES: { key: keyof RiskComponents; label: string; weight: string }[] = [
  { key: 'peg', label: 'Peg', weight: '0.4' },
  { key: 'liquidity', label: 'Liquidity', weight: '0.3' },
  { key: 'utilisation', label: 'Utilisation', weight: '0.2' },
  { key: 'concentration', label: 'Concentration', weight: '0.1' },
]

export function RiskRadar({ components, alert }: { components: RiskComponents; alert: boolean }) {
  const S = 260
  const c = S / 2
  const r = S / 2 - 48
  const angle = (i: number) => -Math.PI / 2 + (i * 2 * Math.PI) / AXES.length
  const pt = (i: number, v: number) => [c + Math.cos(angle(i)) * r * v, c + Math.sin(angle(i)) * r * v]
  const poly = AXES.map((a, i) => pt(i, Math.max(0.04, Math.min(1, components[a.key]))).join(',')).join(' ')
  return (
    <svg className="radar" data-ui viewBox={`0 0 ${S} ${S}`} role="img" aria-label={AXES.map((a) => `${a.label} ${Math.round(components[a.key] * 100)}%`).join(', ')}>
      {[0.25, 0.5, 0.75, 1].map((ring) => (
        <polygon key={ring} points={AXES.map((_, i) => pt(i, ring).join(',')).join(' ')} className={ring === 1 ? 'ring outer' : 'ring'} />
      ))}
      {AXES.map((_, i) => { const [x2, y2] = pt(i, 1); return <line key={i} x1={c} y1={c} x2={x2} y2={y2} className="spoke" /> })}
      <polygon points={poly} className={`shape${alert ? ' is-alert' : ''}`} />
      {AXES.map((a, i) => {
        const [lx, ly] = pt(i, 1.2)
        return <text key={a.key} x={lx} y={ly + 4} textAnchor={Math.abs(lx - c) < 4 ? 'middle' : lx > c ? 'start' : 'end'} className="axis">{a.label}</text>
      })}
    </svg>
  )
}
