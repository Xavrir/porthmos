import { useEffect, useId, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { useAegis } from '../lib/source'
import { explorerAddress, explorerTx } from '../lib/wallet'
import { shortHex } from '../lib/format'
import { isRecordedTx } from '../replay/hashes'
import { CountText } from './Count'
import { CopyButton } from './Drawer'
import { Meter, Sparkline } from './charts'
import { Icon, type IconName } from './icons'
import { Term } from './Glossary'
import { ERRORS, sentenceCase, stateVerdict, TIER_SHORT, TIERS, isErrorName } from '../lib/vocabulary'
import type { ErrorName, Tier, WorkflowState } from '../lib/types'

export type Tone = 'ok' | 'held' | 'wait' | 'frozen' | 'refused' | 'info' | 'neutral'

export function stateTone(state: string): Tone {
  switch (state) {
    case 'CONFIRMED': case 'APPROVED': case 'DAR_SIGNED':
      return 'ok'
    case 'SUBMITTED': case 'FINAL_REVALIDATION': case 'AWAITING_APPROVAL': case 'NEEDS_CLARIFICATION': case 'CORRECTION_REQUESTED':
      return 'wait'
    case 'HELD': case 'APPROVAL_EXPIRED': case 'QUARANTINED': case 'CANCELLED':
      return 'held'
    case 'REVERTED': case 'POLICY_REJECTED': case 'SIM_FAILED': case 'APPROVAL_DENIED':
      return 'refused'
    case 'POLICY_CHANGED':
      return 'info'
    default:
      return 'neutral'
  }
}

const TONE_ICON: Partial<Record<Tone, IconName>> = { ok: 'check', held: 'clock', wait: 'clock', frozen: 'lock', refused: 'stop', info: 'info' }

export function Chip({ state, tone, children }: { state: string; tone?: Tone; children?: ReactNode }) {
  const verdict = stateVerdict(state)
  const label = children ?? sentenceCase(state as WorkflowState)
  const t = tone ?? stateTone(state)
  const icon = TONE_ICON[t]
  return <span className={`chip v-${verdict} tone-${t}`}>{icon ? <Icon name={icon} className="chip-icon" /> : null}{label}</span>
}

export function TierMark({ tier, short = false }: { tier: Tier | undefined; short?: boolean }) {
  if (tier === undefined) return null
  return (
    <span className="tier-wrap">
      <Term className="term-tier" def={`Tier ${tier}, ${TIERS[tier].name.toLowerCase()}: ${TIERS[tier].when.charAt(0).toLowerCase()}${TIERS[tier].when.slice(1)}. Signed by ${TIERS[tier].signers.toLowerCase()}.`}>
        <span className={`tier t${tier}`}>T{tier}</span>
      </Term>
      {short ? <span className="tier-short">{TIER_SHORT[tier]}</span> : null}
    </span>
  )
}

export function ErrorTag({ name, short = true }: { name: string | undefined; short?: boolean }) {
  if (!name) return null
  if (!isErrorName(name)) return <span className="err"><code>{name}</code></span>
  const e = ERRORS[name as ErrorName]
  return (
    <span className="err">
      <Term def={e.plain}><code>{name}</code></Term>
      {short ? <>{' '}<span className="err-short">{e.short}</span></> : null}
    </span>
  )
}

export function Hash({ value, kind = 'tx', head = 6, tail = 4, label }: { value: string | undefined | null; kind?: 'tx' | 'address' | 'plain'; head?: number; tail?: number; label?: string }) {
  const { chainId, mode } = useAegis()
  if (!value || (kind === 'tx' && mode === 'replay' && !isRecordedTx(value))) return <span className="muted">None</span>
  const href = kind === 'tx' ? explorerTx(chainId, value) : kind === 'address' ? explorerAddress(chainId, value) : undefined
  return (
    <span className="hash">
      {href ? (
        <a href={href} target="_blank" rel="noreferrer" className="link-plain">
          <code>{shortHex(value, head, tail)}</code><span className="sr-only">, {label ?? 'value'} on the block explorer</span>
        </a>
      ) : (
        <code title={value}>{shortHex(value, head, tail)}</code>
      )}
      <CopyButton value={value} label={`${label ?? 'value'} ${value}`} />
    </span>
  )
}

export type Trend = { text: string; dir: 'up' | 'down' | 'flat'; good?: boolean }

export function InfoTip({ label, children }: { label: string; children: ReactNode }) {
  const [open, setOpen] = useState(false)
  const [style, setStyle] = useState<CSSProperties>({})
  const btn = useRef<HTMLButtonElement>(null)
  const id = useId()
  useEffect(() => {
    if (!open) return
    const r = btn.current?.getBoundingClientRect()
    if (r) {
      const width = Math.min(320, window.innerWidth - 16)
      setStyle({ top: r.bottom + 6, left: Math.max(8, Math.min(r.left - 12, window.innerWidth - width - 8)), width })
    }
    const close = () => setOpen(false)
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close() }
    window.addEventListener('scroll', close, { passive: true, capture: true })
    document.addEventListener('keydown', onKey)
    return () => { window.removeEventListener('scroll', close, { capture: true }); document.removeEventListener('keydown', onKey) }
  }, [open])
  return (
    <span className="tip" onPointerEnter={() => setOpen(true)} onPointerLeave={() => setOpen(false)}>
      <button type="button" ref={btn} className="tip-button" aria-label={label} aria-expanded={open} aria-describedby={id}
        onClick={() => setOpen((o) => !o)} onFocus={() => setOpen(true)} onBlur={() => setOpen(false)}>
        <Icon name="info" />
      </button>
      <span role="tooltip" id={id} className="tip-pop" hidden={!open} style={style}>{children}</span>
    </span>
  )
}

