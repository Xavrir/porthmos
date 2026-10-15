import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import type { Address } from 'viem'
import { ModeIndicator, usePageTitle } from '../components/chrome'
import { GlossaryButton } from '../components/Glossary'
import { RecordSheet } from '../components/RecordSheet'
import { ChainStrip } from '../components/ChainStrip'
import { ChapterRail } from '../components/ChapterRail'
import { CountText } from '../components/Count'
import { Gates } from '../components/Gates'
import { ReserveBar } from '../components/ReserveBar'
import { TierLab } from '../components/TierLab'
import { useAegis } from '../lib/source'
import { useIdentity } from '../lib/identity'
import { useBaseSepoliaLive } from '../lib/chain/live'
import { CONTRACT_SUITE, REFUSALS, chainFacts, proofFor, scheduledAfter, SCHEDULED_SCENARIOS } from '../lib/proof'
import { useLedger, useObligations, useOracle, usePendingApprovals, useRisk, useTreasury } from '../lib/queries'
import { day, money, num } from '../lib/format'
import { verifyLinks } from '../lib/reconcile'
import { recorded } from '../replay/fixtures'
import { REPLAY_DEPLOY } from '../lib/deployment'
import type { SignedRecord } from '../lib/types'

const R = REPLAY_DEPLOY
const NAMES: Record<string, string> = {
  [R.safe.toLowerCase()]: 'Safe',
  [R.vaultA.toLowerCase()]: 'Vault A',
  [R.vaultB.toLowerCase()]: 'Vault B',
}

function signerOf(id: Parameters<typeof recorded>[0], role: string) {
  return { address: recorded(id).signer as Address, label: `${role} key that signed it` }
}

type Output = { key: string; name: string; record: SignedRecord; expected: { address: Address; label: string }; changed?: Record<string, string>; caption: string }

const OUTPUTS: Output[] = [
  { key: 'dar', name: 'Decision record', record: recorded('dar-e1'), expected: signerOf('dar-e1', 'authorizer'), caption: 'E1: the first deposit into Vault B, 2,000.00. Tier 3, so it carries the hash of the owner’s approval. The deposit itself is on Base Sepolia.' },
  { key: 'approval', name: 'Owner approval', record: recorded('apr-e1'), expected: signerOf('apr-e1', 'owner'), caption: 'What the owner signs: a ceiling, a vault, a policy version and 24 hours. The agent fills in the market data later.' },
  { key: 'exit', name: 'Exit record', record: recorded('dar-e5-exit'), expected: signerOf('dar-e5-exit', 'exit key'), caption: 'From the replay’s freeze drill: signed by the exit key, which can only redeem back to the Safe, so a freeze does not stop it.' },
  { key: 'tampered', name: 'Tampered record', record: recorded('dar-e4a'), expected: signerOf('dar-e4a', 'authorizer'), changed: { amount: '4000000000' }, caption: 'Signed for 900.00, submitted as 4,000.00. Your browser recovers the signer from the edited fields and gets a stranger.' },
]

const INCIDENTS = [
  { name: 'Freysa', when: 'Nov 2024', loss: 'about USD 47,000', what: 'Talked into a transfer by a chat message.' },
  { name: 'Lobstar Wilde', when: 'Feb 2026', loss: 'about USD 440,000', what: 'A unit error. No attacker was involved.' },
  { name: 'Bankr', when: 'May 2026', loss: null, what: 'Executed an encoded instruction relayed by another agent.' },
]

function age(s: number): string {
  if (s < 90) return `${s} s`
  if (s < 5400) return `${Math.round(s / 60)} min`
  if (s < 172800) return `${Math.round(s / 3600)} h`
  return `${Math.round(s / 86400)} d`
}

