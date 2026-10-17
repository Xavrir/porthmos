import { useEffect, useId, useMemo, useRef, useState, type ChangeEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useConnect, useConnection, useConnectors } from 'wagmi'
import type { Address, Hex } from 'viem'
import { AuthLayout } from '../auth/AuthLayout'
import { useViewDemo } from '../auth/hooks'
import { usePageTitle } from '../components/chrome'
import { SignConfirm } from '../components/SignConfirm'
import { Term } from '../components/Glossary'
import { useAegis } from '../lib/source'
import { useIdentity } from '../lib/identity'
import { bankAddress, newWallet, ownerAddress, parseWallet, WalletFileError, type WalletFile } from '../lib/keys'
import { downloadRecovery } from '../lib/recovery'
import { publicClientFor } from '../lib/onboard/chain'
import { plainError, type Plain } from '../lib/onboard/errors'
import { initialSteps, OnboardRunner, STEP_LABELS, TX_STEPS, type StepGroup, type StepState } from '../lib/onboard/runner'
import { burnerOwner, injectedOwner, localSender } from '../lib/onboard/signers'
import type { OnboardConfig } from '../lib/onboard/types'
import { fromUnits, money, shortHex } from '../lib/format'
import { chainName } from '../lib/wallet'

const GROUPS: { id: StepGroup; title: string; what: (c: OnboardConfig) => string }[] = [
  { id: 'fund', title: 'Test ETH for gas', what: () => 'The faucet sends a little test ETH to both keys so they can pay for gas. You sign a message; nothing is spent.' },
  { id: 'safe', title: 'Create your Safe', what: () => 'A Safe smart account at an address fixed by your owner key. You are its only owner.' },
  { id: 'module', title: 'Turn on the Porthmos module', what: () => 'The Safe lets the Porthmos module deposit into allowed vaults and redeem back. It can do nothing else.' },
  { id: 'policy', title: 'Write your rules', what: (c) => `Nine calls to the PolicyRegistry: owner and bank, two vaults, the Porthmos keys, an auto cap of ${usd(c.params.autoCap)} and a daily cap of ${usd(c.params.dailyCap)}.` },
  { id: 'bank', title: 'Bank sets its limit', what: (c) => `Your bank key says above which amount the bank must also sign: ${usd(c.params.bankLimit)}.` },
  { id: 'activate', title: 'Activate', what: (c) => `The server checks every rule on-chain, then sends ${usd(c.testUsdc)} test USDC to your Safe.` },
]

function usd(raw: string | number) {
  return money(fromUnits(String(raw)))
}

const STATUS_TEXT: Record<StepState['status'], string> = { idle: 'Waiting', running: 'Working…', done: 'Done', skipped: 'Already done', failed: 'Failed' }

function TxLink({ hash, explorer }: { hash: Hex; explorer: string }) {
  return explorer
    ? <a className="link-plain" href={`${explorer.replace(/\/$/, '')}/tx/${hash}`} target="_blank" rel="noreferrer"><code>{shortHex(hash)}</code><span className="sr-only">, transaction on the block explorer</span></a>
    : <code title={hash}>{shortHex(hash)}</code>
}

function groupStatus(steps: StepState[]): StepState['status'] {
  if (steps.some((s) => s.status === 'failed')) return 'failed'
  if (steps.some((s) => s.status === 'running')) return 'running'
  if (steps.every((s) => s.status === 'skipped')) return 'skipped'
  if (steps.every((s) => s.status === 'done' || s.status === 'skipped')) return 'done'
  return 'idle'
}

