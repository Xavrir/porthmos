import { useEffect, useId, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'
import type { RiskComponents } from '../lib/types'
import { clock, compact, day, money, stamp } from '../lib/format'
import { niceTicks, type BalancePoint } from '../lib/history'

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

export function Sparkline({ values, tone = 'accent' }: { values: number[]; tone?: 'accent' | 'vault' }) {
  const id = useId()
  if (values.length < 2) return null
  const W = 120
  const H = 32
  const lo = Math.min(...values)
  const hi = Math.max(...values)
  const span = hi - lo || 1
  const x = (i: number) => (i / (values.length - 1)) * W
  const y = (v: number) => H - 3 - ((v - lo) / span) * (H - 6)
  const line = values.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ')
  return (
    <svg className={`spark spark-${tone}`} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id={id} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" className="spark-stop-a" />
          <stop offset="1" className="spark-stop-b" />
        </linearGradient>
      </defs>
      <path d={`${line} L${W},${H} L0,${H} Z`} fill={`url(#${id})`} />
      <path d={line} className="spark-line" vectorEffect="non-scaling-stroke" />
    </svg>
  )
}

const SERIES = [
  { key: 'safe', label: 'Cash in the Safe', cls: 's-safe' },
  { key: 'vaults', label: 'In vaults', cls: 's-vault' },
] as const

function short(t: number) {
  return `${day(t)}, ${clock(t).slice(0, 5)}`
}

function stepPath(pts: BalancePoint[], key: 'safe' | 'vaults', x: (t: number) => number, y: (v: number) => number) {
  let d = ''
  pts.forEach((p, i) => {
    const px = x(p.t).toFixed(1)
    const py = y(p[key]).toFixed(1)
    if (!i) d = `M${px},${py}`
    else d += ` H${px} V${py}`
  })
  return d
}

export function BalanceChart({ points, height = 240 }: { points: BalancePoint[]; height?: number }) {
  const wrap = useRef<HTMLDivElement>(null)
  const [w, setW] = useState(720)
  const [active, setActive] = useState<number | null>(null)
  const gid = useId()
  useEffect(() => {
    const el = wrap.current
    if (!el) return
    const ro = new ResizeObserver(([e]) => setW(Math.max(260, Math.round(e.contentRect.width))))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  const pad = { l: 52, r: 12, t: 12, b: 28 }
  const t0 = points[0].t
  const t1 = Math.max(points[points.length - 1].t, t0 + 1)
  const ticks = niceTicks(Math.max(1, ...points.flatMap((p) => [p.safe, p.vaults])))
  const hi = ticks[ticks.length - 1]
  const x = (t: number) => pad.l + ((t - t0) / (t1 - t0)) * (w - pad.l - pad.r)
  const y = (v: number) => pad.t + (1 - v / hi) * (height - pad.t - pad.b)
  const at = active === null ? null : points[active]
  const last = points[points.length - 1]

  const pick = (e: PointerEvent<SVGSVGElement>) => {
    const box = e.currentTarget.getBoundingClientRect()
    const t = t0 + ((e.clientX - box.left - pad.l) / (w - pad.l - pad.r)) * (t1 - t0)
    let i = 0
    for (let k = 0; k < points.length; k++) if (points[k].t <= t) i = k
    setActive(i)
  }
  const onKey = (e: KeyboardEvent) => {
    const n = points.length
    const cur = active ?? n - 1
    let next: number | null = null
    if (e.key === 'ArrowRight') next = Math.min(n - 1, cur + 1)
    else if (e.key === 'ArrowLeft') next = Math.max(0, cur - 1)
    else if (e.key === 'Home') next = 0
    else if (e.key === 'End') next = n - 1
    else if (e.key === 'Escape') { setActive(null); return }
    if (next !== null) { e.preventDefault(); setActive(next) }
  }
  const tipLeft = at ? Math.min(Math.max(x(at.t) + 12, 0), w - 196) : 0
  const flip = at ? x(at.t) + 208 > w : false
  const summary = `Cash in the Safe went from ${money(points[0].safe)} to ${money(last.safe)} USDC and vaults from ${money(points[0].vaults)} to ${money(last.vaults)}, between ${stamp(t0)} and ${stamp(last.t)}. Use the arrow keys to read each change.`

  return (
    <div className="bchart">
      <ul className="bchart-legend">
        {SERIES.map((s) => (
          <li key={s.key} className={s.cls}><span className="bchart-swatch" aria-hidden="true" />{s.label}<strong className="nums">{money(last[s.key])}</strong></li>
        ))}
      </ul>
      <div className="bchart-plot" ref={wrap} tabIndex={0} role="group" aria-roledescription="chart" aria-label={`Balance over time. ${summary}`}
        onKeyDown={onKey} onFocus={() => setActive((a) => a ?? points.length - 1)} onBlur={() => setActive(null)}>
        <svg width={w} height={height} viewBox={`0 0 ${w} ${height}`} aria-hidden="true" focusable="false"
          onPointerMove={pick} onPointerLeave={() => setActive(null)}>
          <defs>
            <linearGradient id={`${gid}-safe`} x1="0" x2="0" y1="0" y2="1"><stop offset="0" className="fill-safe-a" /><stop offset="1" className="fill-b" /></linearGradient>
            <linearGradient id={`${gid}-vault`} x1="0" x2="0" y1="0" y2="1"><stop offset="0" className="fill-vault-a" /><stop offset="1" className="fill-b" /></linearGradient>
          </defs>
          {ticks.map((v, i) => (
            <g key={i}>
              <line x1={pad.l} x2={w - pad.r} y1={y(v)} y2={y(v)} className={i === 0 ? 'bc-grid base' : 'bc-grid'} />
              <text x={pad.l - 8} y={y(v) + 4} textAnchor="end" className="bc-tick">{v === 0 ? '0' : compact(v)}</text>
            </g>
          ))}
          <path d={`${stepPath(points, 'safe', x, y)} V${y(0)} H${x(t0)} Z`} fill={`url(#${gid}-safe)`} />
          <path d={`${stepPath(points, 'vaults', x, y)} V${y(0)} H${x(t0)} Z`} fill={`url(#${gid}-vault)`} />
          <path d={stepPath(points, 'safe', x, y)} className="bc-line s-safe" />
          <path d={stepPath(points, 'vaults', x, y)} className="bc-line s-vault" />
          <text x={pad.l} y={height - 8} className="bc-tick">{short(t0)}</text>
          <text x={w - pad.r} y={height - 8} textAnchor="end" className="bc-tick">{short(t1)}</text>
          {at ? (
            <g>
              <line x1={x(at.t)} x2={x(at.t)} y1={pad.t} y2={height - pad.b} className="bc-cross" />
              <circle cx={x(at.t)} cy={y(at.safe)} r={4.5} className="bc-dot s-safe" />
              <circle cx={x(at.t)} cy={y(at.vaults)} r={4.5} className="bc-dot s-vault" />
            </g>
          ) : null}
        </svg>
        {at ? (
          <div className="bchart-tip" style={{ left: flip ? Math.max(0, x(at.t) - 196 - 12) : tipLeft }}>
            <p className="bchart-tip-time nums">{stamp(at.t)}</p>
            {SERIES.map((s) => <p key={s.key} className={s.cls}><span className="bchart-swatch" aria-hidden="true" />{s.label}<strong className="nums">{money(at[s.key])}</strong></p>)}
          </div>
        ) : null}
        <p className="sr-only" aria-live="polite">{at ? `${stamp(at.t)}: cash in the Safe ${money(at.safe)}, in vaults ${money(at.vaults)}.` : ''}</p>
      </div>
    </div>
  )
}
