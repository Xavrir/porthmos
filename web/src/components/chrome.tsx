import { useEffect, useId, useLayoutEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom'
import { zeroAddress } from 'viem'
import { useConnect, useConnection, useConnectors, useDisconnect } from 'wagmi'
import { DEFAULT_LIVE_URL, useAegis } from '../lib/source'
import { useIdentity, type Seat } from '../lib/identity'
import { chainName } from '../lib/wallet'
import { shortHex } from '../lib/format'
import { RECORDED_SCENARIOS, SCHEDULED_SCENARIOS, scheduledAfter } from '../lib/proof'
import { Hash } from './bits'
import { Icon } from './icons'
import { useSeatPicker } from '../lib/seats'
import { useMarket } from '../lib/queries'
import { dismissToast, useToasts } from '../lib/toast'
import { openOverlay } from '../lib/ui'
import { CommandPalette, SearchField } from './CommandPalette'
import { GlossaryDialog, ShortcutsDialog, useGlobalShortcuts } from './Shortcuts'
import type { Role } from '../lib/types'

export const PAGES = [
  { to: '/treasury', label: 'Treasury', chapter: 'surface', icon: 'treasury', acts: 'owner', hint: 'Owner acts', group: 'Treasury' },
  { to: '/copilot', label: 'Copilot', chapter: 'blue', icon: 'copilot', acts: 'owner', hint: 'Owner acts', group: 'Treasury' },
  { to: '/risk', label: 'Risk', chapter: 'red', icon: 'risk', acts: null, hint: 'Every seat watches', group: 'Treasury' },
  { to: '/audit', label: 'Audit', chapter: 'black', icon: 'audit', acts: null, hint: 'Every seat reads', group: 'Treasury' },
  { to: '/bank', label: 'Bank desk', chapter: 'navy', icon: 'bank', acts: 'bank', hint: 'Home of the bank seat', group: 'Oversight' },
] as const

export const SEATS: { seat: Seat; name: string; what: string }[] = [
  { seat: 'owner', name: 'Business owner', what: 'Ask the agent, approve or deny its deposits, and set the reserve.' },
  { seat: 'bank', name: 'Bank risk officer', what: 'See every client, freeze deposits and approve escalations. Cannot move funds.' },
  { seat: 'viewer', name: 'Just look (read-only)', what: 'Browse the treasury, risk and audit trail. Nothing to sign.' },
]

export function usePageTitle(title: string | null) {
  useEffect(() => {
    document.title = title ? `${title} · Porthmos` : 'Porthmos'
  }, [title])
}

function usePopover() {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const onDoc = (e: PointerEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false) }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { setOpen(false); (ref.current?.querySelector('button') as HTMLButtonElement | null)?.focus() } }
    document.addEventListener('pointerdown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('pointerdown', onDoc); document.removeEventListener('keydown', onKey) }
  }, [open])
  return { open, setOpen, ref }
}

export function roleName(r: Role | null) {
  return r === 'owner' ? 'Owner' : r === 'bank' ? 'Bank officer' : 'Read-only'
}

function seatTarget(r: Role) {
  return r === 'owner' ? 'owner' : 'bank officer'
}