export function Figure({ label, value, note, tone, spark, sparkLabel, trend, meter, info }: {
  label: string
  value: ReactNode
  note?: ReactNode
  tone?: 'alert'
  spark?: number[]
  sparkLabel?: string
  trend?: Trend
  meter?: { value: number; max: number; label: string; tone?: 'warn' | 'bad' }
  info?: ReactNode
}) {
  const pending = value === '…'
  return (
    <div className={`kpi${tone === 'alert' ? ' is-alert' : ''}`}>
      <span className="kpi-label">{label}{info ? <InfoTip label={`About ${label.toLowerCase()}`}>{info}</InfoTip> : null}</span>
      <span className="kpi-row">
        <span className="kpi-value">{pending ? <span className="sk sk-value" aria-label="Loading" role="img" /> : typeof value === 'string' ? <CountText text={value} /> : value}</span>
        {trend ? (
          <span className={`trend trend-${trend.dir}${trend.good === false ? ' is-bad' : ''}`}>
            {trend.dir !== 'flat' ? <Icon name={trend.dir} /> : null}<span className="nums">{trend.text}</span>
          </span>
        ) : null}
      </span>
      {spark && spark.length > 1 ? <Sparkline values={spark} label={sparkLabel} /> : null}
      {meter ? <Meter {...meter} /> : null}
      {note ? <span className="kpi-note">{tone === 'alert' ? <Icon name="alert" className="kpi-note-icon" /> : null}{note}</span> : null}
    </div>
  )
}

export function Kpis({ children, label }: { children: ReactNode; label: string }) {
  return <section className="kpis" aria-label={label}>{children}</section>
}

export function PageHeader({ title, subtitle, info, actions }: { title: ReactNode; subtitle?: ReactNode; info?: ReactNode; actions?: ReactNode }) {
  return (
    <header className="page-head">
      <div className="page-head-text">
        <h1>{title}{info ? <InfoTip label="About this page">{info}</InfoTip> : null}</h1>
        {subtitle ? <p className="page-sub">{subtitle}</p> : null}
      </div>
      {actions ? <div className="page-actions">{actions}</div> : null}
    </header>
  )
}

export function Section({ title, info, actions, children, className, id }: { title: ReactNode; info?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string; id?: string }) {
  const hid = useId()
  return (
    <section className={`sec${className ? ` ${className}` : ''}`} aria-labelledby={hid} id={id}>
      <header className="sec-head">
        <h2 id={hid}>{title}</h2>
        {info ? <InfoTip label={`About ${typeof title === 'string' ? title.toLowerCase() : 'this section'}`}>{info}</InfoTip> : null}
        {actions ? <div className="sec-actions">{actions}</div> : null}
      </header>
      {children}
    </section>
  )
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="empty-state"><span className="empty-mark" aria-hidden="true" /><p>{children}</p></div>
}

export function Loading({ what, rows = 3 }: { what: string; rows?: number }) {
  return (
    <div className="skeleton" aria-live="polite" aria-busy="true">
      <span className="sr-only">Loading {what}…</span>
      {Array.from({ length: rows }, (_, i) => <span key={i} className="sk sk-line" aria-hidden="true" />)}
    </div>
  )
}

export function ErrorNote({ error }: { error: unknown }) {
  if (!error) return null
  return <p className="error-note" role="alert">{(error as Error).message ?? String(error)}</p>
}
