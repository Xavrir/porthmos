import { useState, type ReactNode } from 'react'
import { useAegis } from '../lib/source'
import { explorerAddress, explorerTx } from '../lib/wallet'
import { shortHex } from '../lib/format'
import { isRecordedTx } from '../replay/hashes'
import { CountText } from './Count'
import { Term } from './Glossary'
import { ERRORS, sentenceCase, stateVerdict, TIER_SHORT, TIERS, isErrorName } from '../lib/vocabulary'
import type { ErrorName, Tier, WorkflowState } from '../lib/types'

export function Chip({ state, children }: { state: string; children?: ReactNode }) {
  const verdict = stateVerdict(state)
  const label = children ?? sentenceCase(state as WorkflowState)
  return <span className={`chip v-${verdict}`}>{label}</span>
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
  return (
    <div className={`figure${tone === 'alert' ? ' is-alert' : ''}`}>
      <span className="figure-label">{label}</span>
      <span className="figure-value nums">{typeof value === 'string' ? <CountText text={value} /> : value}</span>
      {note ? <span className="figure-note">{note}</span> : null}
    </div>
  )
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="empty">{children}</p>
}

export function Loading({ what }: { what: string }) {
  return <p className="empty" aria-live="polite">Loading {what}…</p>
}

export function ErrorNote({ error }: { error: unknown }) {
  if (!error) return null
  return <p className="error-note" role="alert">{(error as Error).message ?? String(error)}</p>
}
