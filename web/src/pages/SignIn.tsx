import { useEffect, useId, useRef, useState, type ChangeEvent } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { useConnect, useConnection, useConnectors, useSwitchChain } from 'wagmi'
import { AuthLayout, OrDivider } from '../auth/AuthLayout'
import { useViewDemo } from '../auth/hooks'
import { Dialog } from '../components/Dialog'
import { SignConfirm } from '../components/SignConfirm'
import { usePageTitle } from '../components/chrome'
import { deviceStatus, homeFor, returnPath, type Device } from '../lib/auth'
import { shortHex } from '../lib/format'
import { useIdentity } from '../lib/identity'
import { ownerAddress, parseWallet, WalletFileError, type WalletFile } from '../lib/keys'
import { plainError } from '../lib/onboard/errors'
import { sessionPreview } from '../lib/session'
import { useAegis } from '../lib/source'
import type { Role } from '../lib/types'
import { chainName } from '../lib/wallet'

type Flow = null | 'device' | 'device-wait' | 'wallet' | 'wallet-wait' | 'testkey' | 'testkey-wait'
type Note = { tone: 'info' | 'error'; text: string; finish?: boolean } | null

const net = (id: number) => chainName(id).replace(/ \(\d+\)$/, '')

function DeviceLine({ device }: { device: Device }) {
  switch (device.status) {
    case 'none': return <span>No account in this browser yet.</span>
    case 'checking': return <span>Owner <code>{shortHex(device.owner)}</code>. Checking the chain…</span>
    case 'offline': return <><span>Owner <code>{shortHex(device.owner)}</code></span><span className="auth-sub">The Porthmos service is not answering, so this browser cannot sign in right now.</span></>
    case 'wrong-chain': return <><span>Owner <code>{shortHex(device.owner)}</code></span><span className="auth-sub">These keys are for chain {device.chainId}; this service runs chain {device.want}.</span></>
    case 'unfinished': return <><span>Owner <code>{shortHex(device.owner)}</code></span><span className="auth-sub">Setup is not finished. <Link to="/signup">Finish creating your account</Link>.</span></>
    case 'ready': return <><span>Owner <code>{shortHex(device.owner)}</code>{device.ownerVia === 'wallet' ? ' (your wallet)' : ''}</span><span className="auth-sub">Safe <code>{shortHex(device.safe)}</code></span></>
  }
}

