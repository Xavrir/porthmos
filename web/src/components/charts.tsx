import { useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react'
import { clock, compact, day, money, pct, stamp } from '../lib/format'
import { DAY_OFFSET, niceTicks, timeTicks, type HoldingPoint } from '../lib/history'
import { CountText } from './Count'
import { DUR, lerpSeries, reducedMotion, sameSeries, tween } from '../lib/motion'

export type Slot = 1 | 2 | 3 | 4

function useWidth<T extends HTMLElement>(fallback: number) {
  const ref = useRef<T>(null)
  const [w, setW] = useState(fallback)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver(([e]) => setW(Math.max(120, Math.round(e.contentRect.width))))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return [ref, w] as const
}

/** Eases the plotted rows (pixel y values) from what is on screen to the new data, so a range or data change morphs. */
function useMorph(target: number[][]): number[][] {
  const [shown, setShown] = useState(target)
  const current = useRef(target)
  const sig = target.map((r) => r.map((v) => v.toFixed(1)).join(',')).join('|')
  useLayoutEffect(() => {
    const from = current.current
    if (sameSeries(from, target)) { current.current = target; setShown(target); return }
    if (reducedMotion() || from.length !== target.length) { current.current = target; setShown(target); return }
    const frame = (p: number) => {
      const next = p >= 1 ? target : target.map((row, j) => lerpSeries(from[j], row, p))
      current.current = next
      setShown(next)
    }
    frame(0)
    return tween({ duration: DUR.change, onFrame: frame })
    // sig stands for target's contents
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig])
  return shown.length === target.length && shown.every((r, j) => r.length === target[j].length) ? shown : target
}

function useClipId() {
  return `clip${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`
}

const path = (xs: readonly number[], ys: readonly number[]) => xs.map((x, i) => `${i ? 'L' : 'M'}${x.toFixed(1)},${ys[i].toFixed(1)}`).join(' ')

function anchor(x: number, lo: number, hi: number): 'start' | 'middle' | 'end' {
  return x - lo < 24 ? 'start' : hi - x < 24 ? 'end' : 'middle'
}

function tickLabel(t: number) {
  return (t + DAY_OFFSET) % 86400 === 0 ? day(t) : clock(t).slice(0, 5)
}

function Tip({ x, width, children }: { x: number; width: number; children: ReactNode }) {
  const W = 200
  const left = x + 14 + W > width ? Math.max(0, x - 14 - W) : x + 14
  return <div className="viz-tip" style={{ left: 0, transform: `translateX(${left}px)` }} aria-hidden="true">{children}</div>
}

function TipRow({ slot, label, value }: { slot?: Slot; label: string; value: string }) {
  return (
    <p className="viz-tip-row">
      {slot ? <span className={`viz-key c${slot}`} aria-hidden="true" /> : <span className="viz-key is-none" aria-hidden="true" />}
      <strong className="nums">{value}</strong>
      <span>{label}</span>
    </p>
  )
}

function useIndex(n: number) {
  const [active, setActive] = useState<number | null>(null)
  const onKey = (e: KeyboardEvent) => {
    const cur = active ?? n - 1
    let next: number | null = null
    if (e.key === 'ArrowRight') next = Math.min(n - 1, cur + 1)
    else if (e.key === 'ArrowLeft') next = Math.max(0, cur - 1)
    else if (e.key === 'Home') next = 0
    else if (e.key === 'End') next = n - 1
    else if (e.key === 'Escape') { setActive(null); return }
    if (next !== null) { e.preventDefault(); setActive(next) }
  }
  return { active, setActive, onKey }
}

function nearest(ts: readonly number[], t: number) {
  let best = 0
  for (let i = 1; i < ts.length; i++) if (Math.abs(ts[i] - t) < Math.abs(ts[best] - t)) best = i
  return best
}

export type AreaSeries = { key: string; label: string; slot: Slot }

export function StackedAreaChart({ points, changes, series, label, height = 240 }: {
  points: HoldingPoint[]
  changes: HoldingPoint[]
  series: AreaSeries[]
  label: string
  height?: number
}) {
  const [wrap, w] = useWidth<HTMLDivElement>(720)
  const [table, setTable] = useState(false)
  const { active, setActive, onKey } = useIndex(points.length)
  const tableId = useId()
  const wide = w >= 560
  const pad = { l: 48, r: wide ? 92 : 8, t: 8, b: 28 }
  const t0 = points[0].t
  const t1 = Math.max(points[points.length - 1].t, t0 + 1)
  const cum = points.map((p) => series.reduce<number[]>((acc, s) => [...acc, (acc[acc.length - 1] ?? 0) + (p.values[s.key] ?? 0)], []))
  const total = (i: number) => cum[i][cum[i].length - 1]
  const yTicks = niceTicks(Math.max(1, ...cum.map((c) => c[c.length - 1])), 5)
  const hi = yTicks[yTicks.length - 1]
  const x = (t: number) => pad.l + ((t - t0) / (t1 - t0)) * (w - pad.l - pad.r)
  const y = (v: number) => pad.t + (1 - v / hi) * (height - pad.t - pad.b)
  const xTicks = timeTicks(t0, t1, Math.max(3, Math.floor((w - pad.l - pad.r) / 90)))
  const xs = points.map((p) => x(p.t))
  const ys = useMorph(series.map((_, j) => points.map((_, i) => y(cum[i][j]))))
  const floor = xs.map(() => y(0))
  const line = (j: number) => path(xs, ys[j])
  const band = (j: number) => {
    const below = j ? ys[j - 1] : floor
    const bottom = xs.map((_, k) => { const i = xs.length - 1 - k; return `L${xs[i].toFixed(1)},${below[i].toFixed(1)}` }).join(' ')
    return `${path(xs, ys[j])} ${bottom} Z`
  }
  const clip = useClipId()
  const last = points.length - 1
  const at = active === null ? null : active
  const pick = (e: PointerEvent<SVGSVGElement>) => {
    const box = e.currentTarget.getBoundingClientRect()
    const t = t0 + ((e.clientX - box.left - pad.l) / (w - pad.l - pad.r)) * (t1 - t0)
    setActive(nearest(points.map((p) => p.t), t))
  }
  const summary = `${label}. ${series.map((s) => `${s.label} ${money(points[0].values[s.key] ?? 0)} to ${money(points[last].values[s.key] ?? 0)}`).join(', ')}, between ${stamp(t0)} and ${stamp(points[last].t)}.`

  return (
    <figure className="viz" data-ui>
      <figcaption className="viz-head">
        <ul className="viz-legend">
          {series.map((s) => (
            <li key={s.key}><span className={`viz-swatch c${s.slot}`} aria-hidden="true" />{s.label}<strong className="nums"><CountText text={money(points[last].values[s.key] ?? 0)} fromZero={false} /></strong></li>
          ))}
        </ul>
        <button type="button" className="viz-toggle" aria-expanded={table} aria-controls={tableId} onClick={() => setTable((v) => !v)}>{table ? 'Chart' : 'Table'}</button>
      </figcaption>
      {table ? (
        <div className="viz-table" id={tableId}>
          <table className="dt-table">
            <caption className="sr-only">{label}, one row per execution</caption>
            <thead><tr><th scope="col">Time</th>{series.map((s) => <th key={s.key} scope="col" className="r">{s.label}</th>)}<th scope="col" className="r">Total</th></tr></thead>
            <tbody>
              {changes.map((p) => (
                <tr key={p.t}><td className="nums nowrap">{stamp(p.t)}</td>{series.map((s) => <td key={s.key} className="r nums">{money(p.values[s.key] ?? 0)}</td>)}<td className="r nums">{money(series.reduce((a, s) => a + (p.values[s.key] ?? 0), 0))}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="viz-plot" ref={wrap} id={tableId} tabIndex={0} role="group" aria-roledescription="chart" aria-label={`${summary} Use the arrow keys to read each point.`}
          onKeyDown={onKey} onFocus={() => setActive((a) => a ?? last)} onBlur={() => setActive(null)}>
          <svg width={w} height={height} viewBox={`0 0 ${w} ${height}`} aria-hidden="true" focusable="false" onPointerMove={pick} onPointerLeave={() => setActive(null)}>
            {yTicks.map((v) => (
              <g key={v}>
                <line x1={pad.l} x2={w - pad.r} y1={y(v)} y2={y(v)} className={v === 0 ? 'viz-base' : 'viz-grid'} />
                <text x={pad.l - 8} y={y(v) + 4} textAnchor="end" className="viz-tick">{v === 0 ? '0' : compact(v)}</text>
              </g>
            ))}
            {xTicks.map((t) => <text key={t} x={x(t)} y={height - 8} textAnchor={anchor(x(t), pad.l, w - pad.r)} className="viz-tick">{tickLabel(t)}</text>)}
            <clipPath id={clip}><rect className="viz-reveal" x={0} y={0} width={w} height={height} /></clipPath>
            <g clipPath={`url(#${clip})`}>
              {series.map((s, j) => <path key={`f-${s.key}`} d={band(j)} className={`viz-fill c${s.slot}`} />)}
              {/* drawn top band first, so where an upper band is empty the edge shows the series that holds the value */}
              {series.map((s, j) => ({ s, j })).reverse().map(({ s, j }) => <path key={`l-${s.key}`} d={line(j)} className={`viz-line c${s.slot}`} />)}
            </g>
            {wide ? series.map((s, j) => {
              const lo = y(j ? cum[last][j - 1] : 0)
              const top = y(cum[last][j])
              return lo - top >= 14 ? <text key={`d-${s.key}`} x={w - pad.r + 8} y={(lo + top) / 2 + 4} className="viz-direct">{s.label}</text> : null
            }) : null}
            {at !== null ? (
              <g className="viz-hover" style={{ transform: `translateX(${x(points[at].t)}px)` }}>
                <line x1={0} x2={0} y1={pad.t} y2={height - pad.b} className="viz-cross" />
                {series.map((s, j) => <circle key={s.key} cx={0} cy={0} r={4} className={`viz-dot c${s.slot}`} style={{ transform: `translateY(${y(cum[at][j])}px)` }} />)}
              </g>
            ) : null}
          </svg>
          {at !== null ? (
            <Tip x={x(points[at].t)} width={w}>
              <p className="viz-tip-time nums">{stamp(points[at].t)}</p>
              {[...series].reverse().map((s) => <TipRow key={s.key} slot={s.slot} label={s.label} value={money(points[at].values[s.key] ?? 0)} />)}
              <TipRow label="Total" value={money(total(at))} />
            </Tip>
          ) : null}
          <p className="sr-only" aria-live="polite">{at !== null ? `${stamp(points[at].t)}: ${series.map((s) => `${s.label} ${money(points[at].values[s.key] ?? 0)}`).join(', ')}, total ${money(total(at))}.` : ''}</p>
        </div>
      )}
    </figure>
  )
}

export function Sparkline({ values, label }: { values: number[]; label?: string }) {
  const [wrap, w] = useWidth<HTMLSpanElement>(160)
  const H = 32
  const lo = Math.min(...values)
  const hi = Math.max(...values)
  const span = hi - lo || 1
  const x = (i: number) => 4 + (i / Math.max(1, values.length - 1)) * (w - 8)
  const y = (v: number) => H - 5 - ((v - lo) / span) * (H - 10)
  const [ys] = useMorph([values.map(y)])
  if (values.length < 2) return null
  const d = path(values.map((_, i) => x(i)), ys)
  const end = values.length - 1
  return (
    <span className="spark" ref={wrap} role={label ? 'img' : undefined} aria-label={label} aria-hidden={label ? undefined : true}>
      <svg width={w} height={H} viewBox={`0 0 ${w} ${H}`} aria-hidden="true" focusable="false">
        <path d={d} className="spark-line" pathLength={1} />
        <circle cx={x(end)} cy={ys[end]} r={4} className="spark-end" />
      </svg>
    </span>
  )
}

export function Meter({ value, max, label, tone }: { value: number; max: number; label: string; tone?: 'warn' | 'bad' }) {
  const share = max > 0 ? Math.min(1, Math.max(0, value / max)) : 0
  return (
    <span className={`meter${tone ? ` is-${tone}` : ''}`} role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={max} aria-valuenow={value}>
      <span className="meter-fill" style={{ transform: `scaleX(${share})` }} />
    </span>
  )
}

export function OracleChart({ history, price, stale }: { history: { t: number; price: number }[]; price: number; stale: boolean }) {
  const [wrap, w] = useWidth<HTMLDivElement>(720)
  const pts = history.length ? history : [{ t: 0, price }]
  const { active, setActive, onKey } = useIndex(pts.length)
  const height = 220
  const pad = { l: 52, r: 12, t: 10, b: 28 }
  const t0 = pts[0].t
  const t1 = Math.max(pts[pts.length - 1].t, t0 + 1)
  const lo = Math.min(0.98, ...pts.map((p) => p.price))
  const hi = Math.max(1.02, ...pts.map((p) => p.price))
  const x = (t: number) => pad.l + ((t - t0) / (t1 - t0)) * (w - pad.l - pad.r)
  const y = (p: number) => pad.t + (1 - (p - lo) / (hi - lo)) * (height - pad.t - pad.b)
  const xs = pts.map((p) => x(p.t))
  const [ys] = useMorph([pts.map((p) => y(p.price))])
  const d = path(xs, ys)
  const clip = useClipId()
  const last = pts[pts.length - 1]
  const yTicks = [0.98, 0.99, 1.0, 1.01, 1.02].filter((v) => v >= lo && v <= hi)
  const xTicks = timeTicks(t0, t1, Math.max(3, Math.floor((w - pad.l - pad.r) / 90)))
  const at = active === null ? null : pts[active]
  const pick = (e: PointerEvent<SVGSVGElement>) => {
    const box = e.currentTarget.getBoundingClientRect()
    setActive(nearest(pts.map((p) => p.t), t0 + ((e.clientX - box.left - pad.l) / (w - pad.l - pad.r)) * (t1 - t0)))
  }
  const zoneW = w - pad.l - pad.r
  return (
    <figure className="viz" data-ui>
      <div className="viz-plot" ref={wrap} tabIndex={0} role="group" aria-roledescription="chart"
        aria-label={`Oracle price over the last ${Math.round((t1 - t0) / 60)} minutes, now ${price.toFixed(4)}${stale ? ', stale' : ''}. Exit zones below 0.9900 and above 1.0100. Use the arrow keys to read each point.`}
        onKeyDown={onKey} onFocus={() => setActive((a) => a ?? pts.length - 1)} onBlur={() => setActive(null)}>
        <svg width={w} height={height} viewBox={`0 0 ${w} ${height}`} aria-hidden="true" focusable="false" onPointerMove={pick} onPointerLeave={() => setActive(null)}>
          <rect x={pad.l} y={pad.t} width={zoneW} height={Math.max(0, y(1.01) - pad.t)} className="viz-zone" />
          <rect x={pad.l} y={y(0.99)} width={zoneW} height={Math.max(0, height - pad.b - y(0.99))} className="viz-zone" />
          {yTicks.map((v) => (
            <g key={v}>
              <line x1={pad.l} x2={w - pad.r} y1={y(v)} y2={y(v)} className={v === 1 ? 'viz-base' : 'viz-grid'} />
              <text x={pad.l - 8} y={y(v) + 4} textAnchor="end" className="viz-tick">{v.toFixed(2)}</text>
            </g>
          ))}
          <g className="viz-zone-label" transform={`translate(${pad.l + 8} ${y(0.99) + 8})`}>
            <path d="M6 0l6 11H0z" className="viz-zone-icon" />
            <text x={18} y={10}>Exit zone</text>
          </g>
          {xTicks.map((t) => <text key={t} x={x(t)} y={height - 8} textAnchor={anchor(x(t), pad.l, w - pad.r)} className="viz-tick">{clock(t).slice(0, 5)}</text>)}
          <clipPath id={clip}><rect className="viz-reveal" x={0} y={0} width={w} height={height} /></clipPath>
          <path d={d} className={`viz-line c1${stale ? ' is-stale' : ''}`} clipPath={`url(#${clip})`} />
          <circle cx={x(last.t)} cy={ys[ys.length - 1]} r={4} className="viz-dot viz-end c1" />
          {at ? (
            <g className="viz-hover" style={{ transform: `translateX(${x(at.t)}px)` }}>
              <line x1={0} x2={0} y1={pad.t} y2={height - pad.b} className="viz-cross" />
              <circle cx={0} cy={0} r={4} className="viz-dot c1" style={{ transform: `translateY(${y(at.price)}px)` }} />
            </g>
          ) : null}
        </svg>
        {at ? (
          <Tip x={x(at.t)} width={w}>
            <p className="viz-tip-time nums">{stamp(at.t)}</p>
            <TipRow slot={1} label="Price" value={at.price.toFixed(4)} />
          </Tip>
        ) : null}
        <p className="sr-only" aria-live="polite">{at ? `${stamp(at.t)}: price ${at.price.toFixed(4)}.` : ''}</p>
      </div>
    </figure>
  )
}

export type BarSeries = { key: string; label: string; slot: Slot; values: Record<string, number> }

export function GroupedBars({ categories, series, label }: { categories: { key: string; label: string }[]; series: BarSeries[]; label: string }) {
  const [wrap, w] = useWidth<HTMLDivElement>(640)
  const [active, setActive] = useState<string | null>(null)
  const bar = 12
  const gap = 2
  const group = series.length * bar + (series.length - 1) * gap
  const rowH = group + 20
  const pad = { l: 104, r: 48, t: 4, b: 24 }
  const height = pad.t + categories.length * rowH + pad.b
  const x = (v: number) => pad.l + Math.max(0, Math.min(1, v)) * (w - pad.l - pad.r)
  const rowTop = (i: number) => pad.t + i * rowH + 10
  const end = (x0: number, x1: number, yy: number) => {
    const len = Math.max(0, x1 - x0)
    const r = Math.min(4, len, bar / 2)
    return `M${x0},${yy} H${x0 + len - r} Q${x0 + len},${yy} ${x0 + len},${yy + r} V${yy + bar - r} Q${x0 + len},${yy + bar} ${x0 + len - r},${yy + bar} H${x0} Z`
  }
  const cur = categories.findIndex((c) => c.key === active)
  return (
    <figure className="viz" data-ui>
      <figcaption className="viz-head">
        <ul className="viz-legend">
          {series.map((s) => <li key={s.key}><span className={`viz-swatch c${s.slot}`} aria-hidden="true" />{s.label}</li>)}
        </ul>
      </figcaption>
      <div className="viz-plot" ref={wrap} role="group" aria-label={label}>
        <svg width={w} height={height} viewBox={`0 0 ${w} ${height}`} aria-hidden="true" focusable="false">
          {[0, 0.25, 0.5, 0.75, 1].map((v) => (
            <g key={v}>
              <line x1={x(v)} x2={x(v)} y1={pad.t} y2={height - pad.b} className={v === 0 ? 'viz-base' : 'viz-grid'} />
              <text x={x(v)} y={height - 6} textAnchor="middle" className="viz-tick">{pct(v)}</text>
            </g>
          ))}
          {categories.map((c, i) => (
            <g key={c.key} className={active === c.key ? 'is-on' : undefined}>
              <text x={pad.l - 10} y={rowTop(i) + group / 2 + 4} textAnchor="end" className="viz-cat">{c.label}</text>
              {series.map((s, k) => {
                const yy = rowTop(i) + k * (bar + gap)
                const v = s.values[c.key] ?? 0
                return (
                  <g key={s.key} style={{ '--i': i * series.length + k } as CSSProperties}>
                    <path d={end(x(0), x(v), yy)} className={`viz-bar c${s.slot}`} />
                    <text x={x(v) + 6} y={yy + bar - 2} className="viz-value">{pct(v)}</text>
                  </g>
                )
              })}
            </g>
          ))}
        </svg>
        {categories.map((c, i) => (
          <span key={c.key} className="viz-hit" role="img" tabIndex={0} style={{ top: rowTop(i) - 6, height: group + 12, left: 0, width: w }}
            aria-label={`${c.label}: ${series.map((s) => `${s.label} ${pct(s.values[c.key] ?? 0)}`).join(', ')}`}
            onPointerEnter={() => setActive(c.key)} onPointerLeave={() => setActive(null)} onFocus={() => setActive(c.key)} onBlur={() => setActive(null)} />
        ))}
        {cur >= 0 ? (
          <div className="viz-tip" style={{ left: Math.min(w - 200, x(Math.max(...series.map((s) => s.values[categories[cur].key] ?? 0))) + 44), top: rowTop(cur) - 4 }} aria-hidden="true">
            <p className="viz-tip-time">{categories[cur].label}</p>
            {series.map((s) => <TipRow key={s.key} slot={s.slot} label={s.label} value={pct(s.values[categories[cur].key] ?? 0)} />)}
          </div>
        ) : null}
      </div>
    </figure>
  )
}
