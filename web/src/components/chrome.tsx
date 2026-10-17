import { useEffect, useId, useLayoutEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom'
import { zeroAddress } from 'viem'
import { useConnection, useDisconnect } from 'wagmi'
import { DEFAULT_LIVE_URL, useAegis } from '../lib/source'
import { useIdentity, type Seat } from '../lib/identity'
import { chainName } from '../lib/wallet'
import { shortHex } from '../lib/format'
import { RECORDED_SCENARIOS } from '../lib/proof'
import { Hash } from './bits'
import { Icon } from './icons'
import { useSeatPicker } from '../lib/seats'
import { useMarket } from '../lib/queries'
import { dismissToast, useToasts } from '../lib/toast'
import { openOverlay } from '../lib/ui'
import { MenuButton } from './Menu'
import { CommandPalette, SearchField } from './CommandPalette'
import { GlossaryDialog, ShortcutsDialog, useGlobalShortcuts } from './Shortcuts'
import type { Role } from '../lib/types'
import { useTradeFlow } from '../lib/tradeflow/queries'
import { useSignOut } from '../auth/hooks'
import { ForgetDevice } from './ForgetDevice'
import { AccountMenu, NetworkBanner } from './wallet/AccountMenu'
import { useWalletPicker } from './wallet/WalletPicker'
import { useSiwePreview } from '../lib/useSiwePreview'

export const PAGES = [
  { to: '/treasury', label: 'Treasury', icon: 'treasury', hint: 'Balances, reserve and positions', group: 'Treasury' },
  { to: '/copilot', label: 'Copilot', icon: 'copilot', hint: 'Ask the agent, approve its deposits', group: 'Treasury' },
  { to: '/risk', label: 'Risk', icon: 'risk', hint: 'Oracle, triggers and vault risk', group: 'Treasury' },
  { to: '/audit', label: 'Audit', icon: 'audit', hint: 'Decision ledger and on-chain events', group: 'Treasury' },
  { to: '/bank', label: 'Bank desk', icon: 'bank', hint: 'Clients, freezes and escalations', group: 'Oversight' },
  { to: '/orders', label: 'Orders', icon: 'orders', hint: 'Trade orders paid in milestones from escrow', group: 'TradeFlow' },
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
  const { mode, phase, reason, switchMode, streamStatus, chainId, apiBase, connect, forgetApi, demoChanged, resetDemo, service, onboard, tenant, wallet, refresh } = useAegis()
  const { chooser } = useIdentity()
  const { open, setOpen, ref } = usePopover()
  const [url, setUrl] = useState(apiBase || DEFAULT_LIVE_URL)
  const id = useId()
  const urlId = useId()
  const label = phase === 'probing' ? 'Connecting…' : mode === 'replay' ? 'Replay' : 'Live'
  const multi = service === 'up' && !!onboard
  const close = () => setOpen(false)
  const next = mode !== 'replay' ? null
    : multi && tenant ? <button type="button" className="button small" onClick={() => { close(); chooser.show('switch') }}>Open my treasury</button>
    : multi && wallet ? <Link to="/signup" className="button small" onClick={close}>Continue setup</Link>
    : multi ? <Link to="/signup" className="button small" onClick={close}>Create your treasury</Link>
    : service === 'down' ? <button type="button" className="button small quiet" onClick={() => { close(); refresh(null) }}>Try the live service again</button>
    : null
  return (
    <div className={`mode mode-${phase === 'probing' ? 'probing' : mode}`} ref={ref}>
      <button type="button" className="mode-button" aria-expanded={open} aria-controls={id} onClick={() => setOpen((o) => !o)} title="Data source">
        <span className="mode-mark" aria-hidden="true" />
        <span>{label}</span>
      </button>
      {open ? (
        <div className="mode-panel" id={id} role="dialog" aria-label="Data source">
          {mode === 'replay' ? (
            <>
              <p className="mode-title">Replay</p>
              <p>A recorded run of the reference treasury, played in your browser. Nothing here sends a transaction.</p>
              <p className="muted">Recorded on Base Sepolia: {RECORDED_SCENARIOS.join(', ')}. Rows without a recorded transaction show no hash.</p>
              <div className="demo-state">
                <p>{demoChanged ? 'Changed by you in this tab' : 'Recorded base run'}</p>
                {demoChanged ? <button type="button" className="button small quiet" onClick={() => { resetDemo(); close() }}>Reset</button> : null}
              </div>
              {next}
              {reason ? <p className="muted">{reason}.</p> : null}
              <details className="mode-advanced">
                <summary>Connect a live service</summary>
                <form className="connect" onSubmit={(e) => { e.preventDefault(); connect(url); close() }}>
                  <label htmlFor={urlId}>Service address</label>
                  <input id={urlId} className="field" type="url" inputMode="url" required value={url} onChange={(e) => setUrl(e.target.value)} />
                  <button type="submit" className="button small quiet">Connect</button>
                </form>
              </details>
            </>
          ) : (
            <>
              <p className="mode-title">Live</p>
              <p>{apiBase || 'This site’s /api'} on {chainName(chainId)}. Event stream {streamStatus}.</p>
              {reason ? <p className="muted">{reason}.</p> : null}
              <div className="row-actions">
                <button type="button" className="button small quiet" onClick={() => { switchMode('replay'); close() }}>Switch to replay</button>
                {apiBase ? <button type="button" className="button small quiet" onClick={() => { forgetApi(); close() }}>Forget this address</button> : null}
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

export function WalletSignIn({ onDone, signOutButton = true }: { onDone?: () => void; signOutButton?: boolean }) {
  const { identity, signIn, signOut, signedIn, session, sessionError, walletRole } = useIdentity()
  const { chainId } = useAegis()
  const conn = useConnection()
  const picker = useWalletPicker()
  const { mutate: disconnect } = useDisconnect()
  const [busy, setBusy] = useState(false)
  const role = identity.kind === 'wallet' ? identity.role : null
  const wrong = !!conn.address && conn.chainId !== chainId
  const preview = useSiwePreview(role, identity.kind === 'wallet' ? identity.address : null, !!role && !signedIn && !wrong)

  if (!conn.address) {
    return (
      <div className="wallet">
        <button type="button" className="button small secondary" onClick={() => void picker.open()}>Connect wallet</button>
      </div>
    )
  }
  return (
    <div className="wallet">
      <p>Wallet <code>{shortHex(conn.address)}</code> on {chainName(conn.chainId)}.{' '}
        {wrong ? `Porthmos runs on ${chainName(chainId)}.` : walletRole.status === 'loading' ? 'Reading its role from the PolicyRegistry…' : role ? (walletRole.status === 'error' ? `The registry could not be read; the deployment file lists it as the ${seatTarget(role)}. The service checks the registry when you sign in.` : `The PolicyRegistry lists it as the ${seatTarget(role)} of this Safe.`) : 'This wallet holds no Porthmos role, so you can look around read-only.'}
      </p>
      {wrong ? <button type="button" className="button small" onClick={() => void picker.open()}>Switch network</button> : null}
      {role && !signedIn && !wrong ? (
        <>
          <p className="muted">You sign this Sign-In with Ethereum message. It costs nothing and moves nothing.</p>
          <pre className="sign-preview">{preview.prepared?.message ?? (preview.error ? preview.error : 'Preparing the message…')}</pre>
          <button type="button" className="button small" disabled={busy || session === 'pending' || !preview.prepared} onClick={async () => { if (!preview.prepared) return; setBusy(true); try { await signIn(preview.prepared); onDone?.() } finally { setBusy(false); preview.retry() } }}>
            {busy || session === 'pending' ? 'Waiting for the signature…' : `Sign in as ${seatTarget(role)}`}
          </button>
        </>
      ) : null}
      {signedIn && signOutButton ? <button type="button" className="button small quiet" onClick={signOut}>Sign out</button> : null}
      <button type="button" className="button small quiet" onClick={() => { signOut(); disconnect() }}>Disconnect wallet</button>
      {sessionError ? <p className="error-note" role="alert">{sessionError}</p> : null}
    </div>
  )
}

function TenantSeats({ onDone }: { onDone: () => void }) {
  const { identity, signedIn, session, sessionError, localAddress, chooser } = useIdentity()
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
    </fieldset>
  )
}

export function useTreasuryName() {
  const { mode, tenant } = useAegis()
  return mode === 'live' && tenant ? 'Your treasury' : 'Reference treasury'
}

function initials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join('')
}

export function IdentityControl({ variant = 'chip' }: { variant?: 'chip' | 'switcher' }) {
  const { identity, seat, demoAvailable, chooseDemo, chooseSeat, session, signedIn } = useIdentity()
  const { mode, tenant, service, onboard, wallet } = useAegis()
  const { open, setOpen, ref } = usePopover()
  const [forgetting, setForgetting] = useState(false)
  const signOutAll = useSignOut()
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
        <div className="identity-panel" id={id} role="dialog" aria-label="Account">
          {variant === 'switcher' ? <SafeLine /> : null}
          {multi && tenant ? <TenantSeats onDone={() => setOpen(false)} /> : null}
          {multi && !tenant ? (
            <div className="seat-set">
              <p>You have no treasury in this browser yet.</p>
              <Link to="/signup" className="button small" onClick={() => setOpen(false)}>Create your treasury</Link>
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
                {identity.kind === 'demo' ? <p>Using the local test key for the {seatTarget(identity.role)}, <code>{shortHex(identity.address, 6, 4)}</code>.</p> : <WalletSignIn signOutButton={false} />}
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
          <div className="account-foot">
            <button type="button" id="account-signout" className="button small quiet" onClick={() => { setOpen(false); signOutAll() }}>Sign out</button>
            {wallet ? <button type="button" id="account-forget" className="button small quiet" aria-haspopup="dialog" onClick={() => { setOpen(false); setForgetting(true) }}>Forget this device</button> : null}
          </div>
        </div>
      ) : null}
      <ForgetDevice open={forgetting} onClose={() => setForgetting(false)} />
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

function HelpMenu() {
  const navigate = useNavigate()
  return (
    <MenuButton buttonClass="icon-button" buttonLabel="Help" items={[
      { key: 'shortcuts', label: 'Keyboard shortcuts', meta: '?', onSelect: () => openOverlay({ kind: 'shortcuts' }) },
      { key: 'terms', label: 'What the terms mean', onSelect: () => openOverlay({ kind: 'glossary' }) },
      { key: 'overview', label: 'Product overview', onSelect: () => navigate('/') },
    ]}><Icon name="help" /></MenuButton>
  )
}

function TopTools() {
  return (
    <div className="top-tools">
      <ModeIndicator />
      <ThemeMenu />
      <HelpMenu />
      <AccountMenu />
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

export function useVisiblePages() {
  const tf = useTradeFlow()
  return PAGES.filter((p) => p.group !== 'TradeFlow' || tf.available)
}

function SideNav() {
  const pages = useVisiblePages()
  const groups = [...new Set(pages.map((p) => p.group))]
  return (
    <nav aria-label="Pages" className="side-nav">
      {groups.map((g) => (
        <div key={g} className="side-group">
          <p className="side-group-label">{g}</p>
          <ul className="side-links">
            {pages.filter((p) => p.group === g).map((p) => (
              <li key={p.to}>
                <NavLink to={p.to} className={({ isActive }) => `side-link${isActive ? ' is-active' : ''}`}>
                  <Icon name={p.icon} />
                  <span className="side-label">{p.label}</span>
                </NavLink>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </nav>
  )
}

function SafeLine() {
  const { deployment } = useAegis()
  const safe = deployment.safe
  return (
    <div className="side-safe">
      <span className="side-caption">Safe address</span>
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

function ThemeMenu() {
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
  const options: { p: ThemePref; label: string }[] = [{ p: 'light', label: 'Light' }, { p: 'dark', label: 'Dark' }, { p: 'system', label: 'Match system' }]
  return (
    <MenuButton buttonClass="icon-button" buttonLabel={`Theme: ${options.find((o) => o.p === pref)!.label}`} radio
      items={options.map((o) => ({ key: o.p, label: o.label, checked: pref === o.p, onSelect: () => choose(o.p) }))}>
      <Icon name={pref === 'dark' ? 'moon' : pref === 'system' ? 'system' : 'sun'} />
    </MenuButton>
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
      <NetworkBanner />
      <header className="app-head">
        <div className="app-top">
          <button type="button" className="icon-button menu-button" ref={menuRef} aria-expanded={drawer} aria-controls="app-side" aria-label="Menu" onClick={() => setOpen(true)}>
            <Icon name="menu" />
          </button>
          <Brand />
          <div className="app-tools">
            <button type="button" className="icon-button" aria-haspopup="dialog" aria-label="Search" onClick={() => openOverlay({ kind: 'palette' })}><Icon name="search" /></button>
            {wide ? null : <TopTools />}
          </div>
        </div>
        <div className={`side${drawer ? ' is-open' : ''}`} id="app-side" ref={sideRef} role={drawer ? 'dialog' : undefined} aria-modal={drawer || undefined} aria-label={drawer ? 'Menu' : undefined}>
          <div className="side-inner">
            <div className="side-head">
              <Brand />
              {wide ? null : (
                <button type="button" className="icon-button side-close" onClick={() => setOpen(false)} aria-label="Close menu"><Icon name="close" /></button>
              )}
            </div>
            <div className="side-org"><IdentityControl variant="switcher" /></div>
            <SideNav />
          </div>
        </div>
        <div className="side-scrim" hidden={!drawer} onClick={() => setOpen(false)} />
      </header>
      <div className="app-main" inert={drawer}>
        {wide ? (
          <div className="top-bar">
            <SearchField />
            <TopTools />
          </div>
        ) : null}
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