export function ModeIndicator() {
  const { mode, phase, reason, switchMode, streamStatus, chainId, apiBase, connect, forgetApi, demoChanged, resetDemo } = useAegis()
  const { open, setOpen, ref } = usePopover()
  const [url, setUrl] = useState(apiBase || DEFAULT_LIVE_URL)
  const id = useId()
  const urlId = useId()
  const after = scheduledAfter()
  const label = phase === 'probing' ? 'Connecting…' : mode === 'replay' ? 'Replay' : 'Live'
  const detail = phase === 'probing' ? '' : mode === 'replay' ? ' (recorded run)' : `, ${chainName(chainId)}`
  return (
    <div className={`mode mode-${phase === 'probing' ? 'probing' : mode}`} ref={ref}>
      <button type="button" className="mode-button" aria-expanded={open} aria-controls={id} onClick={() => setOpen((o) => !o)}>
        <span className="mode-mark" aria-hidden="true" />
        <span>{label}<span className="xl-only">{detail}</span></span>
      </button>
      {open ? (
        <div className="mode-panel" id={id} role="dialog" aria-label="Data source">
          {mode === 'replay' ? (
            <>
              <p><strong>Replay: a recorded run.</strong> It plays inside your browser: a 10,000 USDC treasury, a 4,500 reserve, two vaults, past attacks and a waiting approval. Contract and role addresses are the Base Sepolia deployment.</p>
              <p>On Base Sepolia now: {RECORDED_SCENARIOS.join(', ')} (linked to Basescan). {SCHEDULED_SCENARIOS.length ? `Scheduled: ${SCHEDULED_SCENARIOS.join(', ')}${after ? ` after ${after}` : ''}. ` : ''}Other hashes and all signatures are illustrative.</p>
              <div className="demo-state">
                <p>Demo state: <strong>{demoChanged ? 'changed by you' : 'recorded base run'}</strong>. It is kept until you close this tab.</p>
                {demoChanged ? <button type="button" className="button small quiet" onClick={() => { resetDemo(); setOpen(false) }}>Reset demo</button> : null}
              </div>
              {reason ? <p className="muted">{reason}.</p> : null}
              <form className="connect" onSubmit={(e) => { e.preventDefault(); connect(url); setOpen(false) }}>
                <label htmlFor={urlId}>Porthmos service address</label>
                <input id={urlId} className="field" type="url" inputMode="url" required value={url} onChange={(e) => setUrl(e.target.value)} />
                <button type="submit" className="button small">Connect live service</button>
              </form>
              <p className="muted">If it does not answer, the site stays in Replay. The service must allow this page’s origin (CORS) and the X-Aegis-Session header.</p>
            </>
          ) : (
            <>
              <p><strong>Live.</strong> Reading the Porthmos service at {apiBase || 'this site’s /api'} on {chainName(chainId)}. Event stream: {streamStatus}.</p>
              {reason ? <p className="muted">{reason}.</p> : null}
              <div className="row-actions">
                <button type="button" className="button small quiet" onClick={() => { switchMode('replay'); setOpen(false) }}>Switch to replay</button>
                {apiBase ? <button type="button" className="button small quiet" onClick={() => { forgetApi(); setOpen(false) }}>Forget this address</button> : null}
              </div>
            </>
          )}
        </div>
      ) : null}
    </div>
  )
}

function useSeatLabel(): { prefix: string; name: string; note: string } {
  const { identity, seat, signedIn, walletRole, session } = useIdentity()
  if (identity.kind === 'replay') return { prefix: 'Viewing as', name: roleName(identity.role), note: '' }
  if (identity.kind === 'local') {
    if (signedIn) return { prefix: 'Signed in as', name: roleName(identity.role), note: ' (key in this browser)' }
    return { prefix: session === 'pending' ? 'Signing in' : 'Seat', name: session === 'pending' ? roleName(identity.role) : 'Sign in', note: '' }
  }
  if (identity.kind === 'demo') return signedIn ? { prefix: 'Signed in as', name: roleName(identity.role), note: ' (local test key)' } : { prefix: 'Signing in', name: roleName(identity.role), note: '' }
  if (identity.kind === 'wallet') {
    if (signedIn) return { prefix: 'Signed in as', name: roleName(identity.role), note: '' }
    if (walletRole.status === 'loading') return { prefix: 'Wallet', name: 'Checking role…', note: '' }
    return { prefix: 'Wallet', name: identity.role ? 'Sign in' : 'Read-only', note: '' }
  }
  if (seat === 'viewer') return { prefix: 'Viewing as', name: 'Read-only', note: '' }
  return { prefix: '', name: 'Choose a seat', note: '' }
}

