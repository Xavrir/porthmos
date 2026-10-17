import { useEffect, useId, useRef, type ReactNode } from 'react'
import type { Address } from 'viem'
import type { Role } from '../lib/types'
import type { Prepared } from '../lib/identity'
import { useSiwePreview } from '../lib/useSiwePreview'

export function SignConfirm({ role, address, what, children, confirmLabel, busy, disabled, onConfirm, onCancel, cancelLabel = 'Cancel', tone, note, keyName }: {
  role: Role
  address: Address
  what: string
  children?: ReactNode
  confirmLabel: string
  busy?: boolean
  disabled?: boolean
  cancelLabel?: string
  onConfirm: () => void
  onCancel: () => void
  tone?: 'danger' | 'navy'
  note?: ReactNode
  keyName?: string
}) {
  const id = useId()
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => { ref.current?.focus() }, [])
  return (
    <div className="sign-confirm" role="group" aria-labelledby={id} tabIndex={-1} ref={ref}>
      <p className="sign-confirm-head" id={id}>
        <strong>You are signing {what}</strong> with {keyName ?? `your ${role === 'bank' ? 'bank' : 'owner'} key`} <code>{address.slice(0, 6)}…{address.slice(-4)}</code>.
      </p>
      {children}
      <p className="muted">{note ?? 'The key stays in this browser, so no wallet window opens. Test network only.'}</p>
      <div className="row-actions">
        <button type="button" className={`button small${tone === 'danger' ? ' danger' : tone === 'navy' || role === 'bank' ? ' navy' : ''}`} disabled={busy || disabled} onClick={onConfirm}>{busy ? 'Signing…' : confirmLabel}</button>
        <button type="button" className="button small quiet" disabled={busy} onClick={onCancel}>{cancelLabel}</button>
      </div>
    </div>
  )
}

// A browser-key sign-in: shows the exact Sign-In with Ethereum text, then hands that same text to the signer.
export function SiweConfirm({ role, address, busy, onConfirm, onCancel, children }: { role: Role; address: Address; busy?: boolean; onConfirm: (p: Prepared) => void; onCancel: () => void; children?: ReactNode }) {
  const { prepared, error, retry } = useSiwePreview(role, address, true)
  return (
    <SignConfirm role={role} address={address} what="this Sign-In with Ethereum message" confirmLabel={`Sign in as ${role === 'owner' ? 'owner' : 'bank'}`}
      busy={busy} disabled={!prepared} onCancel={onCancel} onConfirm={() => { if (prepared) onConfirm(prepared) }}>
      <pre className="sign-preview">{prepared?.message ?? error ?? 'Preparing the message…'}</pre>
      {error ? <button type="button" className="button small quiet" onClick={retry}>Try again</button> : null}
      {children ?? <p>It proves you hold the key. It costs nothing and moves nothing.</p>}
    </SignConfirm>
  )
}