export default function SignIn() {
  usePageTitle('Log in')
  const navigate = useNavigate()
  const from = (useLocation().state as { from?: unknown } | null)?.from
  const { phase, mode, service, onboard, wallet, setWallet, tenant, refresh, chainId, deployment } = useAegis()
  const { identity, seat: currentSeat, chooseSeat, chooseDemo, demoAvailable, signedIn, session, sessionError, signIn, signInLocal, walletRole, localAddress } = useIdentity()
  const conn = useConnection()
  const connectors = useConnectors()
  const { mutateAsync: connectAsync, isPending: connecting } = useConnect()
  const { mutateAsync: switchChain, isPending: switching } = useSwitchChain()
  const viewDemo = useViewDemo()
  const [seat, setSeat] = useState<Role>(() => (currentSeat === 'bank' ? 'bank' : 'owner'))
  const [flow, setFlow] = useState<Flow>(null)
  const [note, setNote] = useState<Note>(null)
  const [help, setHelp] = useState(false)
  const [replace, setReplace] = useState<WalletFile | null>(null)
  const [restored, setRestored] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const helpId = useId()
  const seatName = useId()

  const device = deviceStatus({
    phase, serviceUp: service === 'up', configChainId: onboard?.chainId ?? null, tenant,
    wallet: wallet ? { chainId: wallet.chainId, owner: ownerAddress(wallet), ownerVia: wallet.owner.type === 'injected' ? 'wallet' : 'key', safe: wallet.safe } : null,
  })
  const role = identity.kind === 'none' ? null : identity.role

  useEffect(() => {
    if (mode !== 'live' || !signedIn || !role) return
    if (currentSeat !== role) chooseSeat(role)
    navigate(returnPath(from, homeFor(role)), { replace: true })
  }, [chooseSeat, currentSeat, from, mode, navigate, role, signedIn])

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

  const connectWallet = async () => {
    setNote(null)
    setFlow('wallet')
    try {
      let address = conn.address
      let current = conn.chainId
      if (!address) {
        const injected = connectors.find((c) => c.type === 'injected') ?? connectors[0]
        if (!injected) { setFlow(null); setNote({ tone: 'error', text: 'No browser wallet found. Install one such as MetaMask or Rabby, or use the keys in this browser.' }); return }
        const r = await connectAsync({ connector: injected })
        address = r.accounts[0]
        current = r.chainId
      }
      if (current !== chainId) await switchChain({ chainId: chainId as 31337 | 84532 })
    } catch (e) {
      setNote({ tone: 'error', text: plainError(e, 'Your wallet').message })
    }
  }

  const startDevice = () => {
    setNote(null)
    if (seat === 'owner' && wallet?.owner.type === 'injected') {
      chooseSeat('owner')
      if (mode !== 'live') refresh('live')
      void connectWallet()
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
    refresh(null)
  }

  const deviceAddress = localAddress(seat)
  const walletPanel = () => {
    if (!conn.address) return <p className="auth-note" aria-live="polite">{connecting ? 'Waiting for your wallet…' : 'Connect your browser wallet to continue.'}</p>
    if (conn.chainId !== chainId) {
      return (
        <>
          <p className="auth-note">Wallet <code>{shortHex(conn.address)}</code> is on {chainName(conn.chainId)}. Porthmos runs on {chainName(chainId)}.</p>
          <button type="button" id="signin-switch-chain" className="pill pill-outline" disabled={switching} onClick={() => switchChain({ chainId: chainId as 31337 | 84532 }).catch((e) => setNote({ tone: 'error', text: plainError(e, 'Your wallet').message }))}>
            {switching ? 'Switching…' : `Switch to ${net(chainId)}`}
          </button>
        </>
      )
    }
    if (mode !== 'live') return <p className="auth-note">Wallet <code>{shortHex(conn.address)}</code> is connected, but no live treasury can be checked against it here. Restore your recovery file, create an account, or view the demo.</p>
    if (identity.kind !== 'wallet') {
      return <p className="auth-note">This browser holds the keys of a treasury with owner <code>{wallet ? shortHex(ownerAddress(wallet)) : ''}</code>, so wallet <code>{shortHex(conn.address)}</code> is not used here. Use the keys in this browser, or forget this device from the account menu first.</p>
    }
    if (walletRole.status === 'loading') return <p className="auth-note" aria-live="polite">Reading the role of <code>{shortHex(conn.address)}</code> from the PolicyRegistry…</p>
    if (!identity.role) return <p className="auth-note">Wallet <code>{shortHex(conn.address)}</code> is neither the owner nor the bank of this treasury, so there is nothing to sign in to.</p>
    const r = identity.role
    return (
      <SignConfirm role={r} address={identity.address} what="a one-line session message" keyName="your wallet" confirmLabel={`Sign in as ${r === 'owner' ? 'owner' : 'bank'}`}
        busy={flow === 'wallet-wait' && session === 'pending'}
        note="Your wallet opens and shows this same message. It costs nothing and moves nothing."
        onCancel={() => setFlow(null)}
        onConfirm={async () => { setFlow('wallet-wait'); await signIn() }}>
        <p>The PolicyRegistry lists this wallet as the {r === 'owner' ? 'owner' : 'bank officer'} of this Safe.</p>
        <pre className="sign-preview">{sessionPreview(r, identity.address, chainId)}</pre>
      </SignConfirm>
    )
  }

  const deviceReady = device.status === 'ready'
  const testKey = deployment.roles[seat]

  return (
    <AuthLayout title="Log in to Porthmos" footer={<>New to Porthmos? <Link to="/signup" id="signin-to-signup">Create an account</Link></>}>
      <form className="auth-section" onSubmit={(e) => { e.preventDefault(); if (deviceReady) startDevice() }}>
        <div>
          <span className="auth-label" id="signin-device-label">Account on this device</span>
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
          <button type="submit" id="signin-continue" className="pill pill-primary" disabled={!deviceReady || (flow === 'device-wait' && session !== 'error')}>
            {flow === 'device-wait' ? 'Signing in…' : 'Continue on this device'}
          </button>
          <button type="button" id="signin-help" className="pill pill-outline" aria-haspopup="dialog" onClick={() => setHelp(true)}>Help</button>
        </div>
        {flow === 'device' && deviceAddress ? (
          <SignConfirm role={seat} address={deviceAddress} what="a one-line session message" confirmLabel={`Sign in as ${seat === 'owner' ? 'owner' : 'bank'}`}
            onCancel={() => setFlow(null)} onConfirm={() => { setFlow('device-wait'); signInLocal(seat) }}>
            <pre className="sign-preview">{sessionPreview(seat, deviceAddress, onboard?.chainId ?? chainId)}</pre>
            <p>It proves you hold the key. It costs nothing and moves nothing.</p>
          </SignConfirm>
        ) : null}
        {flow === 'device-wait' ? <p className={`auth-note${session === 'error' ? ' is-error' : ''}`} aria-live="polite">{session === 'error' ? sessionError : 'Opening your session with the key in this browser…'}</p> : null}
      </form>

      <OrDivider />

      <div className="auth-stack">
        <button type="button" id="signin-wallet" className="pill pill-outline pill-block" disabled={connecting} onClick={connectWallet}>{connecting ? 'Waiting for your wallet…' : 'Connect wallet'}</button>
        {flow === 'wallet' || flow === 'wallet-wait' ? <div className="auth-panel" aria-live="polite">{walletPanel()}{sessionError && flow === 'wallet-wait' ? <p className="auth-note is-error" role="alert">{sessionError}</p> : null}</div> : null}
        <button type="button" id="signin-restore" className="pill pill-outline pill-block" onClick={() => fileRef.current?.click()}>Restore from recovery file</button>
        <input ref={fileRef} id="signin-restore-file" type="file" accept="application/json,.json" hidden onChange={onRestore} />
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
            <SignConfirm role={seat} address={testKey} what="a one-line session message" keyName={`the public Anvil test key for the ${seat === 'owner' ? 'owner' : 'bank'}`} confirmLabel="Sign in with the test key"
              note="Chain 31337 only. Public test keys of the reference treasury; never use them elsewhere."
              onCancel={() => setFlow(null)} onConfirm={() => { setFlow('testkey-wait'); chooseDemo(seat); if (mode !== 'live') refresh('live') }}>
              <pre className="sign-preview">{sessionPreview(seat, testKey, chainId)}</pre>
            </SignConfirm>
          ) : (
            flow === 'testkey-wait' ? <p className={`auth-note${session === 'error' ? ' is-error' : ''}`} aria-live="polite">{session === 'error' ? sessionError : 'Opening a session with the local test key…'}</p> :
            <p className="auth-quiet"><button type="button" id="signin-testkey" className="auth-link auth-link-solo" onClick={() => { setNote(null); setFlow('testkey') }}>Use the local test key (chain 31337)</button></p>
          )
        ) : null}
      </div>

      {note ? (
        <p className={`auth-note${note.tone === 'error' ? ' is-error' : ''}`} role={note.tone === 'error' ? 'alert' : 'status'}>
          {note.text}{note.finish ? <> <Link to="/signup">Finish creating your account</Link>.</> : null}
        </p>
      ) : null}

      <p className="auth-quiet">Judging or just curious? <button type="button" id="signin-demo" className="auth-link" onClick={() => viewDemo(seat, from)}>View the demo</button>, a recorded run of the reference treasury on {net(84532)}. Nothing to sign.</p>

      <Dialog open={help} onClose={() => setHelp(false)} labelledBy={helpId} className="dialog-auth-help">
        <div className="dialog-body">
          <div className="dialog-head">
            <h2 id={helpId}>How signing in works</h2>
            <button type="button" id="signin-help-close" className="button small quiet" onClick={() => setHelp(false)}>Close</button>
          </div>
          <ul className="auth-help">
            <li><strong>No password.</strong> Your account is two keys, owner and bank, kept in this browser. They never go to a server.</li>
            <li><strong>Signing in signs one line of text.</strong> It proves you hold the key. It costs nothing and moves nothing, and you see the exact text first.</li>
            <li><strong>Another browser needs your recovery file.</strong> Restore it there. Without the file, the keys cannot be recovered.</li>
            <li><strong>Test network only.</strong> Porthmos runs on {net(84532)}. Never send real funds to it.</li>
          </ul>
        </div>
      </Dialog>
    </AuthLayout>
  )
}
