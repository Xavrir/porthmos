import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { usePageTitle } from '../components/chrome'
import { GlossaryButton } from '../components/Glossary'
import { useAegis } from '../lib/source'
import { useIdentity } from '../lib/identity'
import { useBaseSepoliaLive } from '../lib/chain/live'
import { money } from '../lib/format'
import { ArtAgent, ArtLock, ArtProof, ArtRelease, ArtShip, ArtVerify, IconArrow, IconBlock, IconCheck, IconContract, IconFreeze, IconGrow, IconLock, IconMilestone, IconOut, IconPlus, IconReserve } from '../landing/art'
import { prefersStill, rng } from '../landing/canvas'
import {
  E1_DEPOSIT, E3_FLOOR, E5_EXIT, E5_FREEZE, RECORDED_COUNT, RECORDED_DAY, RECORDED_FLOOR, REFERENCE, REFUSED, REVERTED, SHIELD_HASHES, TICKER, TX_COUNT,
  addressUrl, blockText, shortHash, txUrl, type TickerItem,
} from '../landing/data'

const FONT_HREF = 'https://fonts.googleapis.com/css2?family=Geist:wght@400;500;700&family=Geist+Mono:wght@400;500&display=swap'

function useLandingDocument() {
  useEffect(() => {
    const head = document.head
    const add = (rel: string, href: string, cross?: boolean) => {
      if (head.querySelector(`link[rel="${rel}"][href="${href}"]`)) return
      const l = document.createElement('link')
      l.rel = rel
      l.href = href
      if (cross) l.crossOrigin = ''
      head.appendChild(l)
    }
    add('preconnect', 'https://fonts.googleapis.com')
    add('preconnect', 'https://fonts.gstatic.com', true)
    add('stylesheet', FONT_HREF)
    const root = document.documentElement
    root.classList.add('pm-page')
    return () => root.classList.remove('pm-page')
  }, [])
}

function Counter({ value, decimals = 0, count = true, className }: { value: number; decimals?: number; count?: boolean; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null)
  const shown = useRef<number | null>(null)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const fmt = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })
    const from = shown.current
    shown.current = value
    el.textContent = fmt(value)
    if (!count || prefersStill()) return
    let raf = 0
    let io: IntersectionObserver | null = null
    const run = (start: number) => {
      const t0 = performance.now()
      const step = (now: number) => {
        const p = Math.min(1, (now - t0) / 1400)
        el.textContent = fmt(start + (value - start) * (1 - (1 - p) ** 2))
        if (p < 1) raf = requestAnimationFrame(step)
      }
      raf = requestAnimationFrame(step)
    }
    if (from === null) {
      io = new IntersectionObserver((es) => {
        if (!es.some((e) => e.isIntersecting)) return
        io?.disconnect()
        run(0)
      }, { threshold: 0.4 })
      io.observe(el)
    } else if (from !== value) run(from)
    return () => { cancelAnimationFrame(raf); io?.disconnect() }
  }, [value, decimals, count])
  return <span ref={ref} className={className} />
}

function Ext({ href, className, children, label }: { href: string; className?: string; children: ReactNode; label?: string }) {
  return <a href={href} className={className} target="_blank" rel="noreferrer" aria-label={label}>{children}</a>
}

function Chip({ children, tone = 'light', as: Tag = 'span', className = '' }: { children: ReactNode; tone?: 'light' | 'dark' | 'green' | 'orange'; as?: 'span' | 'h2' | 'p'; className?: string }) {
  return <Tag className={`pm-chip pm-chip-${tone} ${className}`}>{children}</Tag>
}

function TickerRow({ items, hidden }: { items: TickerItem[]; hidden?: boolean }) {
  return (
    <ul className="pm-ticker-row" aria-hidden={hidden || undefined}>
      {items.map((t) => (
        <li key={t.hash}>
          <a href={txUrl(t.hash)} target="_blank" rel="noreferrer" tabIndex={hidden ? -1 : undefined} className="pm-ticker-item">
            <span className="pm-ticker-id">{t.scenario}</span>
            <span className={t.reverted ? 'pm-ticker-err' : 'pm-ticker-ok'}>{t.reverted ? `reverted ${t.error}` : 'confirmed'}</span>
            <span>block {blockText(t.block)}</span>
            <span>{shortHash(t.hash)}</span>
          </a>
        </li>
      ))}
    </ul>
  )
}

