import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { usePageTitle } from '../components/chrome'
import { useAegis } from '../lib/source'
import { useIdentity } from '../lib/identity'
import { useBaseSepoliaLive } from '../lib/chain/live'
import { ArtLock, ArtProof, ArtRelease, ArtShip, ArtVerify, IconArrow, IconBlock, IconCheck, IconContract, IconFreeze, IconGitHub, IconLock, IconOut, IconPlus } from '../landing/art'
import { prefersStill, rng } from '../landing/canvas'
import {
  CONTRACTS_URL, DOCS_URL, E5_EXIT, REFERENCE, REFUSED, REFUSED_IDS, REPO_URL, REVERTED, SHIELD_HASHES, STATUS_URL, TESTS, TEST_TOTAL, TICKER, TX_COUNT,
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

function Counter({ value }: { value: number }) {
  const ref = useRef<HTMLSpanElement>(null)
  const shown = useRef<number | null>(null)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const fmt = (n: number) => Math.round(n).toLocaleString('en-US')
    const from = shown.current
    shown.current = value
    el.textContent = fmt(value)
    if (prefersStill()) return
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
  }, [value])
  return <span ref={ref} />
}

function Ext({ href, className, children, label }: { href: string; className?: string; children: ReactNode; label?: string }) {
  return <a href={href} className={className} target="_blank" rel="noreferrer" aria-label={label}>{children}</a>
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

type Stat = { key: string; value: number; label: string; source: string }

type Step = { n: string; title: string; text: string; art: ReactNode; fn: string; flow?: boolean }

const STEPS: Step[] = [
  { n: '01', title: 'Lock', text: 'The buyer funds the order in one signed transaction. The contract holds the money, out of the agent’s reach.', art: <ArtLock />, fn: 'TradeEscrow.createOrder' },
  { n: '02', title: 'Ship', text: 'The carrier takes the goods and signs the handover. That document is the proof for the first milestone.', art: <ArtShip />, fn: 'Proof kind: HANDOVER' },
  { n: '03', title: 'Prove', text: 'A trusted issuer signs each proof: a carrier, a sensor, a surveyor. Anyone may submit it. The signature is the authority.', art: <ArtProof />, fn: 'POST /api/tradeflow/orders/{id}/proofs' },
  { n: '04', title: 'Verify', text: 'Fixed code checks the issuer, the document and the conditions. If one check fails, the payment is held.', art: <ArtVerify />, fn: 'Proof Verifier, then the Authorizer' },
  { n: '05', title: 'Release', text: 'The contract pays the supplier fixed in the order. No one can change the payee or the amount.', art: <ArtRelease />, fn: 'TradeEscrow.release', flow: true },
]

type Fact = { icon: ReactNode; title: string; text: string; link?: { href: string; label: string } }

const FACTS: Fact[] = [
  { icon: <IconCheck />, title: `${TESTS.contracts} contract tests pass`, text: `Including ${TESTS.contractInvariants} stateful fuzz invariants. The source is on GitHub.`, link: { href: CONTRACTS_URL, label: 'Contracts on GitHub' } },
  { icon: <IconLock />, title: 'The AI holds no key', text: 'The model can only propose. Fixed code signs, and the contract checks every action.' },
  {
    icon: <IconFreeze />, title: 'The bank can freeze any agent', text: 'One transaction stops deposits. Exits back to the Safe still work.',
    link: E5_EXIT ? { href: txUrl(E5_EXIT.hash), label: `Exit while frozen, block ${blockText(E5_EXIT.block)}` } : undefined,
  },
]

const BUILT: { name: string; use: string }[] = [
  { name: 'Base', use: 'Network (Base Sepolia)' },
  { name: 'Safe', use: 'Treasury smart account' },
  { name: 'OpenZeppelin', use: 'Contract libraries' },
  { name: 'Foundry', use: 'Contract tests' },
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
  const treasuryUsdc = isLive && live.safeUsdc !== null && live.vaults ? live.safeUsdc + live.vaults.reduce((a, v) => a + v.assets, 0) : null

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

  const launch = (className: string, arrow = true) => tenant
    ? <button type="button" className={className} onClick={() => chooser.show('hero')}>Launch app{arrow ? <IconArrow /> : null}</button>
    : <Link to="/start" className={className}>Launch app{arrow ? <IconArrow /> : null}</Link>
  const docs = <Ext href={DOCS_URL} className="pm-btn pm-btn-white">Read the docs</Ext>

  const stats: Stat[] = [
    ...(tenantCount !== null ? [{ key: 'tenants', value: tenantCount, label: 'Treasuries created', source: `Live from ${STATUS_URL} (tenantCount)` }] : []),
    { key: 'tx', value: TX_COUNT, label: 'On-chain transactions recorded', source: 'deployments/evidence-84532.json: every transaction of scenarios E1 to E5 on Base Sepolia' },
    { key: 'refused', value: REVERTED.length, label: 'Attacks refused on-chain', source: `deployments/evidence-84532.json: reverted transactions ${REFUSED_IDS}` },
    { key: 'tests', value: TEST_TOTAL, label: 'Automated tests', source: `${TESTS.contracts} contract (Foundry), ${TESTS.serviceUnit} service unit and ${TESTS.serviceIntegration} integration (pytest), ${TESTS.web} web (Vitest)` },
    ...(treasuryUsdc !== null ? [{ key: 'usdc', value: treasuryUsdc, label: 'Testnet USDC in the reference treasury', source: 'Read live from Base Sepolia: USDC in the reference Safe plus its vault positions, rounded to whole USDC' }] : []),
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
          <nav className="pm-nav-links" aria-label="Main">
            <a href="#how">How it works<span className="pm-plus" aria-hidden="true"><IconPlus /></span></a>
            <a href="#security">Security<span className="pm-plus" aria-hidden="true"><IconPlus /></span></a>
            <Ext href={DOCS_URL}>Docs<span className="pm-plus pm-plus-out" aria-hidden="true"><IconOut /></span></Ext>
            <Ext href={REPO_URL} className="pm-nav-icon" label="GitHub"><IconGitHub /></Ext>
          </nav>
          {launch('pm-btn pm-btn-green pm-nav-cta', false)}
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
              <p className="pm-hero-sub">Porthmos holds the buyer’s payment in a smart contract and releases each milestone only when its proof checks out.</p>
              <div className="pm-hero-actions">
                <div className="pm-pair">
                  {launch('pm-btn pm-btn-green')}
                  {docs}
                </div>
                <p className="pm-hero-chips">
                  <span className="pm-chip pm-chip-dark">Built on Base</span>
                  {isLive && live.block ? (
                    <span className="pm-chip pm-chip-dark" title="Latest block, read live from Base Sepolia"><span className="pm-dot is-live" aria-hidden="true" /><span>Base Sepolia block <span className="pm-num">{blockText(live.block)}</span></span></span>
                  ) : null}
                </p>
              </div>
            </div>
          </section>

          <section className="pm-curtain" aria-labelledby="pm-stats-title">
            <span className="pm-hero-watch" ref={heroWatch} aria-hidden="true" />
            <div className="pm-wrap">
              <h2 id="pm-stats-title" className="sr-only">Porthmos in numbers</h2>
              <ul className="pm-stats">
                {stats.map((s) => (
                  <li key={s.key} className="pm-stat" title={s.source}>
                    <p className="pm-counter"><Counter value={s.value} /></p>
                    <p className="pm-caption">{s.label}</p>
                  </li>
                ))}
              </ul>
            </div>
            <div className="pm-ticker" role="region" aria-label="Recorded transactions on Base Sepolia">
              <div className="pm-ticker-view">
                <div className="pm-ticker-track">
                  <TickerRow items={TICKER} />
                  <TickerRow items={TICKER} hidden />
                </div>
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
              <h2 id="pm-how-title" className="pm-display">Lock. Ship. Prove. Verify. Release.</h2>
              <p className="pm-chip pm-chip-dark"><span className="pm-dot" aria-hidden="true" />TradeFlow escrow: live on Base Sepolia</p>
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
                    {s.flow ? (
                      <p className="pm-flow"><span>TradeEscrow</span><span className="pm-flow-track" aria-hidden="true"><span className="pm-flow-dot" /></span><span className="sr-only">pays the</span><span>supplier</span></p>
                    ) : null}
                  </div>
                  <div className="pm-step-foot">
                    <span className="pm-step-icon" aria-hidden="true"><IconContract /></span>
                    <span className="pm-step-fn pm-mono">{s.fn}</span>
                  </div>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section className="pm-proof" id="security" aria-labelledby="pm-proof-title">
          <div className="pm-ascii"><canvas ref={asciiCanvas} aria-hidden="true" /></div>
          <div className="pm-wrap">
            <h2 id="pm-proof-title" className="pm-display pm-reveal-words">Attacked on-chain. Refused on-chain.</h2>
            <p className="pm-lede">Real attacks on the reference treasury on Base Sepolia. Each one was mined and reverted. Open any of them and read the error.</p>
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
                  <Ext href={txUrl(r.hash)} className="pm-actionbar" label={`View the ${r.error} revert of ${r.id} on Basescan`}>
                    <span>View the revert on Basescan</span>
                    <span className="pm-mono">{shortHash(r.hash)}</span>
                    <IconOut />
                  </Ext>
                </li>
              ))}
            </ul>
            <ul className="pm-facts">
              {FACTS.map((f) => (
                <li key={f.title} className="pm-fact">
                  <span className="pm-tile" aria-hidden="true">{f.icon}</span>
                  <h3 className="pm-fact-title">{f.title}</h3>
                  <p className="pm-fact-text">{f.text}</p>
                  {f.link ? <Ext href={f.link.href} className="pm-fact-link pm-mono">{f.link.label}<IconOut /></Ext> : null}
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section className="pm-built" aria-labelledby="pm-built-title">
          <div className="pm-wrap">
            <h2 id="pm-built-title" className="pm-chip pm-chip-light">Built with</h2>
            <ul className="pm-built-row">
              {BUILT.map((b) => (
                <li key={b.name} className="pm-built-item">
                  <span className="pm-built-name">{b.name}</span>
                  <span className="pm-built-use pm-mono">{b.use}</span>
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section className="pm-cta" aria-labelledby="pm-cta-title">
          <div className="pm-wrap">
            <h2 id="pm-cta-title" className="pm-display pm-scrub-words">Run a test treasury on Base Sepolia</h2>
            <p className="pm-lede">Your own Safe, owner key and bank key, made in your browser. Test funds only.</p>
            <div className="pm-pair pm-cta-pair">
              {launch('pm-btn pm-btn-green')}
              {docs}
            </div>
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
              <p id="pm-f1" className="pm-foot-head">RESOURCES/</p>
              <ul className="pm-foot-list">
                <li><Ext href={DOCS_URL}>Docs</Ext></li>
                <li><Ext href={REPO_URL}>GitHub</Ext></li>
                <li><Ext href={STATUS_URL}>Status</Ext></li>
              </ul>
            </nav>
            <nav aria-labelledby="pm-f2">
              <p id="pm-f2" className="pm-foot-head">CONTRACTS ON BASESCAN/</p>
              <ul className="pm-foot-list">
                <li><Ext href={addressUrl(REFERENCE.registry)}>PolicyRegistry</Ext></li>
                <li><Ext href={addressUrl(REFERENCE.module)}>AegisModule</Ext></li>
                <li><Ext href={addressUrl(REFERENCE.safe)}>Reference Safe</Ext></li>
              </ul>
            </nav>
          </div>
          <p className="pm-legal">Testnet only: mock USDC and mock vaults on Base Sepolia. The contracts are not audited.</p>
        </div>
        <div className="pm-field"><canvas ref={barCanvas} aria-hidden="true" /></div>
      </footer>
    </div>
  )
}
