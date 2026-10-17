import { useMutation } from '@tanstack/react-query'
import { GroupedBars, OracleChart, type Slot } from '../components/charts'
import { Chip, ErrorNote, Figure, Hash, Kpis, Loading, PageHeader, Section } from '../components/bits'
import { DataTable, type Column } from '../components/DataTable'
import { usePageTitle } from '../components/chrome'
import { BreakIt } from '../components/BreakIt'
import { useAegis } from '../lib/source'
import { useOracle, useRisk } from '../lib/queries'
import { clock, pct, stamp } from '../lib/format'
import { TRIGGERS } from '../lib/policy'
import type { ScenarioName, StreamEvent, VaultRisk } from '../lib/types'

const SCENARIOS: { name: ScenarioName; label: string; what: string }[] = [
  { name: 'depeg', label: 'Depeg', what: 'Price drops to 0.9850' },
  { name: 'liquidity', label: 'Liquidity squeeze', what: 'Vault B lets 1,500 leave' },
  { name: 'stale', label: 'Stale oracle', what: 'The keeper stops' },
  { name: 'obligation', label: 'New invoice', what: 'A 2,000 customs bill' },
  { name: 'restore', label: 'Restore', what: 'Back to the recorded base' },
]

const COMPONENTS = [
  { key: 'peg', label: 'Peg' },
  { key: 'liquidity', label: 'Liquidity' },
  { key: 'utilisation', label: 'Utilisation' },
  { key: 'concentration', label: 'Concentration' },
] as const

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

function VaultStatus({ v }: { v: VaultRisk }) {
  return v.quarantined ? <Chip state="QUARANTINED">Quarantined</Chip> : v.triggers.length ? <Chip state="REVERTED">Trigger firing</Chip> : <Chip state="CONFIRMED">Open</Chip>
}