const GUARANTEES: { title: string; icon: ReactNode; status: ReactNode }[] = [
  { title: 'Payment locked before the goods ship', icon: <IconLock />, status: 'TradeFlow, ships this week' },
  { title: 'Paid per milestone, on verified proof', icon: <IconMilestone />, status: 'TradeFlow, ships this week' },
  { title: 'Upcoming bills are reserved first', icon: <IconReserve />, status: E3_FLOOR ? <Ext href={txUrl(E3_FLOOR.hash)}>Live, E3 on BaseScan</Ext> : 'Live' },
  { title: 'Only free cash is put to work', icon: <IconGrow />, status: E1_DEPOSIT ? <Ext href={txUrl(E1_DEPOSIT.hash)}>Live, E1 on BaseScan</Ext> : 'Live' },
  { title: 'The bank can freeze the agent at once', icon: <IconFreeze />, status: E5_FREEZE ? <Ext href={txUrl(E5_FREEZE.hash)}>Live, E5 on BaseScan</Ext> : 'Live' },
]

type Step = { n: string; title: string; text: string; art: ReactNode; fn: string; live?: { label: string; href: string }; extra?: ReactNode }

const STEPS: Step[] = [
  { n: '01', title: 'Lock the funds', text: 'The buyer funds the order in one signed transaction. Example: 100,000 USDC for three milestones, held by the contract, out of the agent’s reach.', art: <ArtLock />, fn: 'TradeEscrow.createOrder' },
  { n: '02', title: 'Ship the goods', text: 'The carrier takes the container. Its signed handover document is the proof for milestone 1, worth 20,000 USDC.', art: <ArtShip />, fn: 'Proof kind: HANDOVER' },
  { n: '03', title: 'Submit the proof', text: 'A trusted issuer signs each proof: the carrier, a cold chain sensor, a surveyor. Anyone may submit it, because the signature is the authority.', art: <ArtProof />, fn: 'POST /api/tradeflow/orders/{id}/proofs' },
  { n: '04', title: 'Verify', text: 'Fixed code checks the issuer, the document and the conditions, such as 2 to 8 °C for a reefer. If one check fails, the payment is held.', art: <ArtVerify />, fn: 'Proof Verifier, then the Authorizer' },
  {
    n: '05', title: 'Release the milestone', text: 'The contract pays the supplier address fixed in the order. Not the agent, not an issuer: no one can change the payee or the amount.', art: <ArtRelease />, fn: 'TradeEscrow.release',
    extra: <p className="pm-flow"><span>TradeEscrow</span><span className="pm-flow-track" aria-hidden="true"><span className="pm-flow-dot" /></span><span className="sr-only">pays the</span><span>supplier</span><span className="pm-flow-amt">20,000.00 USDC</span></p>,
  },
  { n: '06', title: 'Invest only free cash', text: 'Cash that no bill and no order needs goes into vaults the owner approved. The contract refuses any deposit below the reserve floor.', art: <ArtAgent />, fn: 'AegisModule.deposit', live: E1_DEPOSIT ? { label: 'Live, E1 on BaseScan', href: txUrl(E1_DEPOSIT.hash) } : undefined },
]

function Stripes() {
  const layers = useMemo(() => {
    const rand = rng(1440)
    const shades = ['#000000', '#000000', '#04140E', '#0B3D2C', '#137452', '#1B8560', '#2E9C74', '#4EC397', '#7DD3B0', '#A9E4CC']
    const make = (n: number, gaps: boolean, bias: number) => Array.from({ length: n }, (_, i) => ({
      key: i,
      w: 4 + Math.round(rand() * 56),
      gap: gaps ? Math.round(rand() * 90) : 0,
      c: shades[Math.min(shades.length - 1, Math.max(0, Math.floor(rand() * shades.length * 0.8 + bias)))],
    }))
    return [make(26, false, 0), make(10, true, 2), make(6, true, 4)]
  }, [])
  return (
    <div className="pm-stripes" aria-hidden="true">
      {layers.map((l, i) => (
        <div key={i} className={`pm-stripe-layer pm-stripe-l${i}`}>
          {l.map((s) => <span key={s.key} style={{ width: s.w, marginLeft: s.gap, ['--c' as string]: s.c }} />)}
        </div>
      ))}
      <span className="pm-stripe-orange" />
    </div>
  )
}