export default function SignUp() {
  usePageTitle('Create your account')
  const { http, service, onboard: config, onboardStatus, wallet, setWallet, refresh, tenant, phase } = useAegis()
  const { signInLocal, signedIn, identity, chooser } = useIdentity()
  const navigate = useNavigate()
  const conn = useConnection()
  const connectors = useConnectors()
  const { mutateAsync: connectWallet, isPending: connecting } = useConnect()
  const [steps, setSteps] = useState<StepState[]>(() => initialSteps(onboardStatus?.steps))
  const [running, setRunning] = useState(false)
  const [failure, setFailure] = useState<Plain | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const [opening, setOpening] = useState<'confirm' | 'signing' | null>(null)
  const [forget, setForget] = useState(false)
  const runner = useRef<{ r: OnboardRunner; key: string } | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const importId = useId()
  const ackId = useId()
  const [downloaded, setDownloaded] = useState(false)
  const [saved, setSaved] = useState(false)
  const viewDemo = useViewDemo()
  const saveFile = (w: WalletFile) => { downloadRecovery(w); setDownloaded(true) }

  const owner = wallet ? ownerAddress(wallet) : null
  const bank = wallet ? bankAddress(wallet) : null
  const wrongChain = !!wallet && !!config && wallet.chainId !== config.chainId
  const activated = steps.find((s) => s.id === 'activate')?.status === 'done' || steps.find((s) => s.id === 'activate')?.status === 'skipped'
  const started = steps.some((s) => s.status !== 'idle')

  useEffect(() => {
    if (running || runner.current) return
    setSteps(initialSteps(onboardStatus?.steps))
  }, [onboardStatus, running])

  useEffect(() => {
    if (opening === 'signing' && signedIn && identity.kind !== 'none' && identity.role === 'owner') navigate('/treasury')
  }, [identity, navigate, opening, signedIn])

  const run = async (w: WalletFile) => {
    if (!config) return
    setRunning(true)
    setFailure(null)
    setNote(null)
    try {
      const client = publicClientFor(config.chainId, config.rpcUrl)
      const key = `${ownerAddress(w)}:${bankAddress(w)}`
      if (!runner.current || runner.current.key !== key) {
        const ownerSigner = w.owner.type === 'burner' ? burnerOwner(w.owner.pk, config, client) : await injectedOwner(w.owner.address, config)
        let current = w
        const r = new OnboardRunner({
          config, api: http, client, owner: ownerSigner, bank: localSender(w.bank.pk, config, client), safe: w.safe,
          onSafe: (safe) => { current = { ...current, safe }; setWallet(current) },
          onUpdate: setSteps,
        }, steps)
        runner.current = { r, key }
      }
      await runner.current.r.run()
      refresh('live')
    } catch (e) {
      setFailure((e as { plain?: Plain }).plain ?? plainError(e))
    } finally {
      setRunning(false)
    }
  }

  const begin = () => {
    if (!config) return
    let w = wallet
    if (!w) {
      w = newWallet(config.chainId)
      setWallet(w)
    }
    void run(w)
  }

  const useOwnWallet = async () => {
    if (!config) return
    setNote(null)
    try {
      let address = conn.address
      if (!address) {
        const injected = connectors.find((c) => c.type === 'injected') ?? connectors[0]
        if (!injected) { setNote('No browser wallet found. The burner keys work without one.'); return }
        address = (await connectWallet({ connector: injected })).accounts[0]
      }
      const base = wallet && !started ? wallet : newWallet(config.chainId)
      setWallet({ ...base, owner: { type: 'injected', address: address as Address }, safe: null })
      runner.current = null
      setNote(`Your wallet ${shortHex(address)} is the owner. The bank stays a key in this browser.`)
    } catch (e) {
      setNote(plainError(e, 'Your wallet').message)
    }
  }

  const onImport = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    try {
      const w = parseWallet(await file.text())
      setWallet(w)
      runner.current = null
      setFailure(null)
      setNote(`Imported the keys for owner ${shortHex(ownerAddress(w))}. Checking the chain…`)
      refresh(null)
    } catch (err) {
      setNote(err instanceof WalletFileError ? err.message : 'That file could not be read.')
    }
  }

  const byGroup = useMemo(() => GROUPS.map((g) => ({ ...g, steps: steps.filter((s) => s.group === g.id) })), [steps])
  const current = steps.find((s) => s.status === 'running')
  const txDone = steps.filter((s) => TX_STEPS.includes(s.id) && (s.status === 'done' || s.status === 'skipped')).length
  const doneCount = steps.filter((s) => s.status === 'done' || s.status === 'skipped').length
  const safe = wallet?.safe ?? onboardStatus?.safe ?? null
  const mintTx = steps.find((s) => s.id === 'activate')?.hashes[0]


  const network = config ? chainName(config.chainId).replace(/ \(\d+\)$/, '') : 'Base Sepolia'
  const openTreasury = () => (signedIn && identity.kind !== 'none' && identity.role === 'owner' ? navigate('/treasury') : wallet?.owner.type === 'burner' ? setOpening('confirm') : chooser.show('switch', 'owner'))

  return (
    <AuthLayout
      title="Create your Porthmos account"
      lede={<>Your account is your treasury: two keys made in this browser, then a few short transactions set it up. About a minute on {network}. Free, test network only.</>}
      footer={<>Already have an account? <Link to="/signin" id="signup-to-signin">Log in</Link></>}
    >
      {config ? (
        <div className="auth-section" aria-label="Setup figures" role="group">
          <dl className="auth-meta">
            <div><dt>Network</dt><dd>{network}<span className="auth-sub"> · chain {config.chainId}</span></dd></div>
            <div><dt>Progress</dt><dd>{doneCount} of {steps.length}</dd></div>
            <div><dt>Your Safe</dt><dd>{safe ? shortHex(safe) : 'Not yet'}</dd></div>
            <div><dt>Test USDC</dt><dd>{usd(config.testUsdc)}</dd></div>
          </dl>
          <div className="auth-bar" role="progressbar" aria-label={`Setup progress, ${doneCount} of ${steps.length} steps`} aria-valuemin={0} aria-valuemax={steps.length} aria-valuenow={doneCount}>
            <span style={{ width: `${(doneCount / Math.max(1, steps.length)) * 100}%` }} />
          </div>
          {running && current?.txIndex ? null : <p className="auth-note">{running ? STEP_LABELS[current?.id ?? 'fund'] : activated ? 'Ready' : started ? 'Paused. Finished steps are read from the chain and skipped.' : 'Not started'}</p>}
        </div>
      ) : null}

      {phase === 'probing' && !config ? <p className="auth-note" aria-live="polite">Reaching the Porthmos service…</p> : service !== 'up' ? (
        <section className="gate-block" aria-labelledby="down-title">
          <h2 id="down-title">The Porthmos service is not answering</h2>
          <p>Creating an account needs the service for test ETH and activation. {wallet ? 'Your keys are still in this browser, and anything already on-chain stays there.' : 'Nothing has been made yet.'}</p>
          <div className="auth-actions">
            <button type="button" id="signup-retry-service" className="pill pill-primary" onClick={() => refresh(null)}>Try again</button>
            <button type="button" id="signup-demo" className="pill pill-outline" onClick={() => viewDemo('owner')}>View the demo</button>
          </div>
        </section>
      ) : !config ? (
        <section className="gate-block" aria-labelledby="old-title">
          <h2 id="old-title">This service does not create accounts</h2>
          <p>The connected Porthmos service has no onboarding. You can still view the recorded run.</p>
          <button type="button" id="signup-demo" className="pill pill-outline" onClick={() => viewDemo('owner')}>View the demo</button>
        </section>
      ) : (
        <>
          {!config.onboardingOpen && !started ? (
            <p className="alert-inline" role="alert">New treasuries are closed for now: the test network limit is reached. You can still view the recorded run.</p>
          ) : null}
          {wrongChain ? (
            <p className="alert-inline" role="alert">These keys were made for chain {wallet!.chainId}, but this service runs chain {config.chainId}. Download them if you need them, then start over.</p>
          ) : null}

          <section className="auth-section" aria-labelledby="signup-steps-title">
            <h2 id="signup-steps-title" className="sr-only">Steps</h2>
            <div className="start-actions" aria-live="polite">
              {activated ? (
                <div className="auth-recovery" id="signup-recovery">
                  <h2>Download your recovery file</h2>
                  <p>Your treasury is ready: Safe <code className="break">{safe}</code>{mintTx ? <> received its test USDC in <TxLink hash={mintTx} explorer={config.explorer} /></> : null}. The recovery file holds both keys. Without it, no other browser can open this treasury, and clearing this browser loses it.</p>
                  {wallet ? <button type="button" id="signup-download" className="pill pill-primary" onClick={() => saveFile(wallet)}>{downloaded ? 'Download it again' : 'Download your recovery file'}</button> : null}
                  <label className="auth-check" htmlFor={ackId} aria-disabled={!downloaded}>
                    <input type="checkbox" id={ackId} name="signup-ack" disabled={!downloaded} checked={saved} onChange={(e) => setSaved(e.target.checked)} />
                    <span>I saved my recovery file somewhere safe. Anyone with it controls this test treasury.</span>
                  </label>
                  {opening === 'confirm' && owner && wallet?.owner.type === 'burner' ? (
                    <SignConfirm role="owner" address={owner} what="a one-line session message" confirmLabel="Sign in as owner" onCancel={() => setOpening(null)}
                      onConfirm={() => { setOpening('signing'); signInLocal('owner') }}>
                      <pre className="sign-preview">{`AEGIS session\nrole: owner\naddress: ${owner}\nchainId: ${config.chainId}\nissuedAt: the time you press Sign in`}</pre>
                    </SignConfirm>
                  ) : (
                    <button type="button" id="signup-open" className="pill pill-outline" disabled={!saved || opening === 'signing' || !tenant} onClick={openTreasury}>
                      {opening === 'signing' ? 'Signing in…' : tenant ? 'Open my treasury' : 'Loading your treasury…'}
                    </button>
                  )}
                </div>
              ) : failure ? (
                <div className="step-failure" role="alert">
                  <p><strong>Stopped.</strong> {failure.message}</p>
                  {failure.retry ? <button type="button" id="signup-retry" className="pill pill-primary" disabled={running} onClick={() => wallet && run(wallet)}>{running ? 'Working…' : 'Retry this step'}</button> : null}
                </div>
              ) : (
                <div className="auth-actions">
                  <button type="button" id="signup-create" className="pill pill-primary" disabled={running || wrongChain || (!config.onboardingOpen && !started)} onClick={begin}>
                    {running ? (current?.txIndex ? `Transaction ${current.txIndex} of ${TX_STEPS.length}…` : 'Working…') : started ? 'Continue' : 'Create my treasury'}
                  </button>
                  {running && wallet?.owner.type === 'injected' ? <span className="auth-note">Confirm each request in your wallet. {txDone} of {TX_STEPS.length} sent.</span> : null}
                  {!running && !started ? <span className="auth-note">Free. Test network only.</span> : null}
                </div>
              )}
            </div>
            <ol className="stepper">
              <li className={`step s-${wallet ? 'done' : 'idle'}`}>
                <span className="step-n" aria-hidden="true">1</span>
                <div className="step-body">
                  <p className="step-title"><span>Two keys in this browser</span><span className="step-state">{wallet ? 'Done' : 'Waiting'}</span></p>
                  <p className="step-what">An owner key and a bank key, so you can sit in both seats. They never leave this browser.</p>
                </div>
              </li>
              {byGroup.map((g, i) => {
                const st = groupStatus(g.steps)
                const hashes = g.id === 'policy' ? [] : g.steps.flatMap((s) => s.hashes)
                const err = g.steps.find((s) => s.error)?.error
                return (
                  <li key={g.id} className={`step s-${st}`} aria-current={st === 'running' ? 'step' : undefined}>
                    <span className="step-n" aria-hidden="true">{i + 2}</span>
                    <div className="step-body">
                      <p className="step-title"><span>{g.title}</span><span className="step-state">{STATUS_TEXT[st]}</span></p>
                      <p className="step-what">{g.what(config)}</p>
                      {g.id === 'safe' && safe ? <p className="step-tx">Address <code className="break">{safe}</code></p> : null}
                      {hashes.length ? <p className="step-tx">{hashes.length > 1 ? 'Transactions' : 'Transaction'} {hashes.map((h, k) => <span key={h}>{k ? ', ' : ''}<TxLink hash={h} explorer={config.explorer} /></span>)}</p> : null}
                      {g.id === 'policy' ? (
                        <ol className="substeps">
                          {g.steps.map((s) => (
                            <li key={s.id} className={`s-${s.status}`}>
                              <span className="sub-label"><span className="nums sub-n">{s.txIndex! - 1}.</span> {s.label}</span>
                              <span className="sub-state">{s.hashes[0] ? <TxLink hash={s.hashes[s.hashes.length - 1]} explorer={config.explorer} /> : null} {STATUS_TEXT[s.status]}</span>
                            </li>
                          ))}
                        </ol>
                      ) : null}
                      {err && st === 'failed' ? <p className="step-error">{err.message}</p> : null}
                    </div>
                  </li>
                )
              })}
              <li className={`step s-${saved ? 'done' : 'idle'}`}>
                <span className="step-n" aria-hidden="true">{byGroup.length + 2}</span>
                <div className="step-body">
                  <p className="step-title"><span>Download your recovery file</span><span className="step-state">{saved ? 'Done' : 'Waiting'}</span></p>
                  <p className="step-what">One file with both keys. Restore it on another browser to log in there. Required before you enter the app.</p>
                </div>
              </li>
            </ol>
          </section>

          <section className="auth-section auth-keys keys" aria-labelledby="signup-keys-title">
            <h2 id="signup-keys-title">Your keys</h2>
            <p className="keys-warning"><strong>Test network only.</strong> Anyone with these keys or the recovery file controls this test treasury. Never send real funds to it. No key is ever sent to the server.</p>
            <dl className="facts">
              <div><dt>Owner</dt><dd>{owner ? <><code className="break">{owner}</code>{wallet?.owner.type === 'injected' ? ' (your wallet)' : ''}</> : 'Made when you start'}</dd></div>
              <div><dt>Bank</dt><dd>{bank ? <code className="break">{bank}</code> : 'Made when you start'}</dd></div>
            </dl>
            <div className="row-actions">
              {wallet ? <button type="button" id="signup-keys-download" className="button secondary" onClick={() => saveFile(wallet)}>Download recovery file</button> : null}
              <button type="button" id="signup-import" className="button quiet" onClick={() => fileRef.current?.click()}>Restore from recovery file</button>
              <input ref={fileRef} id={importId} type="file" accept="application/json,.json" hidden onChange={onImport} />
            </div>
            {!started && !running ? (
              <div className="own-wallet">
                <p><Term def="An extension such as MetaMask, Rabby or Coinbase Wallet. It becomes the Safe owner and asks you to confirm each transaction. The bank always stays a key in this browser.">Use my own wallet</Term> as the owner instead.</p>
                <button type="button" id="signup-own-wallet" className="button small quiet" disabled={connecting} onClick={useOwnWallet}>{connecting ? 'Waiting for the wallet…' : wallet?.owner.type === 'injected' ? 'Use a different wallet' : 'Use my own wallet'}</button>
              </div>
            ) : null}
            {note ? <p className="ok-line" role="status">{note}</p> : null}
            {wallet ? (
              forget ? (
                <div className="forget" role="group" aria-label="Forget keys">
                  <p>This removes both keys from this browser. Without the recovery file you lose this test treasury.</p>
                  <div className="row-actions">
                    <button type="button" id="signup-forget-confirm" className="button small danger" onClick={() => { setWallet(null); runner.current = null; setForget(false); setFailure(null); refresh(null) }}>Forget the keys</button>
                    <button type="button" className="button small quiet" onClick={() => setForget(false)}>Keep them</button>
                  </div>
                </div>
              ) : <button type="button" id="signup-forget" className="link-plain forget-link" disabled={running} onClick={() => setForget(true)}>Start over with new keys</button>
            ) : null}
          </section>
        </>
      )}
    </AuthLayout>
  )
}
