import { useEffect, useId, useState } from 'react'
import { TierMark } from './bits'
import { stamp } from '../lib/format'
import { confirmStatus, countdown, proposalText, STATUS_TEXT, type ConfirmChoice } from '../lib/confirm'
import type { PendingConfirmation } from '../lib/types'

function useNow(active: boolean): number {
  const [now, setNow] = useState(() => Date.now() / 1000)
  useEffect(() => {
    if (!active) return
    setNow(Date.now() / 1000)
    const t = setInterval(() => setNow(Date.now() / 1000), 1000)
    return () => clearInterval(t)
  }, [active])
  return now
}

export function ConfirmCard({ pending, latest, used, busy, now, onChoose }: {
  pending: PendingConfirmation
  latest: boolean
  used?: ConfirmChoice
  busy: boolean
  now?: number
  onChoose(choice: ConfirmChoice): void
}) {
  const id = useId()
  const ticking = now === undefined && latest && !used && pending.expiresAt !== undefined
  const tick = useNow(ticking)
  const t = now ?? tick
  const status = confirmStatus(pending, { used, latest, now: t })
  const open = status === 'open'
  const disabled = !open || busy
  return (
    <div className={`confirm-card is-${status}`} role="group" aria-labelledby={`${id}-what`} aria-describedby={`${id}-state`}>
      <p className="confirm-kicker">Needs your confirmation</p>
      <p className="confirm-what" id={`${id}-what`}>{proposalText(pending)}</p>
      <p className="confirm-meta">
        <TierMark tier={pending.tier} short />
        {open && pending.expiresAt !== undefined ? (
          <>
            <span className="confirm-timer nums" aria-hidden="true">Expires in {countdown(pending.expiresAt - t)}</span>
            <span className="sr-only">Expires {stamp(pending.expiresAt)}</span>
          </>
        ) : null}
      </p>
      <p className="confirm-state" id={`${id}-state`} aria-live="polite">
        {open ? (busy ? 'Waiting for the current reply…' : 'Nothing runs until you confirm.') : STATUS_TEXT[status]}
      </p>
      <div className="confirm-actions">
        <button type="button" className="button small" disabled={disabled} onClick={() => onChoose('confirm')}>Confirm</button>
        <button type="button" className="button small quiet" disabled={disabled} onClick={() => onChoose('cancel')}>Cancel</button>
      </div>
    </div>
  )
}
