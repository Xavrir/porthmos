import { useEffect, useId, useMemo, useRef, useState, type ChangeEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useConnection } from 'wagmi'
import type { Address, Hex } from 'viem'
import { AuthLayout } from '../auth/AuthLayout'
import { useViewDemo } from '../auth/hooks'
import { usePageTitle } from '../components/chrome'
import { SiweConfirm } from '../components/SignConfirm'
import { Term } from '../components/Glossary'
import { keyLabel, useSwitchToApp } from '../components/wallet/AccountMenu'
import { WalletAvatar } from '../components/wallet/WalletAvatar'
import { useWalletPicker } from '../components/wallet/WalletPicker'
import { useAegis } from '../lib/source'
import { useIdentity } from '../lib/identity'
import { bankAddress, connectInjectedOwner, newWallet, ownerAddress, parseWallet, WalletFileError, type WalletFile } from '../lib/keys'
import { downloadRecovery } from '../lib/recovery'
import { publicClientFor } from '../lib/onboard/chain'
import { plainError, type Plain } from '../lib/onboard/errors'
import { initialSteps, OnboardRunner, STEP_LABELS, STEP_WHY, TX_STEPS, type OwnerSession, type StepGroup, type StepState, type WalletPrompt } from '../lib/onboard/runner'
import { burnerOwner, injectedOwner, localSender } from '../lib/onboard/signers'
import type { OnboardConfig } from '../lib/onboard/types'
import { fromUnits, money, shortHex } from '../lib/format'
import { chainName } from '../lib/wallet'

