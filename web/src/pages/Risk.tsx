import { useMutation } from '@tanstack/react-query'
import { OracleChart, RiskRadar } from '../components/charts'
import { Chip, ErrorNote, Figure, Hash, Loading } from '../components/bits'
import { usePageTitle } from '../components/chrome'
import { useAegis } from '../lib/source'
import { useOracle, useRisk } from '../lib/queries'
import { clock, money, num, pct, stamp } from '../lib/format'
import { TRIGGERS } from '../lib/policy'
import type { ScenarioName, StreamEvent } from '../lib/types'

const SCENARIOS: { name: ScenarioName; label: string; what: string }[] = [
  { name: 'depeg', label: 'Depeg', what: 'Price falls to 0.9850. The peg trigger fires; the Exit Agent quarantines both vaults and redeems to the Safe.' },
  { name: 'liquidity', label: 'Liquidity squeeze', what: 'Vault B lets only 1,500 leave. The Exit Agent takes what it can now and retries every window.' },
  { name: 'stale', label: 'Stale oracle', what: 'The keeper stops. Past 180 s, deposits would revert StaleOracle; exits still run.' },
  { name: 'obligation', label: 'New invoice', what: 'A 2,000 customs bill is approved. The floor is out of date until the owner signs; then the agent covers it.' },
  { name: 'restore', label: 'Restore', what: 'Return to the recorded base state: healthy peg, both vaults open, one approval waiting.' },
]

function describe(e: StreamEvent): string | null {
  switch (e.type) {
    case 'notice': return e.data.text
    case 'state': return `${e.data.requestId}: ${e.data.state.replace(/_/g, ' ').toLowerCase()}${e.data.note ? `. ${e.data.note}` : ''}`
    case 'ledger': return `Ledger row ${e.data.seq}: ${e.data.summary}`
    case 'execution': return `${e.data.name} in block ${e.data.blockNumber}`
    case 'oracle': return `Price ${e.data.price.display}, ${e.data.ageSeconds} s old${e.data.stale ? ', stale' : ''}`
    default: return null
  }
}

