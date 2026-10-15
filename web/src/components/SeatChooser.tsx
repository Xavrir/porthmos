import { useEffect, useId, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useAegis } from '../lib/source'
import { useIdentity, type Seat } from '../lib/identity'
import { Dialog } from './Dialog'
import { SEATS, WalletSignIn } from './chrome'
import type { Role } from '../lib/types'

const HOME: Record<Seat, string> = { owner: '/copilot', bank: '/bank', viewer: '/treasury' }
const APP_PATHS = ['/treasury', '/copilot', '/risk', '/audit', '/bank']

export function SeatChooser() {
  const { mode, phase } = useAegis()
  const { seat, chooseSeat, chooseDemo, demoAvailable, chooser, identity, signedIn } = useIdentity()
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const id = useId()
  const [wanted, setWanted] = useState<Role | null>(null)

  useEffect(() => {
    if (phase === 'ready' && seat === null && APP_PATHS.includes(pathname) && !chooser.open) chooser.show('visit')
    // only a route change or the seat decides whether to ask
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, seat, pathname])

  const done = (s: Seat) => {
    chooseSeat(s)
    chooser.hide()
    setWanted(null)
    if (chooser.intent === 'hero') navigate(HOME[s])
  }

  useEffect(() => {
    if (chooser.open && wanted && signedIn && identity.kind !== 'none' && identity.role) done(identity.role)
    // finishing depends only on a completed sign-in
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signedIn, identity])

  const close = () => {
    if (seat === null) chooseSeat('viewer')
    chooser.hide()
    setWanted(null)
  }

  return (
    <Dialog open={chooser.open} onClose={close} labelledBy={id} className="dialog-seats">
      <div className="dialog-body">
        <div className="dialog-head">
          <h2 id={id}>Choose a seat</h2>
          <button type="button" className="button small quiet" onClick={close}>Close</button>
        </div>
        <p className="seats-lede">
          {mode === 'replay'
            ? 'You are about to see a recorded run in your browser. Pick who you are; switch at any time from the top bar. No wallet and no password.'
            : 'There is no password. Your wallet signs a one-line session message, and the PolicyRegistry says whether it is the owner or the bank of this Safe.'}
        </p>
        <div className="seats" role="list">
          {SEATS.map((s) => (
            <div role="listitem" key={s.seat} className={`seat seat-${s.seat}`}>
              <button
                type="button"
                className="seat-pick"
                aria-describedby={`${id}-${s.seat}`}
                onClick={() => {
                  if (mode === 'replay' || s.seat === 'viewer') done(s.seat)
                  else setWanted(s.seat)
                }}
              >
                <span className="seat-name">{s.name}</span>
                <span className="seat-what" id={`${id}-${s.seat}`}>{s.what}</span>
              </button>
              {mode === 'live' && wanted === s.seat ? (
                <div className="seat-signin">
                  <WalletSignIn />
                  {demoAvailable ? (
                    <button type="button" className="button small quiet" onClick={() => { chooseDemo(s.seat as Role); done(s.seat) }}>Use the local {s.seat === 'owner' ? 'owner' : 'bank'} test key</button>
                  ) : null}
                </div>
              ) : null}
            </div>
          ))}
        </div>
      </div>
    </Dialog>
  )
}