const GROUPS: { id: StepGroup; title: string; what: (c: OnboardConfig) => string }[] = [
  { id: 'fund', title: 'Test ETH for gas', what: () => 'The faucet sends a little test ETH to the owner and the bank key so they can pay for gas. You sign a message; nothing is spent.' },
  { id: 'safe', title: 'Create your Safe', what: () => 'A Safe smart account at an address fixed by your owner address. You are its only owner.' },
  { id: 'module', title: 'Turn on the Porthmos module', what: () => 'The Safe lets the Porthmos module deposit into allowed vaults and redeem back. It can do nothing else.' },
  { id: 'policy', title: 'Write your rules', what: (c) => `Ten calls to the PolicyRegistry: owner and bank, two vaults, the Porthmos keys, an auto cap of ${usd(c.params.autoCap)}, a daily cap of ${usd(c.params.dailyCap)} and a reserve floor of ${usd(c.params.reserveFloor)}.` },
  { id: 'bank', title: 'Bank sets its limit', what: (c) => `The bank key in this browser says above which amount the bank must also sign: ${usd(c.params.bankLimit)}.` },
  { id: 'activate', title: 'Activate and sign in', what: (c) => `You sign in with Ethereum. The server checks every rule on-chain, then sends ${usd(c.testUsdc)} test USDC to your Safe.` },
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

function WalletPlan() {
  return (
    <div className="wallet-plan" id="signup-plan">
      <p className="auth-label">What your wallet will ask</p>
      <ol>
        <li><strong>One signature</strong> to ask the faucet for test ETH. It costs nothing.</li>
        <li><strong>One transaction</strong> to create your Safe.</li>
        <li><strong>Eleven setup calls</strong>: in one confirmation if your wallet can batch them, otherwise one at a time, numbered 1 of 11 to 11 of 11.</li>
        <li><strong>One Sign-In with Ethereum signature</strong> to activate your treasury and sign you in.</li>
      </ol>
      <p className="auth-sub">Each request is explained here while your wallet is open. Porthmos never asks for a token approval here.</p>
    </div>
  )
}

function PromptCard({ prompt }: { prompt: WalletPrompt }) {
  return (
    <div className="wallet-prompt" id="signup-prompt" role="status" aria-live="polite">
      <p className="wallet-prompt-head"><span className="wp-spinner" aria-hidden="true" />Your wallet asks: <strong>{prompt.kind === 'tx' && prompt.index ? `${prompt.title} (step ${prompt.index} of ${prompt.total})` : prompt.title}</strong></p>
      <p>{prompt.why}</p>
      {prompt.kind === 'sign' ? <pre className="sign-preview" tabIndex={0} aria-label="Message your wallet shows">{prompt.text}</pre> : null}
      {prompt.kind === 'tx' ? <p className="auth-sub">To <code>{prompt.to}</code>. No ETH or tokens are sent with it.</p> : null}
      {prompt.kind === 'batch' ? (
        <ol className="wallet-prompt-calls">
          {prompt.calls.map((c) => <li key={c.step}>{c.title} <span className="auth-sub">to <code>{shortHex(c.to)}</code></span></li>)}
        </ol>
      ) : null}
      <p className="auth-sub">Confirm it in your wallet. If you decline, nothing is sent and you can retry.</p>
    </div>
  )
}

export default function SignUp() {
  usePageTitle('Create your account')
  const { http, service, onboard: config, onboardStatus, wallet, setWallet, refresh, tenant, phase, walletRoles, chooseAccount } = useAegis()
  const { signInLocal, signedIn, identity, chooser, adoptSession } = useIdentity()
  const navigate = useNavigate()
  const conn = useConnection()
  const picker = useWalletPicker()
  const sw = useSwitchToApp()
  const [steps, setSteps] = useState<StepState[]>(() => initialSteps(onboardStatus?.steps))
  const [running, setRunning] = useState(false)
  const [failure, setFailure] = useState<Plain | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const [opening, setOpening] = useState<'confirm' | 'signing' | null>(null)
  const [forget, setForget] = useState(false)
  const [prompt, setPrompt] = useState<WalletPrompt | null>(null)
  const [ownerSession, setOwnerSession] = useState<OwnerSession | null>(null)
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
  const viaWallet = wallet?.owner.type === 'injected'
  const wrongChain = !!wallet && !!config && wallet.chainId !== config.chainId
  const activated = steps.find((s) => s.id === 'activate')?.status === 'done' || steps.find((s) => s.id === 'activate')?.status === 'skipped'
  const started = steps.some((s) => s.status !== 'idle')
  const walletMismatch = viaWallet && !!owner && (!conn.address || conn.address.toLowerCase() !== owner.toLowerCase())
  const walletWrongNet = viaWallet && !!conn.address && !!config && conn.chainId !== config.chainId
  const alreadyOwns = !!walletRoles?.owner && !!conn.address && (!owner || owner.toLowerCase() === conn.address.toLowerCase()) && !started

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
          onPrompt: setPrompt,
          onSession: setOwnerSession,
        }, steps)
        runner.current = { r, key }
      }
      await runner.current.r.run()
      refresh('live')
    } catch (e) {
      setFailure((e as { plain?: Plain }).plain ?? plainError(e, w.owner.type === 'injected' ? 'Your wallet' : 'This key'))
    } finally {
      setRunning(false)
      setPrompt(null)
    }
  }

  const begin = () => {
    if (!config) return
    let w = wallet
    if (!w) {
      w = newWallet(config.chainId)
      setWallet(w)
    }
    chooseAccount('file')
    void run(w)
  }

  const connectOwner = async () => {
    if (!config) return
    setNote(null)
    const picked = await picker.open({ reason: 'The wallet you connect becomes the only owner of your new Safe. Connecting shares only your address.' })
    if (!picked) return
    if (walletRoles?.owner && walletRoles.address.toLowerCase() === picked.address.toLowerCase()) return
    const next = connectInjectedOwner(wallet, picked.address as Address, config.chainId, started)
    if ('keep' in next) {
      setNote(`This browser holds the keys of a setup already started for owner ${shortHex(ownerAddress(next.keep))}. Connect that wallet to resume, or download the recovery file and start over with new keys.`)
      return
    }
    if (next.wallet !== wallet) {
      setWallet(next.wallet)
      runner.current = null
    }
    chooseAccount('wallet')
    setNote(next.wallet === wallet
      ? `Your wallet ${shortHex(picked.address)} is the owner. Resuming with the bank key already in this browser.`
      : `Your wallet ${shortHex(picked.address)} is the owner. The bank seat is a key kept in this browser for testnet.`)
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
      chooseAccount('file')
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
  const openTreasury = () => {
    if (signedIn && identity.kind !== 'none' && identity.role === 'owner') { navigate('/treasury'); return }
    if (ownerSession && owner && ownerSession.address.toLowerCase() === owner.toLowerCase()) {
      setOpening('signing')
      adoptSession({ token: ownerSession.token, role: 'owner', address: ownerSession.address, expiresAt: ownerSession.expiresAt })
      if (!viaWallet) signInLocal('owner')
      return
    }
    if (wallet?.owner.type === 'burner') setOpening('confirm')
    else chooser.show('switch', 'owner')
  }

  const startBlock = (config: OnboardConfig) => {
    if (activated) return null
    if (failure) {
      return (
        <div className="step-failure" role="alert">
          <p><strong>Stopped.</strong> {failure.message}</p>
          {failure.retry ? <button type="button" id="signup-retry" className="pill pill-primary" disabled={running || walletMismatch} onClick={() => wallet && run(wallet)}>{running ? 'Working…' : 'Retry this step'}</button> : null}
        </div>
      )
    }
    if (running) {
      return (
        <div className="auth-actions">
          <button type="button" id="signup-create" className="pill pill-primary" disabled>{prompt && prompt.kind !== 'tx' ? 'Confirm in your wallet…' : current?.txIndex ? `Step ${current.txIndex} of ${TX_STEPS.length}…` : 'Working…'}</button>
          {viaWallet ? <span className="auth-note">{txDone} of {TX_STEPS.length} setup calls done.</span> : null}
        </div>
      )
    }
    if (alreadyOwns) {
      return <p className="auth-note" role="status">This wallet already owns a Porthmos treasury. <Link to="/signin">Log in with it</Link>.</p>
    }
    if (!wallet || (!viaWallet && !started)) {
      return (
        <div className="auth-stack">
          <button type="button" id="signup-wallet" className="pill pill-primary pill-block" disabled={!config.onboardingOpen || wrongChain} onClick={() => void connectOwner()}>Connect wallet</button>
          <p className="auth-quiet">Your wallet becomes the owner of a new Safe. The bank seat is a key kept in this browser for testnet.</p>
          <p className="auth-quiet">
            <button type="button" id="signup-test" className="auth-link" disabled={!config.onboardingOpen || wrongChain} onClick={begin}>{wallet ? 'Continue with the test wallet in this browser' : 'Try with a test wallet'}</button>
            {' '}A throwaway owner key made in this browser and saved to a recovery file. No extension, no prompts.
          </p>
        </div>
      )
    }
    if (viaWallet && walletMismatch) {
      return (
        <div className="auth-stack">
          <p className="auth-note">This account's owner is wallet <code>{shortHex(owner!)}</code>. Connect it to continue.</p>
          <button type="button" id="signup-wallet" className="pill pill-primary" onClick={() => void connectOwner()}>Connect wallet</button>
        </div>
      )
    }
    return (
      <div className="auth-stack">
        {viaWallet && owner ? (
          <div className="auth-panel auth-wallet">
            <div className="auth-wallet-id">
              <WalletAvatar address={owner} size={32} />
              <div>
                <p className="auth-wallet-addr"><code>{shortHex(owner)}</code></p>
                <p className={`auth-sub auth-net${walletWrongNet ? ' is-wrong' : ''}`}><span className={`net-dot ${walletWrongNet ? 'is-bad' : 'is-ok'}`} aria-hidden="true" />{chainName(conn.chainId).replace(/ \(\d+\)$/, '')}</p>
              </div>
              {!started ? <button type="button" id="signup-own-wallet" className="auth-link auth-wallet-other" onClick={() => void connectOwner()}>Use a different wallet</button> : null}
            </div>
            {!started ? <WalletPlan /> : null}
          </div>
        ) : null}
        {walletWrongNet ? (
          <button type="button" id="signup-switch-chain" className="pill pill-primary" disabled={sw.isPending} onClick={() => sw.run().catch((e) => setNote(plainError(e, 'Your wallet').message))}>{sw.isPending ? 'Approve in your wallet…' : `Switch to ${network}`}</button>
        ) : (
          <div className="auth-actions">
            <button type="button" id="signup-create" className="pill pill-primary" disabled={wrongChain || (!config.onboardingOpen && !started)} onClick={() => wallet && run(wallet)}>{started ? 'Continue' : 'Create my treasury'}</button>
            {!started ? <span className="auth-note">Free. Test network only.</span> : null}
          </div>
        )}
      </div>
    )
  }

  return (
    <AuthLayout
      title="Create your Porthmos account"
      lede={<>Your wallet is your account: it becomes the owner of a new Safe treasury, then a few short steps set it up. About a minute on {network}. Free, test network only.</>}
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
                  <p>Your treasury is ready: Safe <code className="break">{safe}</code>{mintTx ? <> received its test USDC in <TxLink hash={mintTx} explorer={config.explorer} /></> : null}. The recovery file holds {viaWallet ? 'the bank seat key (your wallet stays the owner)' : 'both keys'}. Without it, no other browser can {viaWallet ? 'use the bank seat' : 'open this treasury'}, and clearing this browser loses it.</p>
                  {wallet ? <button type="button" id="signup-download" className="pill pill-primary" onClick={() => saveFile(wallet)}>{downloaded ? 'Download it again' : 'Download your recovery file'}</button> : null}
                  <label className="auth-check" htmlFor={ackId} aria-disabled={!downloaded}>
                    <input type="checkbox" id={ackId} name="signup-ack" disabled={!downloaded} checked={saved} onChange={(e) => setSaved(e.target.checked)} />
                    <span>I saved my recovery file somewhere safe. Anyone with it controls {viaWallet ? 'the bank seat of' : ''} this test treasury.</span>
                  </label>
                  {opening === 'confirm' && owner && wallet?.owner.type === 'burner' ? (
                    <SiweConfirm role="owner" address={owner} onCancel={() => setOpening(null)} onConfirm={(p) => { setOpening('signing'); signInLocal('owner', p) }} />
                  ) : (
                    <button type="button" id="signup-open" className="pill pill-outline" disabled={!saved || opening === 'signing' || !tenant} onClick={openTreasury}>
                      {opening === 'signing' ? 'Opening…' : tenant ? 'Open my treasury' : 'Loading your treasury…'}
                    </button>
                  )}
                  {ownerSession && !signedIn ? <p className="auth-sub">You already signed in when you activated, so opening needs no new signature.</p> : null}
                </div>
              ) : startBlock(config)}
              {prompt ? <PromptCard prompt={prompt} /> : null}
            </div>
            <ol className="stepper">
              <li className={`step s-${wallet ? 'done' : 'idle'}`}>
                <span className="step-n" aria-hidden="true">1</span>
                <div className="step-body">
                  <p className="step-title"><span>{viaWallet ? 'Your wallet and a bank key' : 'Owner and bank keys'}</span><span className="step-state">{wallet ? 'Done' : 'Waiting'}</span></p>
                  <p className="step-what">{viaWallet ? 'Your wallet is the owner. A bank key is made in this browser so you can also sit in the bank seat on testnet.' : 'An owner key and a bank key, so you can sit in both seats. They never leave this browser.'}</p>
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
                      {hashes.length ? <p className="step-tx">{hashes.length > 1 ? 'Transactions' : 'Transaction'} {[...new Set(hashes)].map((h, k) => <span key={h}>{k ? ', ' : ''}<TxLink hash={h} explorer={config.explorer} /></span>)}</p> : null}
                      {g.id === 'policy' ? (
                        <ol className="substeps">
                          {g.steps.map((s) => (
                            <li key={s.id} className={`s-${s.status}`} title={STEP_WHY[s.id]}>
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
                  <p className="step-what">{viaWallet ? 'One file with the bank seat key. Restore it on another browser to use the bank seat there.' : 'One file with both keys. Restore it on another browser to log in there.'} Required before you enter the app.</p>
                </div>
              </li>
            </ol>
          </section>

          <section className="auth-section auth-keys keys" aria-labelledby="signup-keys-title">
            <h2 id="signup-keys-title">Your keys</h2>
            <p className="keys-warning"><strong>Test network only.</strong> Anyone with the browser keys or the recovery file controls this test treasury's {viaWallet ? 'bank seat' : 'seats'}. Never send real funds to it. No key is ever sent to the server.</p>
            <dl className="facts">
              <div><dt>Owner</dt><dd>{owner ? <><code className="break">{owner}</code><span className="auth-sub"> · {viaWallet ? keyLabel('wallet', 'owner') : keyLabel('local', 'owner')}</span></> : 'Your wallet, or a test key made when you start'}</dd></div>
              <div><dt>Bank</dt><dd>{bank ? <><code className="break">{bank}</code><span className="auth-sub"> · {keyLabel('local', 'bank')}</span></> : 'Made when you start'}</dd></div>
            </dl>
            <div className="row-actions">
              {wallet ? <button type="button" id="signup-keys-download" className="button secondary" onClick={() => saveFile(wallet)}>Download recovery file</button> : null}
              <button type="button" id="signup-import" className="button quiet" onClick={() => fileRef.current?.click()}>Restore from recovery file</button>
              <input ref={fileRef} id={importId} type="file" accept="application/json,.json" hidden onChange={onImport} />
            </div>
            {!started && !running && wallet && !viaWallet ? (
              <div className="own-wallet">
                <p><Term def="An extension such as MetaMask, Rabby or Coinbase Wallet, or a Coinbase Smart Wallet. It becomes the Safe owner and asks you to confirm each request. The bank seat stays a key in this browser.">Use my own wallet</Term> as the owner instead.</p>
                <button type="button" id="signup-own-wallet" className="button small quiet" onClick={() => void connectOwner()}>Use my own wallet</button>
              </div>
            ) : null}
            {note ? <p className="ok-line" role="status">{note}</p> : null}
            {wallet ? (
              forget ? (
                <div className="forget" role="group" aria-label="Forget keys">
                  <p>This removes the keys from this browser. Without the recovery file you lose this test treasury's {viaWallet ? 'bank seat' : 'keys'}.</p>
                  <div className="row-actions">
                    <button type="button" id="signup-forget-confirm" className="button small danger" onClick={() => { setWallet(null); runner.current = null; setForget(false); setFailure(null); setOwnerSession(null); refresh(null) }}>Forget the keys</button>
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