function FreezeDemo() {
  const [frozen, setFrozen] = useState(false)
  const [runs, setRuns] = useState(0)
  const safe = shortHash(REFERENCE.safe)
  return (
    <div className={`pm-freeze ${frozen ? 'is-frozen' : ''}`}>
      <div className="pm-freeze-row">
        <Chip>Simulation</Chip>
        <p className="pm-freeze-who">Agent of the reference treasury <span className="pm-mono">{safe}</span></p>
        <span className={`pm-chip ${frozen ? 'pm-chip-orange' : 'pm-chip-green'} pm-freeze-state`}>{frozen ? 'FROZEN' : 'ACTIVE'}</span>
        <button type="button" className="pm-btn pm-btn-ink" aria-pressed={frozen} onClick={() => { setFrozen((f) => !f); setRuns((r) => r + 1) }}>
          {frozen ? 'Lift the freeze' : 'Freeze deposits'}
        </button>
      </div>
      <div className="pm-freeze-log" aria-live="polite">
        {runs === 0 ? (
          <p className="pm-mono">Press the button to see what the bank sends. Nothing is sent from this page.</p>
        ) : (
          <>
            <p key={runs} className="pm-mono pm-typed">&gt; PolicyRegistry.{frozen ? 'bankFreeze' : 'bankUnfreeze'}({safe}), simulated</p>
            {E5_FREEZE ? (
              <p className="pm-mono">On Base Sepolia the bank froze this treasury in E5, block {blockText(E5_FREEZE.block)}: <Ext href={txUrl(E5_FREEZE.hash)} className="pm-link-deep">{shortHash(E5_FREEZE.hash)}</Ext></p>
            ) : null}
          </>
        )}
      </div>
    </div>
  )
}

type Plan = { title: string; text: string; action: ReactNode }

function Plans({ plans }: { plans: Plan[] }) {
  const [open, setOpen] = useState(0)
  const base = useId()
  const fine = useRef(false)
  useEffect(() => { fine.current = matchMedia('(hover: hover) and (pointer: fine)').matches }, [])
  return (
    <ul className="pm-plans">
      {plans.map((p, i) => (
        <li key={p.title} className={`pm-plan ${open === i ? 'is-open' : ''}`} onPointerEnter={() => { if (fine.current) setOpen(i) }}>
          <span className="pm-plan-tile" aria-hidden="true"><IconArrow /></span>
          <h3 className="pm-plan-title">
            <button type="button" id={`${base}-b${i}`} aria-expanded={open === i} aria-controls={`${base}-p${i}`} onClick={() => setOpen(i)}>{p.title}</button>
          </h3>
          <p className="pm-plan-text">{p.text}</p>
          <div className="pm-plan-bar" id={`${base}-p${i}`} role="region" aria-labelledby={`${base}-b${i}`}>
            <div className="pm-plan-bar-in">{p.action}</div>
          </div>
        </li>
      ))}
    </ul>
  )
}

