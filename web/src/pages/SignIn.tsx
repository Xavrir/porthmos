import { useEffect, useId, useRef, useState, type ChangeEvent } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { useConnection, useDisconnect } from 'wagmi'
import type { Address } from 'viem'
import { AuthLayout, OrDivider } from '../auth/AuthLayout'
import { useViewDemo } from '../auth/hooks'
import { Dialog } from '../components/Dialog'
import { Icon } from '../components/icons'
import { SignConfirm } from '../components/SignConfirm'
import { usePageTitle } from '../components/chrome'
import { useSwitchToApp } from '../components/wallet/AccountMenu'
import { WalletAvatar } from '../components/wallet/WalletAvatar'
import { useWalletPicker } from '../components/wallet/WalletPicker'
import { deviceStatus, homeFor, returnPath, type Device } from '../lib/auth'
import { shortHex } from '../lib/format'
import { useIdentity, type LostSession } from '../lib/identity'
import { ownerAddress, parseWallet, WalletFileError, type WalletFile } from '../lib/keys'
import { plainError } from '../lib/onboard/errors'
import { useAegis } from '../lib/source'
import type { Role } from '../lib/types'
import { useSiwePreview } from '../lib/useSiwePreview'
import { chainName } from '../lib/wallet'

type Flow = null | 'device' | 'device-wait' | 'testkey' | 'testkey-wait'
type Note = { tone: 'info' | 'error'; text: string; finish?: boolean } | null

const net = (id: number | undefined) => chainName(id).replace(/ \(\d+\)$/, '')

function DeviceLine({ device }: { device: Device }) {
  switch (device.status) {
    case 'none': return <span>No test wallet in this browser yet.</span>
    case 'checking': return <span>Owner <code>{shortHex(device.owner)}</code>. Checking the chain…</span>
    case 'offline': return <><span>Owner <code>{shortHex(device.owner)}</code></span><span className="auth-sub">The Porthmos service is not answering, so this browser cannot sign in right now.</span></>
    case 'wrong-chain': return <><span>Owner <code>{shortHex(device.owner)}</code></span><span className="auth-sub">These keys are for chain {device.chainId}; this service runs chain {device.want}.</span></>
    case 'unfinished': return <><span>Owner <code>{shortHex(device.owner)}</code></span><span className="auth-sub">Setup is not finished. <Link to="/signup">Finish creating your account</Link>.</span></>
    case 'ready': return <><span>Owner <code>{shortHex(device.owner)}</code>{device.ownerVia === 'wallet' ? ' (your wallet)' : ''}</span><span className="auth-sub">Safe <code>{shortHex(device.safe)}</code></span></>
  }
}

function lostText(l: LostSession): string {
  if (l.why === 'account') return `Your wallet switched to ${shortHex(l.to)}, so Porthmos signed out ${shortHex(l.from)}. Sign in again to continue.`
  if (l.why === 'disconnected') return `Your wallet disconnected, so Porthmos signed out ${shortHex(l.from)}.`
  return 'Your session ended. Sign in again to continue.'
}

const roleWord = (r: Role) => (r === 'owner' ? 'owner' : 'bank')