export function WalletSignIn({ onDone }: { onDone?: () => void }) {
  const { identity, signIn, signOut, signedIn, session, sessionError, walletRole } = useIdentity()
  const conn = useConnection()
  const connectors = useConnectors()
  const { mutate: connect, isPending, error: connectError } = useConnect()
  const { mutate: disconnect } = useDisconnect()
  const injected = connectors.find((c) => c.type === 'injected') ?? connectors[0]
  const [busy, setBusy] = useState(false)

  if (!conn.address) {
    return injected ? (
      <div className="wallet">
        <button type="button" className="button small secondary" disabled={isPending} onClick={() => connect({ connector: injected })}>
          {isPending ? 'Waiting for the wallet…' : 'Connect wallet'}
        </button>
        {connectError ? <p className="error-note" role="alert">{connectError.message.split('\n')[0]}</p> : null}
      </div>
    ) : <p className="muted">No browser wallet found. You can still look around read-only.</p>
  }
  const role = identity.kind === 'wallet' ? identity.role : null
  return (
    <div className="wallet">
      <p>Wallet <code>{shortHex(conn.address)}</code> on {chainName(conn.chainId)}.{' '}
        {walletRole.status === 'loading' ? 'Reading its role from the PolicyRegistry…' : role ? (walletRole.status === 'error' ? `The registry could not be read; the deployment file lists it as the ${seatTarget(role)}. The service checks the registry when you sign in.` : `The PolicyRegistry lists it as the ${seatTarget(role)} of this Safe.`) : 'This wallet holds no Porthmos role, so you can look around read-only.'}
      </p>
      {role && !signedIn ? (
        <button type="button" className="button small" disabled={busy || session === 'pending'} onClick={async () => { setBusy(true); try { await signIn(); onDone?.() } finally { setBusy(false) } }}>
          {busy || session === 'pending' ? 'Waiting for the signature…' : `Sign in as ${seatTarget(role)}`}
        </button>
      ) : null}
      {signedIn ? <button type="button" className="button small quiet" onClick={signOut}>Sign out</button> : null}
      <button type="button" className="button small quiet" onClick={() => { signOut(); disconnect() }}>Disconnect wallet</button>
      {role && !signedIn ? <p className="muted">Signing in signs a one-line session message (role, address, chain, time). It costs nothing and moves nothing.</p> : null}
      {sessionError ? <p className="error-note" role="alert">{sessionError}</p> : null}
    </div>
  )
}

function TenantSeats({ onDone }: { onDone: () => void }) {
  const { identity, signedIn, session, sessionError, signOut, localAddress, chooser } = useIdentity()
  const { mode } = useAegis()
  const { pick } = useSeatPicker()
  const current = mode === 'replay' ? 'viewer' : identity.kind === 'none' ? null : identity.role
  const choose = (s: Seat) => {
    const r = pick(s)
    if (r === 'confirm' || r === 'wallet') chooser.show('switch', s === 'viewer' ? null : s)
    onDone()
  }
  const keyOf = (r: Role) => localAddress(r)
  return (
    <fieldset className="seat-set">
      <legend>Your treasury</legend>
      <div className="seat-options" role="radiogroup" aria-label="Seat">
        {(['owner', 'bank', 'viewer'] as Seat[]).map((s) => (
          <button key={s} type="button" role="radio" aria-checked={current === s} className="seat-option" onClick={() => choose(s)}>
            <span className="seat-option-name">{s === 'owner' ? 'Owner seat' : s === 'bank' ? 'Bank seat' : 'Just look (replay)'}</span>
            <span className="seat-option-what">{s === 'viewer' ? 'The recorded run of the reference treasury.' : keyOf(s) ? <>Key <code>{shortHex(keyOf(s)!, 6, 4)}</code> in this browser.</> : 'Your browser wallet.'}</span>
          </button>
        ))}
      </div>
      {mode === 'live' ? <p className="session-line muted" aria-live="polite">Session: {session === 'ready' ? (signedIn ? 'signed' : 'open') : session === 'pending' ? 'opening…' : session === 'error' ? 'refused' : 'none'}</p> : null}
      {sessionError ? <p className="error-note" role="alert">{sessionError}</p> : null}
      {signedIn && identity.kind === 'local' ? <button type="button" className="button small quiet" onClick={() => { signOut(); onDone() }}>Sign out</button> : null}
    </fieldset>
  )
}