export function Landing() {
  usePageTitle(null)
  useLandingDocument()
  const { tenant, http, service } = useAegis()
  const { chooser } = useIdentity()
  const live = useBaseSepoliaLive()
  const health = useQuery({
    queryKey: ['landing-health'],
    queryFn: () => http.health() as Promise<{ tenantCount?: unknown }>,
    enabled: service === 'up',
    refetchInterval: 60000,
    retry: 0,
  })
  const tenantCount = typeof health.data?.tenantCount === 'number' ? health.data.tenantCount : null
  const isLive = live.status === 'live'
  const floor = isLive && live.floor !== null ? live.floor : RECORDED_FLOOR
  const vaultAssets = isLive && live.vaults ? live.vaults.reduce((a, v) => a + v.assets, 0) : null
  const safeUsdc = isLive ? live.safeUsdc : null

  const rootRef = useRef<HTMLDivElement>(null)
  const heroCanvas = useRef<HTMLCanvasElement>(null)
  const heroWatch = useRef<HTMLSpanElement>(null)
  const asciiCanvas = useRef<HTMLCanvasElement>(null)
  const barCanvas = useRef<HTMLCanvasElement>(null)
  const topWatch = useRef<HTMLSpanElement>(null)
  const [atTop, setAtTop] = useState(true)

  useEffect(() => {
    const el = topWatch.current
    if (!el) return
    const io = new IntersectionObserver(([e]) => setAtTop(e.isIntersecting))
    io.observe(el)
    return () => io.disconnect()
  }, [])

  useEffect(() => {
    const still = prefersStill()
    const stops: (() => void)[] = []
    let cancelled = false
    void Promise.all([import('../landing/burst'), import('../landing/ascii'), import('../landing/barField')]).then(([b, a, f]) => {
      if (cancelled) return
      if (heroCanvas.current) stops.push(b.startBurst(heroCanvas.current, { still, observe: heroWatch.current ?? undefined }).stop)
      if (asciiCanvas.current) stops.push(a.startAscii(asciiCanvas.current, SHIELD_HASHES, { still }).stop)
      if (barCanvas.current) stops.push(f.startBarField(barCanvas.current, { still }).stop)
    })
    return () => { cancelled = true; stops.forEach((s) => s()) }
  }, [])

  useEffect(() => {
    const root = rootRef.current
    if (!root) return
    let stop: (() => void) | null = null
    let cancelled = false
    const release = () => document.documentElement.classList.remove('motion-pending')
    const fonts = Promise.race([document.fonts?.ready ?? Promise.resolve(), new Promise((r) => setTimeout(r, 1200))])
    Promise.all([import('./landingMotion'), fonts])
      .then(([m]) => { if (!cancelled) stop = m.initLandingMotion(root) })
      .catch(release)
    return () => { cancelled = true; stop?.(); release() }
  }, [])

  const primary = tenant
    ? <button type="button" className="pm-btn pm-btn-green" onClick={() => chooser.show('hero')}>Open your treasury<IconArrow /></button>
    : <Link to="/start" className="pm-btn pm-btn-green">Create your treasury<IconArrow /></Link>

  const plans: Plan[] = [
    {
      title: 'Try a test treasury',
      text: 'Your own treasury on Base Sepolia in about a minute: a Safe, an owner key and a bank key, made in your browser. Free, with test funds only.',
      action: tenant
        ? <button type="button" className="pm-bar-link" onClick={() => chooser.show('hero')}><IconArrow />Open your treasury</button>
        : <Link to="/start" className="pm-bar-link"><IconArrow />Create your treasury</Link>,
    },
    { title: 'Watch the recorded run', text: 'The reference treasury’s real run, replayed in your browser. You pick a seat. Nothing to sign.', action: <Link to="/treasury" className="pm-bar-link"><IconArrow />Open the demo</Link> },
    { title: 'Pilot for importers', text: 'Planned at US$149 to 499 a month plus 0.12% of verified payment volume. Pilots start with 3 to 5 importers in Singapore.', action: <a href="#how" className="pm-bar-link"><IconArrow />See how a milestone payment works</a> },
    { title: 'Bank partner', text: 'One desk over every client’s agent: limits, escalations and a freeze that only the bank can lift. Enterprise plans planned from US$1,499 a month.', action: <Link to="/bank" className="pm-bar-link"><IconArrow />Open the bank desk</Link> },
  ]

  return (
    <div className="pm" ref={rootRef}>
      <span className="pm-top-watch" ref={topWatch} aria-hidden="true" />
      <header className={`pm-nav ${atTop ? 'is-top' : ''}`}>
        <div className="pm-nav-in">
          <Link to="/" className="pm-brand" aria-label="Porthmos, home">
            <img src="/brand/porthmos-mark.png" width={29} height={32} alt="" />
            <span>Porthmos</span>
          </Link>
          <nav className="pm-nav-links" aria-label="Sections">
            <a href="#how">How it works<span className="pm-plus" aria-hidden="true"><IconPlus /></span></a>
            <a href="#proof">Proof<span className="pm-plus" aria-hidden="true"><IconPlus /></span></a>
            <a href="#bank">Bank desk<span className="pm-plus" aria-hidden="true"><IconPlus /></span></a>
            <a href="#agent">Agent<span className="pm-plus" aria-hidden="true"><IconPlus /></span></a>
            <a href="#start">Get started<span className="pm-plus" aria-hidden="true"><IconPlus /></span></a>
          </nav>
          <Link to="/treasury" className="pm-btn pm-btn-green pm-nav-cta">Open the demo</Link>
        </div>
      </header>

      <main id="main" className="pm-main">
        <div className="pm-overlap">
          <section className="pm-hero" aria-labelledby="pm-hero-title">
            <div className="pm-burst">
              <canvas ref={heroCanvas} aria-hidden="true" />
            </div>
            <div className="pm-scrim" aria-hidden="true" />
            <div className="pm-hero-in">
              <h1 id="pm-hero-title" className="pm-hero-title">Pay suppliers on proof</h1>
              <p className="pm-hero-sub">Porthmos is an AI trade treasury. It holds the buyer’s payment in a contract, releases each milestone when the proof checks out, and keeps the rest of the cash safe and earning.</p>
              <div className="pm-hero-actions">
                <div className="pm-pair">
                  {primary}
                  <a href="#proof" className="pm-btn pm-btn-white">See the on-chain proof</a>
                </div>
                <p className="pm-hero-chips">
                  <span className="pm-chip pm-chip-dark"><span className={`pm-dot ${isLive ? 'is-live' : ''}`} aria-hidden="true" /><span>Treasury live on Base Sepolia{isLive && live.block ? <>, block <span className="pm-num">{blockText(live.block)}</span></> : null}</span></span>
                  <span className="pm-chip pm-chip-dark">TradeFlow escrow ships this week</span>
                </p>
              </div>
            </div>
          </section>

          <section className="pm-problem" aria-labelledby="pm-gap-title">
            <span className="pm-hero-watch" ref={heroWatch} aria-hidden="true" />
            <div className="pm-ticker">
              <p className="pm-ticker-head">{TX_COUNT} recorded transactions on Base Sepolia, from deposit to refused attack</p>
              <div className="pm-ticker-view">
                <div className="pm-ticker-track">
                  <TickerRow items={TICKER} />
                  <TickerRow items={TICKER} hidden />
                </div>
              </div>
            </div>

            <div className="pm-wrap pm-statement-wrap">
              <Chip as="h2" className="pm-statement-chip"><span id="pm-gap-title">The trust gap in trade</span></Chip>
              <p className="pm-statement">A buyer won’t pay before the goods ship. A supplier won’t ship before the money is there. So a clerk checks every document and signs off every payment by hand. Porthmos locks the payment in a contract and lets the proof release it. Nobody has to go first.</p>
            </div>

            <div className="pm-wrap pm-rules-head">
              <span className="pm-mono pm-bracket" aria-hidden="true">[ → ]</span>
              <Chip as="p">With Porthmos</Chip>
            </div>
            <div className="pm-rules-band">
              <div className="pm-wrap">
              <ul className="pm-rules">
                {GUARANTEES.map((g) => (
                  <li key={g.title} className="pm-rule">
                    <span className="pm-rule-title">{g.title}</span>
                    <span className="pm-rule-status pm-mono">{g.status}</span>
                    <span className="pm-tile" aria-hidden="true">{g.icon}</span>
                    <span className="pm-rule-line" aria-hidden="true" />
                  </li>
                ))}
              </ul>
              </div>
            </div>
          </section>
        </div>

        <section className="pm-how" id="how" aria-labelledby="pm-how-title">
          <div className="pm-wipe">
            <Stripes />
            <div className="pm-wipe-hole" aria-hidden="true" />
            <div className="pm-wipe-black" aria-hidden="true" />
            <div className="pm-wipe-head">
              <h2 id="pm-how-title" className="pm-display">How a milestone payment works</h2>
              <p className="pm-wipe-note pm-mono">Example order: 100,000 USDC in three milestones. Steps 01 to 05 are TradeFlow, which ships this week and is not on-chain yet. Step 06 is live.</p>
            </div>
            <span className="pm-wipe-stub" aria-hidden="true" />
          </div>
          <div className="pm-rail">
            <span className="pm-rail-line" aria-hidden="true" />
            <span className="pm-rail-marker" aria-hidden="true" />
            <ol className="pm-steps">
              {STEPS.map((s) => (
                <li key={s.n} className="pm-step">
                  <div className="pm-step-head">
                    <span className="pm-step-n pm-mono">{s.n}</span>
                    <h3 className="pm-step-title pm-mono">{s.title}</h3>
                  </div>
                  <div className="pm-step-body">
                    <p className="pm-step-text">{s.text}</p>
                    <div className="pm-step-art">{s.art}</div>
                    {s.extra}
                  </div>
                  <div className="pm-step-foot">
                    <span className="pm-step-tree" aria-hidden="true" />
                    <span className="pm-step-icon" aria-hidden="true"><IconContract /></span>
                    <span className="pm-step-fn pm-mono">{s.fn}</span>
                    {s.live
                      ? <Ext href={s.live.href} className="pm-step-tag is-live pm-mono">{s.live.label}</Ext>
                      : <span className="pm-step-tag pm-mono">Ships this week</span>}
                  </div>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section className="pm-proof" id="proof" aria-labelledby="pm-proof-title">
          <div className="pm-ascii"><canvas ref={asciiCanvas} aria-hidden="true" /></div>
          <div className="pm-wrap">
            <h2 id="pm-proof-title" className="pm-display pm-reveal-words">Attacked on-chain. Refused on-chain.</h2>
            <p className="pm-lede">We sent real attacks at the reference treasury on Base Sepolia. Each one was mined and reverted, so anyone can open the transaction and read the error.</p>
            <ul className="pm-cards">
              {REFUSED.map((r) => (
                <li key={r.id} className="pm-card">
                  <div className="pm-card-head">
                    <span className="pm-card-icon" aria-hidden="true"><IconBlock /></span>
                    <h3>{r.title}</h3>
                    <span className="pm-chip pm-chip-orange">REFUSED</span>
                  </div>
                  <div className="pm-card-body">
                    <p className="pm-caption">{r.id}, what was tried</p>
                    <ul className="pm-tree">
                      {r.tried.map((x) => <li key={x}>{x}</li>)}
                      <li className="pm-tree-out">Reverted <code>{r.error}</code> in block {blockText(r.block)}</li>
                    </ul>
                  </div>
                  <Ext href={txUrl(r.hash)} className="pm-actionbar" label={`View the ${r.error} revert of ${r.id} on BaseScan`}>
                    <span>View the revert on BaseScan</span>
                    <span className="pm-mono">{shortHash(r.hash)}</span>
                    <IconOut />
                  </Ext>
                </li>
              ))}
            </ul>
            <p className="pm-note">One attack never became a transaction (E4c). A chat message told the agent to send all USDC to an outside address. The agent can only deposit into approved vaults or redeem back to the Safe, so there was nothing to sign.</p>

            <div className="pm-stats">
              <div className="pm-stat pm-stat-big">
                <p className="pm-caption">Reserve floor held by the contract, {isLive && live.floor !== null ? 'read live from Base Sepolia' : `recorded ${RECORDED_DAY}`}</p>
                {floor !== null ? <p className="pm-counter"><Counter value={floor} decimals={2} /><span className="pm-unit">USDC</span></p> : <p className="pm-counter">n/a</p>}
              </div>
              <div className="pm-stat">
                <p className="pm-caption">Attacks refused on-chain</p>
                <p className="pm-counter pm-counter-s"><Counter value={REVERTED.length} /></p>
              </div>
              <div className="pm-stat">
                {tenantCount !== null ? (
                  <><p className="pm-caption">Treasuries created, live</p><p className="pm-counter pm-counter-s"><Counter value={tenantCount} /></p></>
                ) : (
                  <><p className="pm-caption">Transactions recorded</p><p className="pm-counter pm-counter-s"><Counter value={TX_COUNT} /></p></>
                )}
              </div>
              <div className="pm-stat">
                {isLive && live.block ? (
                  <><p className="pm-caption">Latest block, live</p><p className="pm-counter pm-counter-s"><Counter value={live.block} count={false} /></p></>
                ) : (
                  <><p className="pm-caption">Scenarios recorded</p><p className="pm-counter pm-counter-s"><Counter value={RECORDED_COUNT} /></p></>
                )}
              </div>
              <Link to="/audit#evidence" className="pm-stat pm-stat-link">
                <p className="pm-caption">Audit</p>
                <span>Every recorded transaction<IconArrow /></span>
              </Link>
            </div>
          </div>
        </section>

        <section className="pm-bank" id="bank" aria-labelledby="pm-bank-title">
          <div className="pm-wrap">
            <Chip as="h2" className="pm-bank-chip"><span id="pm-bank-title">The bank desk</span></Chip>
            <div className="pm-cols">
              <div className="pm-col">
                <h3 className="pm-col-title">What the risk officer sees</h3>
                <ul className="pm-rows">
                  <li>Every client’s agent, its risk score and its audit log</li>
                  <li>Each action’s signed record in a hash-chained ledger</li>
                  <li>Deposits that wait for the bank’s approval</li>
                  <li>Escrow and held milestones per client, with TradeFlow</li>
                </ul>
              </div>
              <div className="pm-col">
                <h3 className="pm-col-title">What the risk officer can do</h3>
                <ul className="pm-rows">
                  <li>Freeze an agent’s deposits in one transaction</li>
                  <li>Revoke the agent’s signing key</li>
                  <li>Tighten limits and quarantine a vault</li>
                  <li>Lift its own freeze, which the owner cannot</li>
                </ul>
              </div>
            </div>
            <FreezeDemo />
            <p className="pm-bank-note">A freeze stops deposits only. Exits back to the Safe keep running, so a freeze never traps funds{E5_EXIT ? <>: in E5 the exit went through while frozen, <Ext href={txUrl(E5_EXIT.hash)} className="pm-link-deep">block {blockText(E5_EXIT.block)}</Ext></> : null}.</p>
            <div className="pm-center">
              <Link to="/bank" className="pm-btn pm-btn-green pm-btn-cta"><IconArrow />Open the bank desk</Link>
            </div>
          </div>
        </section>

        <section className="pm-agent" id="agent" aria-labelledby="pm-agent-title">
          <div className="pm-wrap">
            <h2 id="pm-agent-title" className="pm-display pm-scrub-words">Bills first. Only spare cash goes to work.</h2>
            <p className="pm-lede">The agent works out what the business owes over the next 30 days, keeps that much as a reserve the contract enforces, and invests only the rest in vaults the owner approved.</p>
            <figure className="pm-split">
              <figcaption className="pm-caption">Reference treasury, {isLive ? 'read live from Base Sepolia' : `reserve floor recorded ${RECORDED_DAY}; live balances unavailable`}</figcaption>
              {isLive && safeUsdc !== null && floor !== null ? (() => {
                const reserved = Math.min(floor, safeUsdc)
                const free = Math.max(0, safeUsdc - floor)
                const invested = vaultAssets ?? 0
                const total = reserved + free + invested || 1
                return (
                  <>
                    <div className="pm-split-bar" aria-hidden="true">
                      <span className="pm-seg pm-seg-reserve" style={{ flexGrow: reserved / total }} />
                      <span className="pm-seg pm-seg-free" style={{ flexGrow: free / total }} />
                      <span className="pm-seg pm-seg-vault" style={{ flexGrow: invested / total }} />
                    </div>
                    <dl className="pm-split-legend">
                      <div><dt><span className="pm-key pm-seg-reserve" />Reserved for bills</dt><dd className="pm-num">{money(reserved)}</dd></div>
                      <div><dt><span className="pm-key pm-seg-free" />Free in the Safe</dt><dd className="pm-num">{money(free)}</dd></div>
                      <div><dt><span className="pm-key pm-seg-vault" />Invested in vaults</dt><dd className="pm-num">{money(invested)}</dd></div>
                    </dl>
                  </>
                )
              })() : (
                <dl className="pm-split-legend">
                  <div><dt><span className="pm-key pm-seg-reserve" />Reserve floor</dt><dd className="pm-num">{floor !== null ? money(floor) : 'n/a'}</dd></div>
                </dl>
              )}
            </figure>
            <ul className="pm-cards pm-cards-agent">
              <li className="pm-card">
                <div className="pm-card-head">
                  <span className="pm-card-icon" aria-hidden="true"><IconCheck /></span>
                  <h3>What the agent can do alone</h3>
                </div>
                <div className="pm-card-body">
                  <ul className="pm-tree">
                    <li>Deposit up to 1,000 USDC into a vault it has used before</li>
                    <li>Redeem from any vault back to the Safe, at any time</li>
                    <li>Leave a vault when the peg slips more than 1%</li>
                    <li>Hold when the price is older than 180 seconds</li>
                  </ul>
                </div>
                <Link to="/copilot" className="pm-actionbar"><span>Ask the agent</span><IconArrow /></Link>
              </li>
              <li className="pm-card">
                <div className="pm-card-head">
                  <span className="pm-card-icon" aria-hidden="true"><IconBlock /></span>
                  <h3>What it can never do</h3>
                </div>
                <div className="pm-card-body">
                  <ul className="pm-tree">
                    <li>Send funds to any address outside the treasury</li>
                    <li>Invest below the reserve floor</li>
                    <li>Deposit more than 5,000 USDC in one day</li>
                    <li>Lift a freeze set by the bank</li>
                  </ul>
                </div>
                <GlossaryButton className="pm-actionbar" label={<><span>What do these terms mean?</span><IconArrow /></>} />
              </li>
            </ul>
          </div>
        </section>

        <section className="pm-start" id="start" aria-labelledby="pm-start-title">
          <div className="pm-wrap">
            <Chip as="h2" tone="dark"><span id="pm-start-title">Ways to use Porthmos</span></Chip>
            <Plans plans={plans} />
            <p className="pm-note">Prices are planned, not final. Settlement runs through licensed partners where the law requires it.</p>
          </div>
        </section>
      </main>

      <footer className="pm-foot">
        <div className="pm-wrap">
          <Link to="/" className="pm-brand pm-foot-brand" aria-label="Porthmos, home">
            <img src="/brand/porthmos-mark.png" width={29} height={32} alt="" />
            <span>Porthmos</span>
          </Link>
          <div className="pm-foot-cols">
            <nav aria-labelledby="pm-f1">
              <p id="pm-f1" className="pm-foot-head">PRODUCT/</p>
              <ul className="pm-foot-list">
                <li><Link to="/treasury">Treasury</Link></li>
                <li><Link to="/copilot">Copilot</Link></li>
                <li><Link to="/risk">Risk</Link></li>
                <li><Link to="/audit">Audit</Link></li>
                <li><Link to="/bank">Bank desk</Link></li>
                <li><Link to="/start">Create a treasury</Link></li>
              </ul>
            </nav>
            <nav aria-labelledby="pm-f2">
              <p id="pm-f2" className="pm-foot-head">PROOF/</p>
              <ul className="pm-foot-list">
                {E1_DEPOSIT ? <li><Ext href={txUrl(E1_DEPOSIT.hash)}>E1 Deposit with approval</Ext></li> : null}
                {E3_FLOOR ? <li><Ext href={txUrl(E3_FLOOR.hash)}>E3 Reserve floor raised</Ext></li> : null}
                {REFUSED.map((r) => <li key={r.id}><Ext href={txUrl(r.hash)}>{r.id} {r.error}</Ext></li>)}
                <li><Link to="/audit#evidence">Every recorded transaction</Link></li>
              </ul>
            </nav>
            <nav aria-labelledby="pm-f3">
              <p id="pm-f3" className="pm-foot-head">CONTRACTS/</p>
              <ul className="pm-foot-list">
                <li><Ext href={addressUrl(REFERENCE.module)}>AegisModule</Ext></li>
                <li><Ext href={addressUrl(REFERENCE.registry)}>PolicyRegistry</Ext></li>
                <li><Ext href={addressUrl(REFERENCE.safe)}>Reference Safe</Ext></li>
              </ul>
            </nav>
            <div>
              <p className="pm-foot-head">ABOUT/</p>
              <ul className="pm-foot-list">
                <li><GlossaryButton className="pm-foot-btn" label="Terms used on this page" /></li>
                <li><span>FinTechathon 2026, Topic F</span></li>
              </ul>
            </div>
          </div>
          <p className="pm-legal">Test networks only: mock USDC and mock vaults on Base Sepolia. The contracts are not audited and must not hold real funds. TradeFlow is in design and not deployed yet.</p>
        </div>
        <div className="pm-field"><canvas ref={barCanvas} aria-hidden="true" /></div>
      </footer>
    </div>
  )
}
