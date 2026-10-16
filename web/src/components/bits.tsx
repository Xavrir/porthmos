import { useState, type ReactNode } from 'react'
import { useAegis } from '../lib/source'
import { explorerAddress, explorerTx } from '../lib/wallet'
import { shortHex } from '../lib/format'
import { isRecordedTx } from '../replay/hashes'
import { CountText } from './Count'
import { Term } from './Glossary'
import { ERRORS, sentenceCase, stateVerdict, TIER_SHORT, TIERS, isErrorName } from '../lib/vocabulary'
import type { ErrorName, Tier, WorkflowState } from '../lib/types'

export type Tone = 'ok' | 'held' | 'wait' | 'frozen' | 'refused' | 'neutral'

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
      return 'frozen'
    default:
      return 'neutral'
  }
}

export function Chip({ state, tone, children }: { state: string; tone?: Tone; children?: ReactNode }) {
  const verdict = stateVerdict(state)
  const label = children ?? sentenceCase(state as WorkflowState)
  return <span className={`chip v-${verdict} tone-${tone ?? stateTone(state)}`}>{label}</span>
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
  const [copied, setCopied] = useState(false)
  if (!value) return <span className="muted">none</span>
  const illustrative = kind === 'tx' && mode === 'replay' && !isRecordedTx(value)
  const href = kind === 'tx' ? (illustrative ? undefined : explorerTx(chainId, value)) : kind === 'address' ? explorerAddress(chainId, value) : undefined
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value)
      setCopied(true)
      setTimeout(() => setCopied(false), 1200)
    } catch {
      setCopied(false)
    }
  }
  return (
    <span className="hash">
      {href ? (
        <a href={href} target="_blank" rel="noreferrer" className="link-plain">
          <code>{shortHex(value, head, tail)}</code><span className="sr-only">, {label ?? 'value'} on the block explorer</span>
        </a>
      ) : (
        <code title={value}>{shortHex(value, head, tail)}</code>
      )}
      {illustrative ? <span className="illustrative" title="Placeholder until the recorded transaction hash is swapped in">illustrative</span> : null}
      <button type="button" className="copy" onClick={copy} aria-label={`Copy ${label ?? 'value'} ${value}`}>
        {copied ? 'Copied' : 'Copy'}
      </button>
    </span>
  )
}

export function Figure({ label, value, note, tone }: { label: string; value: ReactNode; note?: ReactNode; tone?: 'alert' }) {
  const pending = value === '…'
  return (
    <div className={`kpi${tone === 'alert' ? ' is-alert' : ''}`}>
      <span className="kpi-label">{label}</span>
      <span className="kpi-value nums">{pending ? <span className="sk sk-value" aria-label="Loading" role="img" /> : typeof value === 'string' ? <CountText text={value} /> : value}</span>
      {note ? <span className="kpi-note">{note}</span> : null}
    </div>
  )
}

export function Kpis({ children, label }: { children: ReactNode; label: string }) {
  return <section className="kpis" aria-label={label}>{children}</section>
}

export function PageHeader({ title, description, meta, actions }: { title: ReactNode; description?: ReactNode; meta?: ReactNode; actions?: ReactNode }) {
  return (
    <header className="page-head">
      <div className="page-head-text">
        <h1>{title}</h1>
        {description ? <p className="page-desc">{description}</p> : null}
        {meta ? <div className="page-meta">{meta}</div> : null}
      </div>
      {actions ? <div className="page-actions">{actions}</div> : null}
    </header>
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