export function useTreasuryName() {
  const { mode, tenant } = useAegis()
  if (mode === 'replay') return 'Harbour Lane Imports'
  return tenant ? 'Your treasury' : 'Harbour Lane Imports'
}

function initials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join('')
}

export function IdentityControl({ variant = 'chip' }: { variant?: 'chip' | 'switcher' }) {
  const { identity, seat, demoAvailable, chooseDemo, chooseSeat, session, signedIn } = useIdentity()
  const { mode, tenant, service, onboard } = useAegis()
  const { open, setOpen, ref } = usePopover()
  const id = useId()
  const label = useSeatLabel()
  const name = useTreasuryName()
  const multi = service === 'up' && !!onboard

  return (
    <div className={`identity${variant === 'switcher' ? ' is-switcher' : ''}`} ref={ref}>
      {variant === 'switcher' ? (
        <button type="button" className="identity-button switcher-button" aria-expanded={open} aria-controls={id} onClick={() => setOpen((o) => !o)}>
          <span className="sw-avatar" aria-hidden="true">{initials(name)}</span>
          <span className="sw-text">
            <span className="sw-name">{name}</span>
            <span className="sw-sub">{label.prefix ? `${label.prefix} ` : ''}{label.name}{label.note}</span>
          </span>
          <Icon name="chevrons" className="identity-caret" />
        </button>
      ) : (
        <button type="button" className="identity-button" aria-expanded={open} aria-controls={id} onClick={() => setOpen((o) => !o)}>
          {label.prefix ? <span className="wide-only identity-prefix">{label.prefix}:</span> : null}
          <span className="identity-name"><span className="wide-only">{label.name}{label.note}</span><span className="narrow-only">{label.name === 'Bank officer' ? 'Bank' : label.name === 'Choose a seat' ? 'Seat' : label.name === 'Checking role…' ? 'Wallet' : label.name}</span></span>
          <span className="identity-caret" aria-hidden="true">▾</span>
        </button>
      )}
      {open ? (
        <div className="identity-panel" id={id} role="dialog" aria-label="Seat">
          {multi && tenant ? <TenantSeats onDone={() => setOpen(false)} /> : null}
          {multi && !tenant ? (
            <div className="seat-set">
              <p>You have no treasury in this browser yet.</p>
              <Link to="/start" className="button small" onClick={() => setOpen(false)}>Create your treasury</Link>
            </div>
          ) : null}
          {mode === 'replay' ? (
            <fieldset className="seat-set">
              <legend>View the recorded run as</legend>
              <div className="seat-options" role="radiogroup" aria-label="Recorded run seat">
                {SEATS.map((s) => (
                  <button key={s.seat} type="button" role="radio" aria-checked={seat === s.seat} className="seat-option" onClick={() => { chooseSeat(s.seat); setOpen(false) }}>
                    <span className="seat-option-name">{s.name}</span>
                    <span className="seat-option-what">{s.what}</span>
                  </button>
                ))}
              </div>
              {identity.kind === 'replay' && identity.address ? <p className="muted">Address shown for this seat: <code>{shortHex(identity.address, 6, 4)}</code> (the Base Sepolia {seatTarget(identity.role!)}). Replay holds no keys; approvals use the recorded signature or are marked simulated.</p> : null}
            </fieldset>
          ) : multi && tenant ? null : (
            <>
              <fieldset className="seat-set">
                <legend>{signedIn ? `Signed in as ${roleName(identity.kind === 'none' ? null : identity.role).toLowerCase()}` : 'Sign in with your wallet'}</legend>
                {identity.kind === 'demo' ? <p>Using the local test key for the {seatTarget(identity.role)}, <code>{shortHex(identity.address, 6, 4)}</code>.</p> : <WalletSignIn />}
              </fieldset>
              {identity.kind === 'none' ? <button type="button" className="button small quiet" onClick={() => { chooseSeat('viewer'); setOpen(false) }}>Just look (read-only)</button> : null}
              <p className="session-line muted" aria-live="polite">Session: {session === 'ready' ? (signedIn ? 'signed' : 'open') : session === 'pending' ? 'opening…' : session === 'error' ? 'refused' : 'none'}</p>
            </>
          )}
          {mode === 'live' && demoAvailable ? (
            <fieldset className="seat-set">
              <legend>Local test keys</legend>
              <p className="muted">Chain 31337 only. Public Anvil test accounts 1 (owner) and 2 (bank) of the reference treasury. Never use them elsewhere.</p>
              <div className="segmented" role="radiogroup" aria-label="Local test key">
                {(['owner', 'bank'] as Role[]).map((r) => (
                  <button key={r} type="button" role="radio" aria-checked={identity.kind === 'demo' && identity.role === r} onClick={() => chooseDemo(r)}>{roleName(r)}</button>
                ))}
                <button type="button" role="radio" aria-checked={identity.kind !== 'demo'} onClick={() => chooseDemo(null)}>Off</button>
              </div>
            </fieldset>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

export function SwitchSeat({ to, children, className = 'button small', then }: { to: Role; children?: ReactNode; className?: string; then?: string }) {
  const { mode, tenant } = useAegis()
  const { chooseSeat, chooseDemo, demoAvailable, chooser, confirmed, signInLocal, localAddress } = useIdentity()
  const navigate = useNavigate()
  const own = !!tenant && mode === 'live'
  const label = children ?? (own ? `Switch to the ${to === 'owner' ? 'owner' : 'bank'} seat` : mode === 'replay' ? `Switch to ${seatTarget(to)}` : demoAvailable ? `Use the local ${seatTarget(to)} test key` : `Sign in as the ${seatTarget(to)}`)
  const act = () => {
    if (own) {
      if (localAddress(to) && confirmed(to)) signInLocal(to)
      else { chooser.show('switch', to); return }
    } else if (mode === 'replay') chooseSeat(to)
    else if (demoAvailable) chooseDemo(to)
    else { chooser.show('switch', to); return }
    if (then) navigate(then)
  }
  return <button type="button" className={`${className}${to === 'bank' ? ' navy' : ''}`} onClick={act}>{label}</button>
}

export function ModeBanner() {
  const { mode, phase, service, onboard, tenant, wallet, refresh, apiBase } = useAegis()
  const { chooser } = useIdentity()
  if (phase !== 'ready' || mode !== 'replay') return null
  const net = onboard ? chainName(onboard.chainId).replace(/ \(\d+\)$/, '') : 'Base Sepolia'
  const multi = service === 'up' && !!onboard
  let text: ReactNode
  let action: ReactNode = null
  if (multi && tenant) {
    text = 'You are looking at the recorded run. Your own treasury is live.'
    action = <button type="button" className="button small" onClick={() => chooser.show('switch')}>Open my treasury</button>
  } else if (multi && wallet) {
    text = 'This is the recorded run. Your treasury setup is not finished.'
    action = <Link to="/start" className="button small">Continue setup</Link>
  } else if (multi) {
    text = `This is a recorded run of the reference treasury. Make your own on ${net} in about a minute.`
    action = <Link to="/start" className="button small">Create your treasury</Link>
  } else if (service === 'down') {
    text = <>The Porthmos service is not answering, so you see a recorded run.{wallet ? ' Your own treasury is still on-chain.' : ''}</>
    action = <button type="button" className="button small quiet" onClick={() => refresh(null)}>Try again</button>
  } else {
    text = apiBase ? 'Replay: a recorded run in your browser.' : 'Replay: a recorded run in your browser. No live service is set for this site.'
  }
  return (
    <div className="mode-banner" role="region" aria-label="Data source">
      <p><span className="mode-banner-tag">Replay</span> {text}</p>
      {action}
    </div>
  )
}

export function MarketBanner() {
  const m = useMarket()
  if (!m.data?.active) return null
  return (
    <div className="market-banner" role="status">
      <p><strong>Market event: {m.data.label}.</strong> {m.data.detail ?? 'It moves the shared price feed and vaults, so every treasury sees it.'}</p>
    </div>
  )
}

export function TestModeBanner() {
  const { mode, chainId } = useAegis()
  const where = mode === 'replay' || chainId === 84532 ? 'Base Sepolia testnet' : chainId === 31337 ? 'local test chain' : `${chainName(chainId).replace(/ \(\d+\)$/, '')} testnet`
  return (
    <div className="test-banner" role="region" aria-label="Test mode">
      <p><strong>Test mode:</strong> {where}. No real funds.</p>
    </div>
  )
}

function TopBar() {
  return (
    <div className="top-bar">
      <SearchField />
      <div className="top-tools">
        <ModeIndicator />
        <button type="button" className="icon-button" aria-haspopup="dialog" onClick={() => openOverlay({ kind: 'shortcuts' })} aria-label="Keyboard shortcuts" title="Keyboard shortcuts (?)"><Icon name="help" /></button>
        <button type="button" className="icon-button" aria-haspopup="dialog" onClick={() => openOverlay({ kind: 'glossary' })} aria-label="What the terms mean" title="What the terms mean"><Icon name="terms" /></button>
      </div>
    </div>
  )
}

const WIDE = '(min-width: 1024px)'

function subscribeWide(cb: () => void) {
  const m = window.matchMedia(WIDE)
  m.addEventListener('change', cb)
  return () => m.removeEventListener('change', cb)
}

function useWide() {
  return useSyncExternalStore(subscribeWide, () => window.matchMedia(WIDE).matches, () => true)
}

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])'

function SideNav() {
  const { role } = useIdentity()
  const groups = [...new Set(PAGES.map((p) => p.group))]
  return (
    <nav aria-label="Pages" className="side-nav">
      {groups.map((g) => (
        <div key={g} className="side-group">
          <p className="side-group-label">{g}</p>
          <ul className="side-links">
            {PAGES.filter((p) => p.group === g).map((p) => {
              const yours = p.acts !== null && p.acts === role
              return (
                <li key={p.to}>
                  <NavLink to={p.to} className={({ isActive }) => `side-link${isActive ? ' is-active' : ''}`}>
                    <Icon name={p.icon} />
                    <span className="side-label">{p.label}</span>
                    {yours ? <span className="side-badge">{p.acts === 'bank' ? 'Your desk' : 'You act'}</span> : null}
                  </NavLink>
                </li>
              )
            })}
          </ul>
        </div>
      ))}
      <div className="side-group">
        <p className="side-group-label">TradeFlow</p>
        <ul className="side-links">
          <li>
            <span className="side-link is-disabled" aria-disabled="true">
              <Icon name="orders" />
              <span className="side-label">Orders</span>
              <span className="side-soon">Coming soon</span>
            </span>
          </li>
        </ul>
      </div>
    </nav>
  )
}

function SafeLine() {
  const { deployment } = useAegis()
  const safe = deployment.safe
  return (
    <div className="side-safe">
      <span className="side-caption">Safe</span>
      {safe && safe !== zeroAddress ? <Hash value={safe} kind="address" label="treasury Safe address" /> : <span className="muted">No treasury yet</span>}
    </div>
  )
}

export type ThemePref = 'light' | 'dark' | 'system'
const THEME_KEY = 'porthmos.theme'
const DARK = '(prefers-color-scheme: dark)'

function readThemePref(): ThemePref {
  try {
    const v = localStorage.getItem(THEME_KEY)
    return v === 'dark' || v === 'system' ? v : 'light'
  } catch {
    return 'light'
  }
}

function applyTheme(pref: ThemePref) {
  const dark = pref === 'dark' || (pref === 'system' && window.matchMedia(DARK).matches)
  document.documentElement.dataset.theme = dark ? 'dark' : 'light'
}

function ThemeToggle() {
  const [pref, setPref] = useState<ThemePref>(readThemePref)
  useEffect(() => {
    applyTheme(pref)
    if (pref !== 'system') return
    const m = window.matchMedia(DARK)
    const on = () => applyTheme('system')
    m.addEventListener('change', on)
    return () => m.removeEventListener('change', on)
  }, [pref])
  const choose = (p: ThemePref) => {
    setPref(p)
    try { localStorage.setItem(THEME_KEY, p) } catch { /* the choice still applies to this page */ }
  }
  const options: { p: ThemePref; label: string; icon: 'sun' | 'moon' | 'system' }[] = [
    { p: 'light', label: 'Light', icon: 'sun' }, { p: 'dark', label: 'Dark', icon: 'moon' }, { p: 'system', label: 'System', icon: 'system' },
  ]
  return (
    <div className="theme-toggle" role="radiogroup" aria-label="Theme">
      {options.map((o) => (
        <button key={o.p} type="button" role="radio" aria-checked={pref === o.p} onClick={() => choose(o.p)}>
          <Icon name={o.icon} /><span>{o.label}</span>
        </button>
      ))}
    </div>
  )
}

function Brand() {
  return (
    <NavLink to="/" className="brand" aria-label="Porthmos, overview">
      <img className="brand-mark brand-color" src="/brand/porthmos-mark.png" alt="" width="28" height="31" />
      <img className="brand-mark brand-mono" src="/brand/porthmos-mark-mono-light.png" alt="" width="28" height="31" />
      <span className="brand-name">Porthmos</span>
    </NavLink>
  )
}

export function AppShell({ children }: { children: ReactNode }) {
  const wide = useWide()
  const [open, setOpen] = useState(false)
  const { pathname } = useLocation()
  const sideRef = useRef<HTMLDivElement>(null)
  const menuRef = useRef<HTMLButtonElement>(null)
  const drawer = open && !wide

  useLayoutEffect(() => {
    const root = document.documentElement
    root.classList.add('app-theme')
    applyTheme(readThemePref())
    return () => root.classList.remove('app-theme')
  }, [])

  useEffect(() => { setOpen(false) }, [pathname, wide])

  useEffect(() => {
    const side = sideRef.current
    const menu = menuRef.current
    if (!drawer || !side) return
    const items = () => Array.from(side.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => el.getClientRects().length > 0)
    side.querySelector<HTMLElement>('.side-close')?.focus()
    const onKey = (e: KeyboardEvent) => {
      // a dialog opened from the drawer (Terms) handles its own keys
      if (document.querySelector('dialog[open]')) return
      if (e.key === 'Escape') { e.preventDefault(); setOpen(false); return }
      if (e.key !== 'Tab') return
      const list = items()
      if (!list.length) return
      const first = list[0]
      const last = list[list.length - 1]
      const active = document.activeElement
      if (e.shiftKey && (active === first || !side.contains(active))) { e.preventDefault(); last.focus() }
      else if (!e.shiftKey && (active === last || !side.contains(active))) { e.preventDefault(); first.focus() }
    }
    const root = document.documentElement
    const overflow = root.style.overflow
    root.style.overflow = 'hidden'
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('keydown', onKey)
      root.style.overflow = overflow
      const active = document.activeElement
      if (!active || active === document.body || side.contains(active)) menu?.focus()
    }
  }, [drawer])

  useGlobalShortcuts()

  return (
    <div className="app">
      <a className="skip" href="#main">Skip to content</a>
      <TestModeBanner />
      <header className="app-head">
        <div className="app-top">
          <Brand />
          <div className="app-tools">
            {wide ? null : (
              <>
                <button type="button" className="icon-button" aria-haspopup="dialog" aria-label="Search" onClick={() => openOverlay({ kind: 'palette' })}><Icon name="search" /></button>
                <IdentityControl /><ModeIndicator />
              </>
            )}
            <button type="button" className="menu-button" ref={menuRef} aria-expanded={drawer} aria-controls="app-side" onClick={() => setOpen(true)}>
              <Icon name="menu" /><span className="menu-text">Menu</span>
            </button>
          </div>
        </div>
        <div className={`side${drawer ? ' is-open' : ''}`} id="app-side" ref={sideRef} role={drawer ? 'dialog' : undefined} aria-modal={drawer || undefined} aria-label={drawer ? 'Menu' : undefined}>
          <div className="side-inner">
            <div className="side-head">
              <Brand />
              {wide ? null : (
                <button type="button" className="side-close" onClick={() => setOpen(false)}><Icon name="close" /><span>Close</span></button>
              )}
            </div>
            {wide ? (
              <div className="side-org">
                <IdentityControl variant="switcher" />
                <SafeLine />
              </div>
            ) : <div className="side-org"><SafeLine /></div>}
            <SideNav />
            <div className="side-foot">
              <div className="side-session">
                <span className="side-caption" id="theme-caption">Theme</span>
                <ThemeToggle />
              </div>
              <ul className="side-tools">
                <li><button type="button" className="side-tool" aria-haspopup="dialog" onClick={() => { setOpen(false); openOverlay({ kind: 'glossary' }) }}><Icon name="terms" /><span>Terms</span></button></li>
                <li><button type="button" className="side-tool" aria-haspopup="dialog" onClick={() => { setOpen(false); openOverlay({ kind: 'shortcuts' }) }}><Icon name="keyboard" /><span>Shortcuts</span></button></li>
                <li><Link to="/" className="side-tool"><Icon name="overview" /><span>Overview</span></Link></li>
              </ul>
            </div>
          </div>
        </div>
        <div className="side-scrim" hidden={!drawer} onClick={() => setOpen(false)} />
      </header>
      <div className="app-main" inert={drawer}>
        {wide ? <TopBar /> : null}
        {children}
      </div>
      <Notices />
      <CommandPalette />
      <ShortcutsDialog />
      <GlossaryDialog />
    </div>
  )
}

export function Notices() {
  const { notices, dismissNotice } = useAegis()
  const toasts = useToasts()
  return (
    <div className="notices" aria-live="polite" aria-atomic="false">
      {toasts.map((t) => (
        <div key={`t-${t.id}`} className={`notice toast tone-${t.tone}`}>
          <Icon name={t.tone === 'ok' ? 'check' : t.tone === 'refused' ? 'alert' : 'info'} className="toast-icon" />
          <div className="toast-body">
            <p className="toast-title">{t.title}</p>
            {t.text ? <p>{t.text}</p> : null}
            {t.href ? <a className="toast-link" href={t.href} target="_blank" rel="noreferrer">{t.linkLabel ?? 'Open'}<Icon name="external" /></a> : null}
          </div>
          <button type="button" className="toast-close" onClick={() => dismissToast(t.id)} aria-label="Dismiss"><Icon name="close" /></button>
        </div>
      ))}
      {notices.map((n) => n.event.type === 'notice' ? (
        <div key={n.id} className={`notice toast n-${n.event.data.level} tone-${n.event.data.level === 'alert' ? 'refused' : 'info'}`}>
          <Icon name={n.event.data.level === 'alert' ? 'alert' : 'info'} className="toast-icon" />
          <div className="toast-body"><p>{n.event.data.text}</p></div>
          <button type="button" className="toast-close" onClick={() => dismissNotice(n.id)} aria-label="Dismiss notice"><Icon name="close" /></button>
        </div>
      ) : null)}
    </div>
  )
}