export function Landing() {
  usePageTitle(null)
  const { mode, deployment, chainId } = useAegis()
  const { chooser } = useIdentity()
  const live = useBaseSepoliaLive()
  const t = useTreasury()
  const o = useOracle()
  const risk = useRisk()
  const obligations = useObligations()
  const pending = usePendingApprovals()
  const ledger = useLedger()
  const [out, setOut] = useState(0)
  const videoRef = useRef<HTMLVideoElement>(null)

  useEffect(() => {
    const v = videoRef.current
    if (!v) return
    const calm = matchMedia('(prefers-reduced-motion: reduce)')
    const sync = () => { if (calm.matches) v.pause(); else v.play().catch(() => undefined) }
    sync()
    calm.addEventListener('change', sync)
    return () => calm.removeEventListener('change', sync)
  }, [])

  const rootRef = useRef<HTMLElement>(null)
  useEffect(() => {
    const root = rootRef.current
    if (!root) return
    let stop: (() => void) | null = null
    let cancelled = false
    const release = () => document.documentElement.classList.remove('motion-pending')
    Promise.all([import('./landingMotion'), document.fonts?.ready ?? Promise.resolve()])
      .then(([m]) => { if (!cancelled) stop = m.initLandingMotion(root) })
      .catch(release)
    return () => { cancelled = true; stop?.(); release() }
  }, [])

  const tr = t.data
  const chainOk = useMemo(() => (ledger.data ? [...verifyLinks(ledger.data).values()].every(Boolean) : null), [ledger.data])
  const waiting = pending.data?.[0]
  const frozen = tr ? tr.policy.frozen.bank || tr.policy.frozen.owner : false
  const triggers = risk.data?.vaults.flatMap((v) => v.triggers) ?? []
  const vaultB = risk.data?.vaults[1]

  const onChain = mode === 'replay' && live.status === 'live'
  const src = mode === 'live' ? 'Live service' : onChain ? 'Base Sepolia now' : 'Replay'
  const liveTotal = onChain && live.safeUsdc !== null && live.vaults ? live.safeUsdc + live.vaults.reduce((a, v) => a + v.assets, 0) : null
  const liveQuarantined = onChain && live.vaults ? live.vaults.filter((v) => v.quarantined).length : 0
  const liveFrozen = onChain && live.frozen ? live.frozen.bank || live.frozen.owner : null

  const swatches = [
    {
      to: '/treasury', label: 'Treasury', cls: 's-surface', src,
      value: liveTotal !== null ? `${money(liveTotal)} USDC` : tr ? `${tr.balances.total.display} USDC` : '…',
      sub: onChain && live.floor !== null ? `Reserve floor ${money(live.floor)}` : tr ? `Reserve floor ${tr.reserve.onchainFloor.display}` : '',
    },
    {
      to: '/risk', label: 'Risk', cls: 's-red', src,
      value: onChain && live.price !== null ? `Peg ${live.price.toFixed(4)}` : o.data ? `Peg ${o.data.price.display}` : '…',
      sub: onChain ? (liveQuarantined ? `${liveQuarantined} vault${liveQuarantined > 1 ? 's' : ''} quarantined` : `Price ${age(live.ageSeconds ?? 0)} old`) : triggers.length ? `${triggers.length} trigger${triggers.length > 1 ? 's' : ''} firing` : o.data ? `Price ${o.data.ageSeconds} s old` : '',
    },
    {
      to: '/copilot', label: 'Copilot', cls: 's-blue', src: mode === 'live' ? 'Live service' : 'Replay',
      value: pending.data ? `${pending.data.length} waiting` : '…',
      sub: waiting ? `${waiting.actionCard.amount.display} into ${waiting.actionCard.vault.name}` : 'No approvals due',
    },
    {
      to: '/bank', label: 'Bank desk', cls: 's-navy', src,
      value: liveFrozen !== null ? (liveFrozen ? 'Frozen' : 'Not frozen') : tr ? (frozen ? 'Frozen' : 'Not frozen') : '…',
      sub: onChain && live.policyVersion !== null ? `Policy v${live.policyVersion}` : tr ? `Policy v${tr.policy.version}` : '',
    },
    {
      to: '/audit', label: 'Audit', cls: 's-black', src: mode === 'live' ? 'Live service' : 'Replay',
      value: ledger.data ? `${ledger.data.length} rows` : '…',
      sub: chainOk === null ? '' : chainOk ? 'Hash chain intact' : 'Hash chain broken',
    },
  ]

  const obligationLines = (obligations.data ?? []).filter((x) => !x.settled)
  const reserveTotal = tr ? tr.reserve.required.display : '4,500.00'
  const buffer = tr?.reserve.buffer?.display ?? '500.00'
  const facts = chainFacts()
  const after = scheduledAfter()

  return (
    <main id="main" className="landing" ref={rootRef}>
      <section className="hero" aria-labelledby="hero-title">
        <div className="hero-panel">
          <img className="hero-img" src="/media/time-lock-yale.jpg" width={1920} height={1448} fetchPriority="high" decoding="async"
            alt="A Yale bank vault time lock: three clock movements side by side behind a steel bar, with an emergency release label" />
          <div className="hero-top">
            <Link to="/" className="hero-wordmark" aria-label="AEGIS Treasury, overview">AEGIS Treasury</Link>
            <ModeIndicator />
          </div>
          <div className="hero-head">
            <h1 id="hero-title">Know when<br /> not to act</h1>
          </div>
          <p className="hero-lede">An AI agent runs a business’s stablecoin treasury under its bank’s risk desk: cash kept for what you owe, the rest earning, every action proven.</p>
          <div className="hero-actions">
            <a href="#proof" className="button hero-action">See the on-chain proof</a>
            <button type="button" className="button light hero-action" onClick={() => chooser.show('hero')}>Try it as owner or bank</button>
          </div>
        </div>
        <nav className="swatches" aria-label="The system now">
          {swatches.map((s, i) => (
            <Link key={s.to} to={s.to} className={`swatch ${s.cls}`} style={{ ['--i' as string]: i }}>
              <span className="swatch-label">{s.label}<span className="swatch-src">{s.src}</span></span>
              <span className="swatch-value nums">{s.value}</span>
              {s.sub ? <span className="swatch-sub">{s.sub}</span> : null}
            </Link>
          ))}
        </nav>
        <ChainStrip live={live} />
      </section>

      <ChapterRail />

      <section className="ch ch-black on-dark intro" id="valid" data-chapter="Valid, and still wrong" data-ink="#ffffff" aria-labelledby="intro-title">
        <div className="wrap intro-grid">
          <h2 id="intro-title" className="intro-title">Valid, and still wrong</h2>
          <p className="statement">
            Agents with wallets were talked into transfers, made unit errors and obeyed relayed orders. Each transaction was valid. <span className="mark">The decision behind it was not.<span className="mark-bar" aria-hidden="true" /></span>
          </p>
          <ul className="incidents">
            {INCIDENTS.map((x) => (
              <li key={x.name}>
                <span className="incident-name">{x.name}</span>
                <span className="incident-when nums">{x.when}{x.loss ? `, ${x.loss}` : ''}</span>
                <span className="incident-what">{x.what}</span>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className="ch ch-black on-dark proof" id="proof" data-chapter="Refused by the contract" data-ink="#ffffff" aria-labelledby="proof-title">
        <div className="wrap">
          <div className="proof-top">
            <div className="proof-intro">
              <h2 id="proof-title" className="proof-title">Refused by the contract</h2>
              <p>
                A bad record never reaches the vault: the module reverts with a typed error and nothing moves.{' '}
                {SCHEDULED_SCENARIOS.length
                  ? <>The attack runs on Base Sepolia ({SCHEDULED_SCENARIOS.join(', ')}) are scheduled{after ? ` after ${after}, when the vault quarantine from E2 ends` : ''}, so no reverted transaction exists for them yet. Today they are proven by {CONTRACT_SUITE.count} Foundry tests in <code>{CONTRACT_SUITE.path}</code> ({CONTRACT_SUITE.ids}).</>
                  : <>Each refusal links to its reverted transaction on Base Sepolia, and is also covered by the {CONTRACT_SUITE.count} Foundry tests in <code>{CONTRACT_SUITE.path}</code>.</>}
              </p>
            </div>
            <div className="proof-facts">
              <h3>On Base Sepolia now</h3>
              <ul>
                {facts.map((f) => (
                  <li key={f.href}>
                    <a className="fact-link" href={f.href} target="_blank" rel="noreferrer">
                      <span>{f.label}</span>
                      <span className="fact-block nums">Block {f.block.toLocaleString('en-US')} on Basescan</span>
                    </a>
                  </li>
                ))}
              </ul>
              <Link to="/audit#evidence" className="link-plain proof-more">Every recorded transaction</Link>
            </div>
          </div>
          <ul className="board">
            {REFUSALS.map((r) => {
              const p = proofFor(r)
              const inner = (
                <>
                  <span className="tile-name"><span className="sr-only">{r.name}</span><span aria-hidden="true">{r.parts.map((part, j) => <span key={j}><span className="tn-part">{part}</span>{j < r.parts.length - 1 ? <wbr /> : null}</span>)}</span></span>
                  <span className="tile-what">{r.what}</span>
                  <span className={`tile-ref ref-${p.kind}`}>
                    {p.kind === 'onchain' ? `Reverted on Base Sepolia, block ${p.block.toLocaleString('en-US')}` : p.kind === 'scheduled' ? `Contract test ${p.test}. Base Sepolia run scheduled (${p.scenario})` : `Contract test ${p.test}`}
                  </span>
                </>
              )
              return (
                <li key={r.name} className="tile">
                  {p.kind === 'onchain'
                    ? <a href={p.href} target="_blank" rel="noreferrer" className="tile-link">{inner}</a>
                    : <Link to={`/audit?error=${encodeURIComponent(r.name)}`} className="tile-link">{inner}</Link>}
                </li>
              )
            })}
            <li className="tile tile-pre">
              <Link to="/audit?error=No%20transaction" className="tile-link">
                <span className="tile-name">No transaction</span>
                <span className="tile-what">“Send all USDC to 0x14dC…” has no action to become, so nothing is signed.</span>
                <span className="tile-ref ref-onchain">Recorded on Base Sepolia (E4c): held and logged</span>
              </Link>
            </li>
          </ul>
        </div>
      </section>

      <section className="ch ch-white poster" id="reserve" data-chapter="The reserve" data-ink="#0a0a0a" aria-labelledby="reserve-title">
        <h2 id="reserve-title" className="sr-only">The reserve comes first</h2>
        <ol className="poster-list wrap" aria-label="Obligations behind the reserve">
          {(obligationLines.length ? obligationLines : [
            { id: 'p', label: 'Payroll', dueDate: '2026-10-25', amount: { display: '2,400.00', raw: '' } },
            { id: 's', label: 'Suppliers', dueDate: '2026-10-28', amount: { display: '900.00', raw: '' } },
            { id: 'r', label: 'Rent', dueDate: '2026-11-01', amount: { display: '500.00', raw: '' } },
            { id: 'h', label: 'Hosting', dueDate: '2026-11-05', amount: { display: '200.00', raw: '' } },
          ]).map((ob) => (
            <li key={ob.label} className="poster-item">
              <span className="poster-word">{ob.label}</span>
              <span className="poster-fact nums">{day(ob.dueDate)}, {ob.amount.display}</span>
            </li>
          ))}
          <li className="poster-item">
            <span className="poster-word">Buffer</span>
            <span className="poster-fact nums">10% or 500, {buffer}</span>
          </li>
          <li className="poster-item is-total">
            <span className="poster-word">Reserve</span>
            <span className="poster-fact nums">{reserveTotal}, held on-chain</span>
          </li>
        </ol>
        <div className="wrap poster-foot">
          {tr ? (
            <div className="poster-split">
              <div className="ps-figures">
                <p className="ps-fig"><CountText className="ps-num nums" text={tr.reserve.onchainFloor.display} fromZero /><span className="ps-label">reserve, held on-chain</span></p>
                <p className="ps-fig"><CountText className="ps-num nums" text={tr.deployable.display} fromZero /><span className="ps-label">deployable after reserve and fees</span></p>
              </div>
              <ReserveBar t={tr} labelled={false} />
            </div>
          ) : null}
          <p data-reveal>
            The reserve is the largest shortfall the payment calendar can produce, plus a buffer. The owner signs it on-chain as the floor. A deposit that would leave the Safe below it reverts <code>ReserveFloorBreached</code>, whoever signed it.
          </p>
          <Link to="/treasury" className="link-plain" data-reveal style={{ ['--i' as string]: 1 }}>See the treasury and its calendar</Link>
        </div>
      </section>

      <Gates />

      <section className="ch ch-white records" id="records" data-chapter="What gets signed" data-ink="#0a0a0a" aria-labelledby="records-title">
        <div className="wrap records-grid">
          <div className="records-index">
            <h2 id="records-title" className="sr-only">What gets signed</h2>
            <div className="records-names" role="tablist" aria-label="Signed records">
              {OUTPUTS.map((x, i) => (
                <button key={x.key} type="button" role="tab" id={`rec-tab-${x.key}`} aria-selected={out === i} aria-controls="rec-panel" className={out === i ? 'is-on' : ''} onClick={() => setOut(i)}
                  onKeyDown={(e) => {
                    if (e.key === 'ArrowDown' || e.key === 'ArrowRight') { e.preventDefault(); setOut((out + 1) % OUTPUTS.length); document.getElementById(`rec-tab-${OUTPUTS[(out + 1) % OUTPUTS.length].key}`)?.focus() }
                    if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') { e.preventDefault(); setOut((out + OUTPUTS.length - 1) % OUTPUTS.length); document.getElementById(`rec-tab-${OUTPUTS[(out + OUTPUTS.length - 1) % OUTPUTS.length].key}`)?.focus() }
                  }}
                  tabIndex={out === i ? 0 : -1}>
                  {x.name}
                </button>
              ))}
            </div>
            <p className="records-caption" aria-live="polite">{OUTPUTS[out].caption}</p>
            <div className="records-note">Every action is a typed record signed under EIP-712: change any field and the signature recovers to someone else. These records come from the replay run and are recovered live in this page. The E1 deposit is a recorded Base Sepolia transaction; the signatures shown here are illustrative. <GlossaryButton className="link-plain terms-inline" label="What do DAR, EIP-712 and nonce mean?" /></div>
          </div>
          <div className="records-stage" id="rec-panel" role="tabpanel" aria-labelledby={`rec-tab-${OUTPUTS[out].key}`}>
            <div className="records-sheet" key={OUTPUTS[out].key}>
              <RecordSheet illustrative record={OUTPUTS[out].record} chainId={R.chainId} module={R.module} expected={OUTPUTS[out].expected} names={NAMES} changed={OUTPUTS[out].changed} />
            </div>
          </div>
        </div>
      </section>

      <section className="ch ch-red leaves" id="leaves" data-chapter="It leaves first" data-ink="#0a0a0a" aria-labelledby="leaves-title">
        <div className="wrap leaves-grid">
          <div className="leaves-pin">
            <h2 id="leaves-title" className="leaves-title">It leaves first</h2>
            <p className="leaves-lede">The Exit Agent checks three triggers every five blocks. Any one quarantines the vault and redeems back to the Safe with a key that can do nothing else.</p>
            <Link to="/risk" className="link-plain leaves-more">Run a depeg in the stress lab</Link>
          </div>
          <div className="leaves-blocks">
            <article className="leave">
              <h3>The peg slips past 1%</h3>
              <div className="leave-row">
                <img src="/media/time-lock-brass.jpg" width={1920} height={1553} loading="lazy" decoding="async" alt="A brass bank time lock with three clock dials behind glass" />
                <ul>
                  <li>Price more than 1.00% from 1.0000</li>
                  <li>Quarantined, then redeemed for at least 99.5%</li>
                  <li>Cleared only by the owner, after 24 quiet hours</li>
                  <li className="leave-now nums">Now: {o.data ? `${o.data.price.display}, ${(Math.abs(Number(o.data.price.display) - 1) * 100).toFixed(2)}% from peg` : 'reading the feed…'}</li>
                </ul>
              </div>
            </article>
            <article className="leave">
              <h3>The price goes quiet</h3>
              <div className="leave-row">
                <video ref={videoRef} autoPlay muted loop playsInline preload="metadata" poster="/media/clock-mechanism-poster.jpg" width={854} height={480} aria-hidden="true">
                  <source src="/media/clock-mechanism.webm" type="video/webm" />
                  <source src="/media/clock-mechanism.mp4" type="video/mp4" />
                </video>
                <ul>
                  <li>Older than 180 s counts as stale</li>
                  <li>Deposits revert <code>StaleOracle</code></li>
                  <li>Exits still run on a stale price</li>
                  <li className="leave-now nums">Now: {o.data ? `last update ${o.data.ageSeconds} s ago${o.data.stale ? ', stale' : ''}` : 'reading the feed…'}</li>
                </ul>
              </div>
            </article>
            <article className="leave">
              <h3>The exit door narrows</h3>
              <div className="leave-row">
                <img src="/media/safe-patent-1826.jpg" width={1920} height={1420} loading="lazy" decoding="async" alt="Jesse Delano’s 1826 patent drawing of an iron safe, shown open and closed, with handwritten notes" />
                <ul>
                  <li>Withdrawable below 1.2 × the position</li>
                  <li>Takes what can leave now, retries the rest</li>
                  <li>Alerts the owner and the bank at zero</li>
                  <li className="leave-now nums">Now: {vaultB ? `${vaultB.name} lets ${vaultB.maxRedeem.display} leave` : 'reading the vaults…'}</li>
                </ul>
              </div>
            </article>
            <article className="leave">
              <h3>Exits never wait</h3>
              <div className="leave-row">
                <img src="/media/safe-patent-1836.jpg" width={1920} height={1408} loading="lazy" decoding="async" alt="James Matthews’ 1836 patent drawing of a fire-proof safe with an inner brick chamber" />
                <ul>
                  <li>Redemptions skip freezes and policy changes</li>
                  <li>The receiver is always the Safe</li>
                  <li>The exit key cannot deposit</li>
                  <li className="leave-now">Now: {triggers.length ? triggers[0] : 'no trigger firing'}</li>
                </ul>
              </div>
            </article>
          </div>
        </div>
      </section>

      <section className="ch ch-white tiers" id="tiers" data-chapter="How much can it move alone" data-ink="#0a0a0a" aria-labelledby="tiers-title">
        <div className="wrap">
          <h2 id="tiers-title" className="tiers-title" data-reveal>How much can it move alone?</h2>
          <TierLab />
        </div>
      </section>

      <section className="bankpanel-wrap" id="bank" data-chapter="The bank’s freeze" data-ink="#0a0a0a" aria-labelledby="bank-title">
        <div className="bankpanel on-dark">
          <div className="bp-left">
            <h2 id="bank-title" className="bp-title">Only the bank lifts its freeze</h2>
            <div className="bp-door">
              <img src="/media/vault-door.jpg" width={1560} height={1560} loading="lazy" decoding="async" alt="The round steel door of a bank vault, its locking bolts radiating from the centre" />
            </div>
          </div>
          <div className="bp-right">
            <div className="bp-block">
              <h3>Freeze</h3>
              <p>The bank’s risk officer can stop every deposit for a client in one transaction. The owner cannot lift it. Exits keep running, so a freeze never traps funds in a failing vault.</p>
            </div>
            <div className="bp-block">
              <h3>Revoke</h3>
              <p>Revoking the agent’s signer also sets the bank freeze. The bank can tighten caps and quarantine a vault; it can never move funds or add a vault.</p>
            </div>
            <p className="bp-now nums">
              Now{onChain && liveFrozen !== null ? ' on Base Sepolia' : ''}: {onChain && liveFrozen !== null ? `${liveFrozen ? 'deposits frozen' : 'not frozen'}, policy v${live.policyVersion}` : tr ? `${frozen ? 'deposits frozen' : 'not frozen'}, authorizer ${tr.policy.authorizerRevoked ? 'revoked' : 'active'}, policy v${tr.policy.version}` : 'reading the registry…'}
            </p>
            <Link to="/bank" className="button">Open the bank desk</Link>
          </div>
        </div>
      </section>

      <Link to="/copilot" className="cta-band on-blue" id="approve" data-chapter="Approve" data-ink="#ffffff">
        <span className="cta-line">{waiting ? `${waiting.actionCard.amount.display} into ${waiting.actionCard.vault.name} waits for the owner’s signature. Review the record and sign it.` : 'Ask the agent what it would do with today’s surplus, and watch it refuse what it should.'}</span>
        <svg className="cta-arrow" viewBox="0 0 48 48" aria-hidden="true"><path d="M12 36 36 12M16 12h20v20" fill="none" stroke="currentColor" strokeWidth="4" /></svg>
        <span className="cta-word">{waiting ? 'Approve' : 'Ask'}</span>
      </Link>

      <footer className="foot">
        <div className="foot-board">
          <div className="ft ft-statement">
            <p className="ft-big">AEGIS makes autonomous finance accountable, not unrestricted.</p>
            <p className="ft-legal">FinTechathon 2026, International AI Track, Topic F. Mock USDC and mock vaults on test networks. The contracts are not audited and must not hold real funds.</p>
          </div>
          <nav className="ft ft-nav" aria-label="Footer">
            <ul>
              <li><Link to="/treasury" className="link">Treasury</Link></li>
              <li><Link to="/copilot" className="link">Copilot</Link></li>
              <li><Link to="/risk" className="link">Risk</Link></li>
              <li><Link to="/audit" className="link">Audit</Link></li>
              <li><Link to="/bank" className="link">Bank desk</Link></li>
              <li><GlossaryButton className="link ft-terms" /></li>
            </ul>
          </nav>
          <div className="ft ft-net">
            <p>{mode === 'replay' ? 'Replay over the Base Sepolia contracts. Recorded transactions link to Basescan; the rest is illustrative' : `Live on chain ${chainId}`}</p>
            <p className="ft-small">Module <code>{deployment.module.slice(0, 10)}…</code></p>
            <p className="ft-small">Registry <code>{deployment.registry.slice(0, 10)}…</code></p>
          </div>
          <div className="ft ft-figure">
            <p className="ft-small">Treasury now, {src.toLowerCase()}</p>
            <p className="ft-num nums">{liveTotal !== null ? money(liveTotal) : tr ? tr.balances.total.display : '…'}</p>
            <p className="ft-small">USDC, of which {onChain && live.floor !== null ? money(live.floor) : tr ? money(num(tr.reserve.onchainFloor)) : '…'} is reserve</p>
          </div>
          <div className="ft ft-mark" aria-hidden="true"><span>AEGIS</span></div>
          <Link to="/treasury" className="ft ft-go">
            <span>Open the treasury</span>
            <svg viewBox="0 0 48 48" aria-hidden="true"><path d="M12 36 36 12M16 12h20v20" fill="none" stroke="currentColor" strokeWidth="4" /></svg>
          </Link>
        </div>
        <p className="credits">
          Pictures and footage: <a className="link-plain" href="https://commons.wikimedia.org/w/index.php?curid=85449757">“Time lock”</a> by ArnoldReinhold, <a className="link-plain" href="https://creativecommons.org/licenses/by-sa/4.0/">CC BY-SA 4.0</a>;{' '}
          <a className="link-plain" href="https://commons.wikimedia.org/wiki/File:Time_lock_(4602596296).jpg">“Time lock (4602596296)”</a> by plenty.r. from Frankfurt am Main, <a className="link-plain" href="https://creativecommons.org/licenses/by-sa/2.0/">CC BY-SA 2.0</a>;{' '}
          <a className="link-plain" href="https://commons.wikimedia.org/wiki/File:Jesse_Delano%27s_Patent_Drawing_for_a_Safe_-_DPLA_-_bad5b2a9bf1220d90c5e639fee146c29_(page_1).jpg">Jesse Delano’s patent drawing for a safe</a> and{' '}
          <a className="link-plain" href="https://commons.wikimedia.org/wiki/File:James_Matthews%27_Patent_Drawing_for_a_Safe_-_DPLA_-_02ec21eebd1d2332b59043ddca9cf5e3.jpg">James Matthews’ patent drawing for a safe</a>, US Patent Office, public domain;{' '}
          <a className="link-plain" href="https://commons.wikimedia.org/w/index.php?curid=87294482">“Bank vault door”</a> by mapimaging, <a className="link-plain" href="https://creativecommons.org/licenses/by-sa/4.0/">CC BY-SA 4.0</a>, cropped;{' '}
          <a className="link-plain" href="https://commons.wikimedia.org/wiki/File:Montreal_Clock_Tower_clock_mechanism.ogv">“Montreal Clock Tower clock mechanism”</a> by Andy Mabbett, <a className="link-plain" href="https://creativecommons.org/licenses/by-sa/4.0/">CC BY-SA 4.0</a>. All shown in greyscale. None of them shows AEGIS or its users.
        </p>
      </footer>
    </main>
  )
}
