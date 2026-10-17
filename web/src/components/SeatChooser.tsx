import { useEffect, useId, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { useAegis } from '../lib/source'
import { useIdentity, type Seat } from '../lib/identity'
import { useSeatPicker } from '../lib/seats'
import { chainName } from '../lib/wallet'
import { Dialog } from './Dialog'
import { SEATS, WalletSignIn } from './chrome'
import { SignConfirm } from './SignConfirm'
import type { Role } from '../lib/types'

const HOME: Record<Seat, string> = { owner: '/copilot', bank: '/bank', viewer: '/treasury' }
const APP_PATHS = ['/treasury', '/copilot', '/risk', '/audit', '/bank']

const TENANT_SEATS: { seat: Seat; name: string; what: string; none: string }[] = [
  { seat: 'owner', name: 'Owner seat', what: 'Your treasury: ask the agent, approve its deposits and set the reserve.', none: 'Needs your own treasury. Create one first, in about a minute.' },
  { seat: 'bank', name: 'Bank seat', what: 'Your treasury’s bank: freeze deposits, tighten limits and approve escalations. It cannot move funds.', none: 'Needs your own treasury. Create one first, in about a minute.' },
  { seat: 'viewer', name: 'Just look (replay)', what: 'A recorded run of the reference treasury, played in your browser. Nothing to sign.', none: 'A recorded run of the reference treasury, played in your browser. Nothing to sign.' },
]

export function SeatChooser() {
  const { mode, phase, chainId, tenant, wallet, onboard } = useAegis()
  const { seat, chooseSeat, chooseDemo, demoAvailable, chooser, identity, signedIn, session, sessionError, localAddress, signInLocal } = useIdentity()
  const { multi, pick } = useSeatPicker()
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const id = useId()
  const [wanted, setWanted] = useState<Role | null>(null)
  const [waiting, setWaiting] = useState<Role | null>(null)

  useEffect(() => {
    if (phase === 'ready' && seat === null && APP_PATHS.includes(pathname) && !chooser.open) chooser.show('visit')
    // only a route change or the seat decides whether to ask
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, seat, pathname])

  useEffect(() => {
    if (chooser.open) setWanted(chooser.wanted)
    else { setWanted(null); setWaiting(null) }
  }, [chooser.open, chooser.wanted])

  const done = (s: Seat) => {
    chooseSeat(s)
    chooser.hide()
    setWanted(null)
    setWaiting(null)
    if (chooser.intent === 'hero') navigate(HOME[s])
  }

  useEffect(() => {
    if (chooser.open && (wanted || waiting) && signedIn && identity.kind !== 'none' && identity.role) done(identity.role)
    // finishing depends only on a completed sign-in
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signedIn, identity])

  const close = () => {
    if (seat === null) chooseSeat('viewer')
    chooser.hide()
    setWanted(null)
  }

  const onPick = (s: Seat) => {
    if (!multi) {
      if (mode === 'replay' || s === 'viewer') done(s)
      else setWanted(s)
      return
    }
    const r = pick(s)
    if (r === 'done') { if (s === 'viewer') done('viewer'); else setWaiting(s as Role) }
    else if (r === 'start') chooser.hide()
    else setWanted(s as Role)
  }

  const lede = !multi
    ? mode === 'replay'
      ? 'You are about to see a recorded run in your browser. Pick who you are; switch at any time from the top bar. No wallet and no password.'
      : 'There is no password. Your wallet signs a one-line session message, and the PolicyRegistry says whether it is the owner or the bank of this Safe.'
    : tenant
      ? `Your treasury is live on ${chainName(chainId)}. Both of its keys are in this browser, so you can sit in either seat. Switch at any time from the top bar.`
      : wallet
        ? 'Your treasury setup is not finished. Finish it to use the owner and bank seats, or look at the recorded run.'
        : `You have no treasury in this browser yet. Create one on ${onboard ? chainName(onboard.chainId).replace(/ \(\d+\)$/, '') : 'Base Sepolia'} in about a minute, or look at the recorded run.`

  const seats = multi ? TENANT_SEATS.map((s) => ({ seat: s.seat, name: s.name, what: tenant ? s.what : s.none })) : SEATS

  return (
    <Dialog open={chooser.open} onClose={close} labelledBy={id} className="dialog-seats">
      <div className="dialog-body">
        <div className="dialog-head">
          <h2 id={id}>Choose a seat</h2>
          <button type="button" className="button small quiet" onClick={close}>Close</button>
        </div>
        <p className="seats-lede">{lede}</p>
        <div className="seats" role="list">
          {seats.map((s) => (
            <div role="listitem" key={s.seat} className={`seat seat-${s.seat}`}>
              <button type="button" className="seat-pick" aria-describedby={`${id}-${s.seat}`} aria-expanded={s.seat !== 'viewer' ? wanted === s.seat : undefined} onClick={() => onPick(s.seat)}>
                <span className="seat-name">{s.name}</span>
                <span className="seat-what" id={`${id}-${s.seat}`}>{s.what}</span>
              </button>
              {multi && waiting === s.seat ? (
                <div className="seat-signin" aria-live="polite">
                  <p>{session === 'error' ? sessionError : 'Signing in with the key in this browser…'}</p>
                </div>
              ) : null}
              {multi && wanted === s.seat ? (
                <div className="seat-signin">
                  {s.seat === 'owner' && wallet?.owner.type === 'injected' ? (
                    <WalletSignIn />
                  ) : localAddress(s.seat) ? (
                    <SignConfirm
                      role={s.seat}
                      address={localAddress(s.seat)!}
                      what="a one-line session message"
                      confirmLabel={`Sign in as ${s.seat === 'owner' ? 'owner' : 'bank'}`}
                      busy={waiting === s.seat}
                      onConfirm={() => { setWaiting(s.seat as Role); setWanted(null); signInLocal(s.seat as Role) }}
                      onCancel={() => setWanted(null)}
                    >
                      <pre className="sign-preview">{`AEGIS session\nrole: ${s.seat}\naddress: ${localAddress(s.seat)}\nchainId: ${chainId}\nissuedAt: the time you press Sign in`}</pre>
                      <p>It proves you hold the key. It costs nothing and moves nothing.</p>
                    </SignConfirm>
                  ) : null}
                  {demoAvailable ? (
                    <button type="button" className="button small quiet" onClick={() => { chooseDemo(s.seat as Role); done(s.seat) }}>Use the local {s.seat === 'owner' ? 'owner' : 'bank'} test key (reference treasury)</button>
                  ) : null}
                </div>
              ) : null}
              {!multi && mode === 'live' && wanted === s.seat ? (
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
        {multi && !tenant ? (
          <div className="seats-foot">
            <Link to="/signup" className="button" onClick={() => chooser.hide()}>{wallet ? 'Continue setup' : 'Create your treasury'}</Link>
          </div>
        ) : null}
      </div>
    </Dialog>
  )
}