export default function SignIn() {
  usePageTitle('Log in')
  const navigate = useNavigate()
  const from = (useLocation().state as { from?: unknown } | null)?.from
  const { phase, mode, service, onboard, wallet, setWallet, tenant, refresh, chainId, deployment, walletRoles, rolesFor, rolesFailed, accountSource, chooseAccount } = useAegis()
  const { identity, seat: currentSeat, chooseSeat, chooseDemo, demoAvailable, signedIn, session, sessionError, signIn, signInLocal, localAddress, lost, clearLost } = useIdentity()
  const conn = useConnection()
  const picker = useWalletPicker()
  const { mutateAsync: disconnect } = useDisconnect()
  const sw = useSwitchToApp()
  const viewDemo = useViewDemo()
  const [seat, setSeat] = useState<Role>(() => (currentSeat === 'bank' ? 'bank' : 'owner'))
  const [flow, setFlow] = useState<Flow>(null)
  const [note, setNote] = useState<Note>(null)
  const [help, setHelp] = useState(false)
  const [replace, setReplace] = useState<WalletFile | null>(null)
  const [restored, setRestored] = useState(false)
  const [testOpen, setTestOpen] = useState(() => accountSource === 'file' && !!wallet)
  const [signing, setSigning] = useState(false)
  const [walletNote, setWalletNote] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const helpId = useId()
  const seatName = useId()
  const walletSeatName = useId()

  const device = deviceStatus({
    phase, serviceUp: service === 'up', configChainId: onboard?.chainId ?? null, tenant: tenant?.via === 'file' ? tenant : null,
    wallet: wallet ? { chainId: wallet.chainId, owner: ownerAddress(wallet), ownerVia: wallet.owner.type === 'injected' ? 'wallet' : 'key', safe: wallet.safe } : null,
  })
  const role = identity.kind === 'none' ? null : identity.role
  const target = onboard?.chainId ?? chainId
  const walletMode = !!conn.address && (accountSource === 'wallet' || !wallet)
  const wrongNetwork = !!conn.address && conn.chainId !== target
  const rolesReady = !!conn.address && phase === 'ready' && (!onboard || (rolesFor?.toLowerCase() === conn.address.toLowerCase()))
  const held: Role[] = onboard
    ? [...(walletRoles?.owner ? (['owner'] as Role[]) : []), ...(walletRoles?.bank.length ? (['bank'] as Role[]) : [])]
    : identity.kind === 'wallet' && identity.role ? [identity.role] : []
  const walletSeat: Role | null = held.includes(seat) ? seat : held[0] ?? null
  const walletSigning = walletMode && !wrongNetwork && identity.kind === 'wallet' && !!identity.role && identity.role === walletSeat && !signedIn
  const preview = useSiwePreview(walletSigning ? walletSeat : null, walletSigning ? identity.address : null, walletSigning && mode === 'live')
  const deviceAddress = localAddress(seat)
  const devicePreview = useSiwePreview(seat, deviceAddress, flow === 'device' && !!deviceAddress)
  const testKey = deployment.roles[seat]
  const testKeyPreview = useSiwePreview(seat, testKey, flow === 'testkey')

  useEffect(() => {
    if (mode !== 'live' || !signedIn || !role) return
    if (currentSeat !== role) chooseSeat(role)
    navigate(returnPath(from, homeFor(role)), { replace: true })
  }, [chooseSeat, currentSeat, from, mode, navigate, role, signedIn])

  useEffect(() => {
    if (walletMode && walletSeat && currentSeat !== walletSeat) chooseSeat(walletSeat)
  }, [chooseSeat, currentSeat, walletMode, walletSeat])

  useEffect(() => {
    if (!restored || phase !== 'ready') return
    setRestored(false)
    if (device.status === 'ready') {
      setNote({ tone: 'info', text: `Found your treasury, Safe ${shortHex(device.safe)}. Sign in to open it.` })
      startDevice()
    } else if (device.status === 'unfinished') setNote({ tone: 'info', text: 'These keys belong to a treasury whose setup is not finished.', finish: true })
    else if (device.status === 'wrong-chain') setNote({ tone: 'error', text: `These keys are for chain ${device.chainId}, but this service runs chain ${device.want}.` })
    else if (device.status === 'offline') setNote({ tone: 'error', text: 'The keys are saved in this browser. Signing in needs the Porthmos service, which is not answering.' })
    // runs once per restore, after the probe that the restore started
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [restored, phase])

  const connect = async () => {
    setNote(null)
    setWalletNote(null)
    clearLost()
    const picked = await picker.open()
    if (!picked) return
    if (accountSource !== 'wallet') chooseAccount('wallet')
    else if (mode !== 'live') refresh('live')
  }

  const otherWallet = async () => {
    setWalletNote(null)
    await disconnect().catch(() => undefined)
    void connect()
  }

  const confirmWallet = async () => {
    if (!preview.prepared) return
    setSigning(true)
    setWalletNote(null)
    try {
      await signIn(preview.prepared)
    } catch (e) {
      setWalletNote(plainError(e, 'Your wallet').message)
    } finally {
      setSigning(false)
      preview.retry()
    }
  }

  const openTest = () => {
    setTestOpen((o) => !o)
    setNote(null)
    if (!testOpen && accountSource !== 'file') chooseAccount('file')
  }

  const startDevice = () => {
    setNote(null)
    if (seat === 'owner' && wallet?.owner.type === 'injected') {
      chooseSeat('owner')
      if (accountSource !== 'wallet') chooseAccount('wallet')
      void connect()
      return
    }
    setFlow('device')
  }

  const onRestore = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    try {
      const w = parseWallet(await file.text())
      if (wallet && ownerAddress(wallet).toLowerCase() !== ownerAddress(w).toLowerCase()) { setReplace(w); return }
      restore(w)
    } catch (err) {
      setNote({ tone: 'error', text: err instanceof WalletFileError ? err.message : 'That file could not be read.' })
    }
  }

  const restore = (w: WalletFile) => {
    setReplace(null)
    setFlow(null)
    setWallet(w)
    setNote({ tone: 'info', text: `Restored the keys for owner ${shortHex(ownerAddress(w))}. Checking the chain…` })
    setRestored(true)
    chooseAccount('file')
  }

  const walletPanel = () => {
    if (!conn.address) return null
    const a = conn.address as Address
    return (
      <div className="auth-panel auth-wallet" id="signin-wallet-panel" aria-live="polite">
        <div className="auth-wallet-id">
          <WalletAvatar address={a} size={32} />
          <div>
            <p className="auth-wallet-addr"><code>{shortHex(a)}</code></p>
            <p className={`auth-sub auth-net${wrongNetwork ? ' is-wrong' : ''}`}><span className={`net-dot ${wrongNetwork ? 'is-bad' : 'is-ok'}`} aria-hidden="true" />{net(conn.chainId)}</p>
          </div>
          <button type="button" id="signin-other-wallet" className="auth-link auth-wallet-other" onClick={() => void otherWallet()}>Use a different wallet</button>
        </div>
        {wrongNetwork ? (
          <>
            <p className="auth-note">Porthmos runs on {net(target)}. Switch your wallet to sign in.</p>
            <button type="button" id="signin-switch-chain" className="pill pill-primary" disabled={sw.isPending} onClick={() => { setWalletNote(null); sw.run().catch((e) => setWalletNote(plainError(e, 'Your wallet').message)) }}>
              {sw.isPending ? 'Approve in your wallet…' : `Switch to ${net(target)}`}
            </button>
          </>
        ) : !rolesReady || (walletSigning && !preview.prepared && !preview.error) ? (
          <p className="auth-note">Checking your account on {net(target)}…</p>
        ) : mode !== 'live' && !held.length ? (
          <p className="auth-note">No live Porthmos service answers here, so this wallet cannot sign in. View the demo instead.</p>
        ) : !held.length && rolesFailed ? (
          <>
            <p className="auth-note">Porthmos could not check this wallet's account just now. Nothing is wrong with the wallet.</p>
            <button type="button" id="signin-roles-retry" className="pill pill-outline" onClick={() => refresh()}>Check again</button>
          </>
        ) : !held.length ? (
          walletRoles?.pendingOwner ? (
            <p className="auth-note">This wallet started creating an account, but setup is not finished. <Link to="/signup">Finish creating your account</Link>.</p>
          ) : (
            <>
              <p className="auth-note">This wallet has no Porthmos account yet. Create one: your wallet becomes the owner of a new Safe.</p>
              <Link to="/signup" id="signin-create-with-wallet" className="pill pill-outline">Create an account with this wallet</Link>
            </>
          )
        ) : (
          <>
            {held.length > 1 ? (
              <fieldset className="auth-seats">
                <legend className="auth-label">This wallet holds two seats. Sign in as</legend>
                <div className="auth-seg">
                  {held.map((r) => (
                    <label key={r} htmlFor={`signin-wallet-seat-${r}`}>
                      <input type="radio" id={`signin-wallet-seat-${r}`} name={walletSeatName} value={r} checked={walletSeat === r} onChange={() => setSeat(r)} />
                      {r === 'owner' ? 'Owner' : 'Bank'}
                    </label>
                  ))}
                </div>
              </fieldset>
            ) : null}
            {walletSigning && preview.prepared ? (
              <SignConfirm role={walletSeat!} address={a} what="this Sign-In with Ethereum message" keyName="your wallet" confirmLabel={`Sign in as ${roleWord(walletSeat!)}`}
                busy={signing || session === 'pending'}
                note="Your wallet opens and shows this same text. It costs nothing and moves nothing. The session lasts 12 hours and ends if the wallet switches account."
                onCancel={() => void disconnect().catch(() => undefined)} cancelLabel="Disconnect"
                onConfirm={() => void confirmWallet()}>
                <p>The PolicyRegistry lists this wallet as the {walletSeat === 'owner' ? 'owner' : 'bank officer'} of Safe <code>{shortHex(walletSeat === 'owner' ? walletRoles?.owner?.safe ?? tenant?.safe ?? deployment.safe : walletRoles?.bank[0]?.safe ?? deployment.safe)}</code>.</p>
                <pre className="sign-preview" id="signin-siwe" tabIndex={0} aria-label="Sign-In with Ethereum message">{preview.prepared.message}</pre>
              </SignConfirm>
            ) : preview.error ? (
              <p className="auth-note is-error" role="alert">{preview.error} <button type="button" className="auth-link" onClick={preview.retry}>Try again</button></p>
            ) : null}
          </>
        )}
        {walletNote || (sessionError && session === 'error' && walletMode) ? <p className="auth-note is-error" role="alert">{walletNote ?? sessionError}</p> : null}
      </div>
    )
  }

  const deviceReady = device.status === 'ready'

  return (
    <AuthLayout title="Log in to Porthmos" footer={<>New to Porthmos? <Link to="/signup" id="signin-to-signup">Create an account</Link></>}>
      {lost ? <p className="auth-note auth-lost" role="status" id="signin-lost">{lostText(lost)}</p> : null}

      <div className="auth-stack">
        {walletMode ? walletPanel() : (
          <>
            <button type="button" id="signin-wallet" className="pill pill-primary pill-block" onClick={() => void connect()}>
              {conn.address ? `Continue with ${shortHex(conn.address)}` : 'Connect wallet'}
            </button>
            <p className="auth-quiet">MetaMask, Rabby, Coinbase Wallet and other browser wallets, or a Coinbase Smart Wallet with a passkey. Your wallet is your account.</p>
          </>
        )}
      </div>

      <OrDivider />

      <div className="auth-test">
        <button type="button" id="signin-test" className="auth-option" aria-expanded={testOpen} aria-controls="signin-test-panel" onClick={openTest}>
          <span className="auth-option-icon" aria-hidden="true"><Icon name="key" /></span>
          <span className="auth-option-text">
            <span className="auth-option-title">{wallet ? 'Use the test wallet in this browser' : 'Try with a test wallet'}</span>
            <span className="auth-option-sub">A throwaway key made in this browser and saved to a recovery file. No extension needed.</span>
          </span>
          <Icon name="right" className="auth-option-chev" />
        </button>
        {testOpen ? (
          <div id="signin-test-panel" className="auth-section">
            <form className="auth-section" onSubmit={(e) => { e.preventDefault(); if (deviceReady) startDevice() }}>
              <div>
                <span className="auth-label" id="signin-device-label">Test wallet in this browser</span>
                <div className="auth-box" id="signin-device" aria-labelledby="signin-device-label" role="group" aria-live="polite"><DeviceLine device={device} /></div>
              </div>
              <fieldset className="auth-seats">
                <legend className="auth-label">Sign in as</legend>
                <div className="auth-seg">
                  {(['owner', 'bank'] as Role[]).map((r) => (
                    <label key={r} htmlFor={`signin-seat-${r}`}>
                      <input type="radio" id={`signin-seat-${r}`} name={seatName} value={r} checked={seat === r} onChange={() => { setSeat(r); if (flow === 'device' || flow === 'testkey') setFlow(null) }} />
                      {r === 'owner' ? 'Owner' : 'Bank'}
                    </label>
                  ))}
                </div>
              </fieldset>
              <div className="auth-actions">
                <button type="submit" id="signin-continue" className="pill pill-outline" disabled={!deviceReady || (flow === 'device-wait' && session !== 'error')}>
                  {flow === 'device-wait' ? 'Signing in…' : 'Continue with the test wallet'}
                </button>
                <button type="button" id="signin-restore" className="pill pill-outline" onClick={() => fileRef.current?.click()}>Restore from recovery file</button>
                <input ref={fileRef} id="signin-restore-file" type="file" accept="application/json,.json" hidden onChange={onRestore} />
              </div>
              {flow === 'device' && deviceAddress ? (
                <SignConfirm role={seat} address={deviceAddress} what="this Sign-In with Ethereum message" confirmLabel={`Sign in as ${roleWord(seat)}`}
                  disabled={!devicePreview.prepared}
                  onCancel={() => setFlow(null)} onConfirm={() => { if (!devicePreview.prepared) return; setFlow('device-wait'); signInLocal(seat, devicePreview.prepared) }}>
                  <pre className="sign-preview">{devicePreview.prepared?.message ?? devicePreview.error ?? 'Preparing the message…'}</pre>
                  <p>It proves you hold the key. It costs nothing and moves nothing.</p>
                </SignConfirm>
              ) : null}
              {flow === 'device-wait' ? <p className={`auth-note${session === 'error' ? ' is-error' : ''}`} aria-live="polite">{session === 'error' ? sessionError : 'Opening your session with the key in this browser…'}</p> : null}
            </form>
            {replace ? (
              <div className="auth-panel" role="group" aria-labelledby="signin-replace-text">
                <p id="signin-replace-text">This browser already holds the keys of owner <code>{wallet ? shortHex(ownerAddress(wallet)) : ''}</code>. Restoring replaces them. Download their recovery file first if you still need that treasury.</p>
                <div className="auth-actions">
                  <button type="button" id="signin-replace" className="pill pill-primary" onClick={() => restore(replace)}>Replace the keys</button>
                  <button type="button" id="signin-replace-cancel" className="pill pill-outline" onClick={() => setReplace(null)}>Keep them</button>
                </div>
              </div>
            ) : null}
            {demoAvailable ? (
              flow === 'testkey' ? (
                <SignConfirm role={seat} address={testKey} what="this Sign-In with Ethereum message" keyName={`the public Anvil test key for the ${roleWord(seat)}`} confirmLabel="Sign in with the test key"
                  disabled={!testKeyPreview.prepared}
                  note="Chain 31337 only. Public test keys of the reference treasury; never use them elsewhere."
                  onCancel={() => setFlow(null)} onConfirm={() => { if (!testKeyPreview.prepared) return; setFlow('testkey-wait'); chooseDemo(seat, testKeyPreview.prepared); if (mode !== 'live') refresh('live') }}>
                  <pre className="sign-preview">{testKeyPreview.prepared?.message ?? testKeyPreview.error ?? 'Preparing the message…'}</pre>
                </SignConfirm>
              ) : (
                flow === 'testkey-wait' ? <p className={`auth-note${session === 'error' ? ' is-error' : ''}`} aria-live="polite">{session === 'error' ? sessionError : 'Opening a session with the local test key…'}</p> :
                <p className="auth-quiet"><button type="button" id="signin-testkey" className="auth-link auth-link-solo" onClick={() => { setNote(null); setFlow('testkey') }}>Use the local test key (chain 31337)</button></p>
              )
            ) : null}
            <p className="auth-quiet"><button type="button" id="signin-help" className="auth-link" aria-haspopup="dialog" onClick={() => setHelp(true)}>How the test wallet works</button></p>
          </div>
        ) : null}
      </div>

      {note ? (
        <p className={`auth-note${note.tone === 'error' ? ' is-error' : ''}`} role={note.tone === 'error' ? 'alert' : 'status'}>
          {note.text}{note.finish ? <> <Link to="/signup">Finish creating your account</Link>.</> : null}
        </p>
      ) : null}

      <button type="button" id="signin-demo" className="auth-option" onClick={() => viewDemo(seat, from)}>
        <span className="auth-option-icon" aria-hidden="true"><Icon name="clock" /></span>
        <span className="auth-option-text">
          <span className="auth-option-title">View the demo</span>
          <span className="auth-option-sub">Judging or just curious? A recorded run of the reference treasury on {net(84532)}. Nothing to sign.</span>
        </span>
        <Icon name="right" className="auth-option-chev" />
      </button>

      <Dialog open={help} onClose={() => setHelp(false)} labelledBy={helpId} className="dialog-auth-help">
        <div className="dialog-body">
          <div className="dialog-head">
            <h2 id={helpId}>How signing in works</h2>
            <button type="button" id="signin-help-close" className="button small quiet" onClick={() => setHelp(false)}>Close</button>
          </div>
          <ul className="auth-help">
            <li><strong>No password.</strong> Your wallet, or a test wallet made in this browser, is your account. Keys never go to a server.</li>
            <li><strong>Signing in signs one Sign-In with Ethereum message.</strong> It names this site, the network and your seat. It costs nothing and moves nothing, and you see the exact text first.</li>
            <li><strong>A test wallet lives in this browser.</strong> Another browser needs its recovery file. Without the file, the keys cannot be recovered.</li>
            <li><strong>Test network only.</strong> Porthmos runs on {net(84532)}. Never send real funds to it.</li>
          </ul>
        </div>
      </Dialog>
    </AuthLayout>
  )
}