export default function Risk() {
  usePageTitle('Risk')
  const { api, chainId, feed, mode, health, tenant } = useAegis()
  const risk = useRisk()
  const oracle = useOracle()
  const run = useMutation({ mutationFn: (n: ScenarioName) => api.scenario(n) })
  const o = oracle.data
  const price = o ? Number(o.price.display) : 1
  const off = Math.abs(price - 1)
  const limit = o?.maxOracleAge ?? TRIGGERS.maxOracleAge
  const vaults = risk.data?.vaults ?? []
  const triggers = vaults.flatMap((v) => v.triggers.map((t) => ({ vault: v.name, t })))
  const quarantined = vaults.filter((v) => v.quarantined)
  const lab = mode === 'replay' || (chainId === 31337 && health?.demo !== false)
  const log = feed.map((f) => ({ id: f.id, at: f.at, text: describe(f.event) })).filter((x) => x.text && !x.text.startsWith('Price ')).slice(0, 14)

  const columns: Column<VaultRisk>[] = [
    { key: 'name', header: 'Vault', primary: true, cell: (v) => v.name },
    { key: 'status', header: 'Status', cell: (v) => <VaultStatus v={v} /> },
    { key: 'score', header: 'Score', align: 'right', cell: (v) => <span className="nums">{v.score.toFixed(3)}</span> },
    { key: 'position', header: 'Position, USDC', align: 'right', cell: (v) => <span className="nums">{v.position?.display ?? ''}</span> },
    { key: 'leave', header: 'Can leave now', align: 'right', cell: (v) => <span className="nums">{v.maxRedeem.display}</span> },
    { key: 'triggers', header: 'Triggers', hideNarrow: true, cell: (v) => (v.triggers.length ? v.triggers.join(', ') : <span className="muted">None</span>) },
    { key: 'address', header: 'Address', hideNarrow: true, cell: (v) => <Hash value={v.address} kind="address" label={v.name} /> },
  ]

  return (
    <main id="main" className="page">
      <div className="page-body">
        <PageHeader
          title="Risk"
          info="Three hard triggers, checked every five blocks. Any one quarantines the vault and sends the Exit Agent in. It can only redeem back to the Safe."
          actions={lab ? <a className="button quiet" href="#lab">Stress lab</a> : null}
        />
        <Kpis label="Risk figures">
          <Figure label="Oracle price" value={o ? o.price.display : '…'} note={o ? `${pct(off, 2)} from peg` : ''} tone={off > TRIGGERS.pegDeviation ? 'alert' : undefined}
            info="Exit trigger: more than 1% from 1.0000." />
          <Figure label="Price age" value={o ? `${o.ageSeconds} s` : '…'} note={o?.stale ? 'Stale' : `Limit ${limit} s`} tone={o?.stale ? 'alert' : undefined}
            meter={o ? { value: Math.min(o.ageSeconds, limit), max: limit, label: `Price age ${o.ageSeconds} of ${limit} seconds`, tone: o.stale ? 'bad' : o.ageSeconds > limit * 0.66 ? 'warn' : undefined } : undefined}
            info="Heartbeat 60 s. Past the limit, deposits revert StaleOracle; exits still run." />
          <Figure label="Triggers firing" value={risk.data ? String(triggers.length) : '…'} note={triggers[0] ? `${triggers[0].vault}: ${triggers[0].t}` : 'None'} tone={triggers.length ? 'alert' : undefined} />
          <Figure label="Quarantined" value={risk.data ? String(quarantined.length) : '…'} note={quarantined.map((v) => v.name).join(', ') || 'Both vaults open'} tone={quarantined.length ? 'alert' : undefined} />
        </Kpis>

        <Section title="Oracle price" className="card"
          info="Chainlink-style feed with 8 decimals. Deposits must also land inside the signed price band, no wider than 0.0200."
          actions={o ? (o.stale ? <Chip state="HELD">Stale</Chip> : <span className="card-meta nums">Updated {stamp(o.updatedAt)}</span>) : null}>
          {o ? <OracleChart history={o.history ?? []} price={price} stale={o.stale} /> : <Loading what="the oracle" shape="chart" />}
          <ErrorNote error={oracle.error} />
        </Section>

        <Section title="Vault risk" className="card"
          info="Ranking score r = 0.4 peg + 0.3 liquidity + 0.2 utilisation + 0.1 concentration. Higher is riskier. The weights are configuration, not calibrated values; triggers act on their own, whatever the score.">
          {risk.data ? (
            <>
              <GroupedBars label="Risk components by vault, higher is riskier"
                categories={COMPONENTS.map((c) => ({ key: c.key, label: c.label }))}
                series={vaults.slice(0, 3).map((v, i) => ({ key: v.address, label: v.name, slot: (i + 2) as Slot, values: { ...v.components } }))} />
              <DataTable label="Vaults" rows={vaults} columns={columns} rowKey={(v) => v.address} rowName={(v) => v.name} />
            </>
          ) : <Loading what="the risk report" />}
          <ErrorNote error={risk.error} />
        </Section>

        {mode === 'live' && tenant ? <BreakIt /> : null}

        <div className="cols">
          <Section title="Stress lab" id="lab" className="card col-wide"
            info={mode === 'replay' ? 'Each button plays a recorded scenario in your browser. Watch the system respond in the event stream.' : lab ? 'Local chain 31337 only. Each button calls /api/demo/scenario.' : 'Market scenarios move the shared price feed and vaults, so only the Porthmos team runs them here.'}>
            {lab ? (
              <ul className="scenarios">
                {SCENARIOS.map((s) => (
                  <li key={s.name} className="scenario">
                    <button type="button" className="button small quiet" disabled={run.isPending} onClick={() => run.mutate(s.name)}>
                      {run.isPending && run.variables === s.name ? 'Running…' : s.label}
                    </button>
                    <span className="muted">{s.what}</span>
                  </li>
                ))}
              </ul>
            ) : <p className="empty">Scenario controls run on the local demo chain only.</p>}
            <ErrorNote error={run.error} />
          </Section>

          <Section title="Event stream" className="card col-narrow" info={`Newest first, from /api/stream${mode === 'replay' ? ', replayed in the browser' : ''}.`}>
            {log.length ? (
              <ol className="log" aria-live="polite">
                {log.map((l) => <li key={l.id}><span className="nums muted">{clock(Math.floor(l.at / 1000))}</span> {l.text}</li>)}
              </ol>
            ) : <p className="empty">Quiet. Run a scenario.</p>}
          </Section>
        </div>

        <Section title="Exit triggers" info="From the technical document. Quarantine is cleared only by the owner, after 24 hours with no trigger. With one stable asset and one feed, a depeg exit reduces vault risk, not exposure to the coin itself.">
          <div className="table-wrap" tabIndex={0} role="region" aria-label="Exit triggers table, scrolls sideways on small screens">
            <table className="table">
              <thead><tr><th scope="col">Trigger</th><th scope="col">Threshold</th><th scope="col">Why</th></tr></thead>
              <tbody>
                <tr><td>Peg deviation</td><td className="nums">|p − 1.00| &gt; 1.0%</td><td>Outside 1% a stablecoin is in distress</td></tr>
                <tr><td>Oracle staleness</td><td className="nums">older than 180 s</td><td>Three missed heartbeats</td></tr>
                <tr><td>Withdrawable liquidity</td><td className="nums">maxRedeem &lt; 1.2 × position</td><td>Leave before the exit door closes</td></tr>
              </tbody>
            </table>
          </div>
        </Section>
      </div>
    </main>
  )
}