export default function Risk() {
  usePageTitle('Risk')
  const { api, chainId, feed, mode, health } = useAegis()
  const risk = useRisk()
  const oracle = useOracle()
  const run = useMutation({ mutationFn: (n: ScenarioName) => api.scenario(n) })
  const o = oracle.data
  const price = o ? Number(o.price.display) : 1
  const triggers = risk.data?.vaults.flatMap((v) => v.triggers.map((t) => ({ vault: v.name, t }))) ?? []
  const quarantined = risk.data?.vaults.filter((v) => v.quarantined) ?? []
  const lab = mode === 'replay' || (chainId === 31337 && health?.demo !== false)
  const log = feed.map((f) => ({ id: f.id, at: f.at, text: describe(f.event) })).filter((x) => x.text && !x.text.startsWith('Price ')).slice(0, 14)

  return (
    <main id="main" className="page">
      <section className="page-band c-red">
        <div className="wrap band-grid">
          <div className="band-head">
            <h1>Risk</h1>
            <p className="band-lede">Three hard triggers, checked every five blocks. Any one quarantines the vault and sends the Exit Agent in. It can only redeem back to the Safe.</p>
          </div>
          <div className="band-figures">
            <Figure label="Oracle price" value={o ? o.price.display : '…'} note={o ? `${pct(Math.abs(price - 1), 2)} from 1.0000` : ''} tone={Math.abs(price - 1) > TRIGGERS.pegDeviation ? 'alert' : undefined} />
            <Figure label="Price age" value={o ? `${o.ageSeconds} s` : '…'} note={`Limit ${o?.maxOracleAge ?? TRIGGERS.maxOracleAge} s, heartbeat 60 s`} tone={o?.stale ? 'alert' : undefined} />
            <Figure label="Triggers firing" value={String(triggers.length)} note={triggers[0]?.t ?? 'None'} tone={triggers.length ? 'alert' : undefined} />
            <Figure label="Quarantined" value={String(quarantined.length)} note={quarantined.map((v) => v.name).join(', ') || 'Both vaults open'} />
          </div>
        </div>
      </section>

      <div className="page-body wrap">
        <section className="block" aria-labelledby="oracle-title">
          <div className="block-head">
            <h2 id="oracle-title">Oracle</h2>
            <p>Chainlink-style feed, 8 decimals. Deposits must also land inside the signed price band, no wider than 0.0200.</p>
          </div>
          {o ? <OracleChart history={o.history ?? []} price={price} stale={o.stale} /> : <Loading what="the oracle" />}
          <ErrorNote error={oracle.error} />
          {o ? <p className="muted small-print">Last update {stamp(o.updatedAt)}{o.stale ? '. Stale: deposits revert StaleOracle; exits still run.' : '.'}</p> : null}
        </section>

        <section className="block" aria-labelledby="radar-title">
          <div className="block-head">
            <h2 id="radar-title">Vault radar</h2>
            <p>Ranking score r = 0.4 peg + 0.3 liquidity + 0.2 utilisation + 0.1 concentration. The weights are configuration, not calibrated values. Triggers act on their own, whatever the score.</p>
          </div>
          {risk.data ? (
            <div className="radars">
              {risk.data.vaults.map((v) => (
                <article key={v.address} className={`radar-card${v.triggers.length ? ' is-alert' : ''}`}>
                  <header>
                    <h3>{v.name}</h3>
                    {v.quarantined ? <Chip state="QUARANTINED">Quarantined</Chip> : v.triggers.length ? <Chip state="REVERTED">Trigger firing</Chip> : <Chip state="CONFIRMED">Open</Chip>}
                  </header>
                  <RiskRadar components={v.components} alert={v.triggers.length > 0} />
                  <dl className="facts">
                    <div><dt>Score</dt><dd className="nums">{v.score.toFixed(3)}</dd></div>
                    <div><dt>Position</dt><dd className="nums">{v.position?.display ?? 'n/a'}</dd></div>
                    <div><dt>Can leave now</dt><dd className="nums">{v.maxRedeem.display}</dd></div>
                    <div><dt>Address</dt><dd><Hash value={v.address} kind="address" label={v.name} /></dd></div>
                  </dl>
                  {v.triggers.length ? (
                    <ul className="trigger-list">{v.triggers.map((t) => <li key={t}>{t}</li>)}</ul>
                  ) : <p className="muted">No trigger. Liquidity needs at least 1.2 × the position to be withdrawable{v.position ? ` (${money(num(v.position) * 1.2)})` : ''}.</p>}
                </article>
              ))}
            </div>
          ) : <Loading what="the risk report" />}
          <ErrorNote error={risk.error} />
        </section>

        <div className="cols">
          <section className="block col-wide" aria-labelledby="lab-title">
            <div className="block-head">
              <h2 id="lab-title">Stress lab</h2>
              <p>{mode === 'replay' ? 'Each button plays a recorded scenario inside your browser; watch the system respond through the event stream.' : lab ? 'Local chain 31337 only. Each button calls /api/demo/scenario and you watch the system respond through the event stream.' : 'Scenario controls exist only on the local demo chain (31337).'}</p>
            </div>
            {lab ? (
              <div className="scenarios">
                {SCENARIOS.map((s) => (
                  <div key={s.name} className="scenario">
                    <button type="button" className={`button ${s.name === 'restore' ? 'quiet' : s.name === 'obligation' ? 'secondary' : 'danger'}`} disabled={run.isPending} onClick={() => run.mutate(s.name)}>
                      {run.isPending && run.variables === s.name ? 'Running…' : s.label}
                    </button>
                    <p>{s.what}</p>
                  </div>
                ))}
              </div>
            ) : null}
            <ErrorNote error={run.error} />
          </section>

          <section className="block col-narrow" aria-labelledby="log-title">
            <div className="block-head">
              <h2 id="log-title">Event stream</h2>
              <p>Newest first, from /api/stream{mode === 'replay' ? ' (replayed in the browser)' : ''}.</p>
            </div>
            {log.length ? (
              <ol className="log" aria-live="polite">
                {log.map((l) => <li key={l.id}><span className="nums muted">{clock(Math.floor(l.at / 1000))}</span> {l.text}</li>)}
              </ol>
            ) : <p className="empty">Quiet. Run a scenario to see the stream.</p>}
          </section>
        </div>

        <section className="block" aria-labelledby="rules-title">
          <div className="block-head">
            <h2 id="rules-title">Hard exit triggers</h2>
            <p>From the technical document. Quarantine is cleared only by the owner, after 24 hours with no trigger.</p>
          </div>
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th scope="col">Trigger</th><th scope="col">Threshold</th><th scope="col">Why</th></tr></thead>
              <tbody>
                <tr><td>Peg deviation</td><td className="nums">|p − 1.00| &gt; 1.0%</td><td>Outside 1% a stablecoin is in distress, not noise.</td></tr>
                <tr><td>Oracle staleness</td><td className="nums">older than 180 s</td><td>Three missed 60 s heartbeats; never act on dead data.</td></tr>
                <tr><td>Withdrawable liquidity</td><td className="nums">maxRedeem &lt; 1.2 × position</td><td>Leave before the exit door closes, not after.</td></tr>
              </tbody>
            </table>
          </div>
          <p className="muted small-print">With one stable asset and one feed, a depeg exit reduces vault risk (lock-up, bad debt, a run on the vault), not exposure to the coin itself.</p>
        </section>
      </div>
    </main>
  )
}
