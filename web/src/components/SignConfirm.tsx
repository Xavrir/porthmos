import { useEffect, useId, useRef, type ReactNode } from 'react'
import type { Address } from 'viem'
import type { Role } from '../lib/types'

export function SignConfirm({ role, address, what, children, confirmLabel, busy, onConfirm, onCancel, tone, note, keyName }: {
  role: Role
  address: Address
  what: string
  children?: ReactNode
  confirmLabel: string
  busy?: boolean
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
        <button type="button" className={`button small${tone === 'danger' ? ' danger' : tone === 'navy' || role === 'bank' ? ' navy' : ''}`} disabled={busy} onClick={onConfirm}>{busy ? 'Signing…' : confirmLabel}</button>
        <button type="button" className="button small quiet" disabled={busy} onClick={onCancel}>Cancel</button>
      </div>
    </div>
  )
}
