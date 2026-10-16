import { Fragment, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { gsap } from 'gsap'
import { onTick, reducedMotion } from '../components/Count'
import { useSearchParams } from 'react-router-dom'
import { Chip, Empty, ErrorNote, ErrorTag, Figure, Hash, Kpis, Loading, PageHeader, TierMark } from '../components/bits'
import { DecisionChain } from '../components/DecisionChain'
import { EvidencePanel } from '../components/EvidencePanel'
import { expectedSigner, RecordSheet } from '../components/RecordSheet'
import { usePageTitle } from '../components/chrome'
import { useAegis } from '../lib/source'
import { useChainEvents, useLedger, useReconciliation, useRequest } from '../lib/queries'
import { verifyLinks } from '../lib/reconcile'
import { fromUnits, money, shortHex, stamp, TIME_ZONE_LABEL } from '../lib/format'
import { ERRORS, isErrorName } from '../lib/vocabulary'
import { chainName, explorerTx } from '../lib/wallet'
import { isRecordedTx } from '../replay/hashes'
import { CONTRACT_SUITE, proofFor, proofSentence, refusalFor } from '../lib/proof'
import type { ChainEvent, LedgerRow } from '../lib/types'

const FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'execution', label: 'Executed' },
  { key: 'rejected', label: 'Refused' },
  { key: 'hold', label: 'Held or cancelled' },
  { key: 'policy', label: 'Policy and risk' },
] as const

type FilterKey = (typeof FILTERS)[number]['key']

function TxCell({ row }: { row: LedgerRow }) {
  const { mode } = useAegis()
  if (row.revertReason && row.kind === 'rejection' && mode === 'replay' && !isRecordedTx(row.txHash)) {
    const ref = refusalFor(row.revertReason)
    const p = ref ? proofFor(ref) : null
    return (
      <span className="tx-none">
        Replay only, no transaction.{' '}
        {p?.kind === 'onchain' ? <a className="link-plain" href={p.href} target="_blank" rel="noreferrer">Real revert on Basescan</a> : ref ? `Contract test ${ref.test}` : null}
      </span>
    )
  }
  return row.txHash ? <Hash value={row.txHash} label={`transaction for row ${row.seq}`} /> : <span className="muted">none</span>
}

function matches(r: LedgerRow, f: FilterKey, error: string | null) {
  if (error) return error === 'No transaction' ? r.kind === 'injection' : r.revertReason === error
  if (f === 'all') return true
  if (f === 'execution') return r.kind === 'execution'
  if (f === 'rejected') return r.kind === 'rejection' || r.kind === 'injection' || r.kind === 'denial'
  if (f === 'hold') return r.kind === 'hold' || r.kind === 'cancel'
  return r.kind === 'policy' || r.kind === 'risk' || r.kind === 'obligation'
}

function eventSummary(e: ChainEvent) {
  if (e.name === 'AegisExecuted') return `${Number(e.args.op) === 0 ? 'Deposit' : 'Redeem'} ${money(fromUnits(String(e.args.assets)))} USDC, ${money(fromUnits(String(e.args.shares)))} shares, tier ${e.args.tier}`
  if (e.name === 'PolicyChanged') return `Policy v${e.args.version}, selector ${String(e.args.selector)}`
  return `Vault ${shortHex(String(e.args.vault))} quarantined by ${shortHex(String(e.args.by))}`
}

export default function Audit() {
  usePageTitle('Audit')
  const { chainId, deployment, mode } = useAegis()
  const ledger = useLedger()
  const events = useChainEvents()
  const recon = useReconciliation(deployment.safe)
  const [params, setParams] = useSearchParams()
  const error = params.get('error')
  const [filter, setFilter] = useState<FilterKey>('all')
  const [open, setOpen] = useState<number | null>(null)

  const links = useMemo(() => (ledger.data ? verifyLinks(ledger.data) : new Map<number, boolean>()), [ledger.data])
  const intact = ledger.data ? [...links.values()].every(Boolean) : null
  const rows = useMemo(() => (ledger.data ?? []).filter((r) => matches(r, filter, error)).sort((a, b) => b.seq - a.seq), [ledger.data, filter, error])
  const executed = ledger.data?.filter((r) => r.kind === 'execution').length ?? 0
  const refused = ledger.data?.filter((r) => r.kind === 'rejection' || r.kind === 'injection').length ?? 0
  const mismatches = recon.data?.filter((x) => x.status !== 'match').length
  const tableRef = useRef<HTMLTableSectionElement>(null)
  const seen = useRef<Set<number> | null>(null)
  useLayoutEffect(() => {
    if (!ledger.data) return
    const seqs = ledger.data.map((r) => r.seq)
    if (!seen.current) { seen.current = new Set(seqs); return }
    const fresh = seqs.filter((n) => !seen.current!.has(n))
    fresh.forEach((n) => seen.current!.add(n))
    const body = tableRef.current
    if (!fresh.length || !body || reducedMotion()) return
    const els = fresh.map((n) => body.querySelector(`tr[data-seq="${n}"]`)).filter(Boolean) as Element[]
    if (els.length) return onTick(() => { gsap.fromTo(els, { autoAlpha: 0, y: -12 }, { autoAlpha: 1, y: 0, duration: 0.5, ease: 'power3.out', stagger: 0.06, clearProps: 'opacity,visibility,transform' }) })
  }, [ledger.data])

  return (
    <main id="main" className="page">
      <div className="page-body">
        <PageHeader
          title="Audit"
          description="Every decision leaves a row: executions, refusals, holds and denials. Each row hashes the one before it, and the bank reads the chain to check the ledger."
          actions={<a className="button quiet" href="#evidence">Recorded on-chain evidence</a>}
        />
        <Kpis label="Audit figures">
          <Figure label="Ledger rows" value={ledger.data ? String(ledger.data.length) : '…'} note={intact === null ? '' : intact ? 'Hash chain intact' : 'Hash chain broken'} tone={intact === false ? 'alert' : undefined} />
          <Figure label="Executed" value={String(executed)} note="AegisExecuted events" />
          <Figure label="Refused" value={String(refused)} note={mode === 'replay' ? 'In the replay narrative. Real status under Recorded on Base Sepolia' : 'Typed reverts and unrepresentable requests'} />
          <Figure label="Ledger against chain" value={mismatches === undefined ? '…' : mismatches === 0 ? 'Reconciled' : `${mismatches} mismatch`} tone={mismatches ? 'alert' : undefined} />
        </Kpis>

        <section className="block" aria-labelledby="ledger-title">
          <div className="block-head">
            <h2 id="ledger-title">Decision ledger</h2>
            <p>Newest first, times in {TIME_ZONE_LABEL}. Open a row to see its decision chain, its signed record and the hashes that link it.</p>
          </div>
          <div className="filters" role="group" aria-label="Filter rows">
            {FILTERS.map((f) => (
              <button key={f.key} type="button" aria-pressed={!error && filter === f.key} onClick={() => { setFilter(f.key); if (error) setParams({}) }}>{f.label}</button>
            ))}
            {error ? (
              <span className="filter-error">
                Showing <code>{error}</code>{isErrorName(error) ? `: ${ERRORS[error].short}.` : '.'}{' '}
                <button type="button" className="link-plain clear-filter" onClick={() => setParams({})}>Clear</button>
              </span>
            ) : null}
          </div>
          {error && refusalFor(error) ? (
            <p className="proof-note" role="status">
              {(() => {
                const p = proofFor(refusalFor(error)!)
                return p.kind === 'onchain'
                  ? <>On Base Sepolia: <a className="link-plain" href={p.href} target="_blank" rel="noreferrer">a real {error} revert, block {p.block.toLocaleString('en-US')}</a>. The rows below are the replay narrative.</>
                  : <>{proofSentence(p)} The tests are in <code>{CONTRACT_SUITE.path}</code>. The rows below are the replay narrative and carry no transaction.</>
              })()}
            </p>
          ) : null}
          {ledger.isLoading ? <Loading what="the ledger" /> : rows.length ? (
            <div className="table-wrap is-tall">
              <table className="table ledger">
                <thead>
                  <tr><th scope="col">Row</th><th scope="col">Time</th><th scope="col">Outcome</th><th scope="col">What happened</th><th scope="col">Tier</th><th scope="col" className="r">Amount</th><th scope="col">Transaction</th><th scope="col">Hash chain</th></tr>
                </thead>
                <tbody ref={tableRef}>
                  {rows.map((r) => (
                    <Fragment key={r.seq}>
                      <tr data-seq={r.seq} className={`ledger-row${open === r.seq ? ' is-open' : ''}`}>
                        <td className="nums cell-row">
                          <button type="button" className="row-toggle" aria-expanded={open === r.seq} aria-controls={`row-${r.seq}`} onClick={() => setOpen(open === r.seq ? null : r.seq)}>
                            <span className="row-num">{r.seq}</span><span className="row-open-label">{open === r.seq ? 'Close' : 'Details'}</span><span className="sr-only"> for row {r.seq}</span>
                          </button>
                        </td>
                        <td className="nums nowrap cell-time">{stamp(r.ts)}</td>
                        <td className="cell-outcome">{r.kind === 'rejection' && mode === 'replay' && !isRecordedTx(r.txHash) ? <Chip state={r.state}>Refused in replay</Chip> : <Chip state={r.state} />}</td>
                        <td className="summary cell-what">{r.summary}{r.revertReason ? <> <ErrorTag name={r.revertReason} /></> : null}</td>
                        <td className="cell-tier" data-label="Tier"><TierMark tier={r.tier} /></td>
                        <td className="r nums cell-amount" data-label="Amount">{r.amount?.display ?? ''}</td>
                        <td className="cell-tx" data-label="Transaction"><TxCell row={r} /></td>
                        <td className="cell-link" data-label="Hash chain">{links.get(r.seq) ? <span className="chain-ok">Chain OK</span> : <span className="link-bad">Broken</span>}</td>
                      </tr>
                      {open === r.seq ? (
                        <tr className="row-detail" id={`row-${r.seq}`}>
                          <td colSpan={8}><RowDetail row={r} /></td>
                        </tr>
                      ) : null}
                    </Fragment>
                  ))}
                </tbody>
              </table>
            </div>
          ) : <Empty>No rows match this filter.</Empty>}
          <ErrorNote error={ledger.error} />
        </section>

        <EvidencePanel />

        <div className="cols">
          <section className="block col-wide" aria-labelledby="events-title">
            <div className="block-head">
              <h2 id="events-title">On-chain events</h2>
              <p>Read from {chainName(chainId)}. {mode === 'replay' ? 'Contract addresses are the Base Sepolia deployment. Hashes of recorded transactions link to Basescan; the others are tagged illustrative and not linked.' : explorerTx(chainId, '0x0') ? 'Hashes link to the block explorer.' : 'This chain has no public explorer; hashes are copyable.'}</p>
            </div>
            {events.isLoading ? <Loading what="events" /> : events.data?.length ? (
              <div className="table-wrap is-tall">
                <table className="table">
                  <thead><tr><th scope="col">Block</th><th scope="col">Event</th><th scope="col">Detail</th><th scope="col">Transaction</th></tr></thead>
                  <tbody>
                    {[...events.data].sort((a, b) => b.blockNumber - a.blockNumber).map((e) => (
                      <tr key={`${e.txHash}-${e.logIndex}`}>
                        <td className="nums">{e.blockNumber}</td>
                        <td><code>{e.name}</code></td>
                        <td>{eventSummary(e)}</td>
                        <td><Hash value={e.txHash} label={`${e.name} transaction`} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : <Empty>No events yet.</Empty>}
            <ErrorNote error={events.error} />
          </section>

          <section className="block col-narrow" aria-labelledby="recon-title">
            <div className="block-head">
              <h2 id="recon-title">Ledger against chain</h2>
              <p>Every executed row must match an <code>AegisExecuted</code> event with the same hash and amount. The bank desk runs the same check for every client.</p>
            </div>
            {recon.data ? (
              <ul className="recon">
                {recon.data.map((x) => (
                  <li key={x.key} className={`recon-${x.status}`}>
                    <span>{x.ledger ? `Row ${x.ledger.seq}` : 'No row'} against {x.chain ? `block ${x.chain.blockNumber}` : 'no event'}</span>
                    <Chip state={x.status === 'match' ? 'CONFIRMED' : 'REVERTED'}>{x.status === 'match' ? 'Match' : x.status.replace(/-/g, ' ')}</Chip>
                  </li>
                ))}
              </ul>
            ) : <Loading what="reconciliation" />}
          </section>
        </div>
      </div>
    </main>
  )
}

function RowDetail({ row }: { row: LedgerRow }) {
  const { deployment, chainId, mode } = useAegis()
  const req = useRequest(row.requestId ?? null)
  const r = req.data
  return (
    <div className="detail">
      <dl className="facts detail-facts">
        <div><dt>Previous hash</dt><dd><code>{shortHex(row.prevHash, 10, 8)}</code></dd></div>
        <div><dt>Row hash</dt><dd><code>{shortHex(row.rowHash, 10, 8)}</code></dd></div>
        {row.evidenceHash ? <div><dt>Evidence hash</dt><dd><code>{shortHex(row.evidenceHash, 10, 8)}</code></dd></div> : null}
        {row.requestId ? <div><dt>Request</dt><dd><code>{row.requestId}</code></dd></div> : null}
        {row.revertReason ? <div><dt>Revert</dt><dd><ErrorTag name={row.revertReason} /> {isErrorName(row.revertReason) ? ERRORS[row.revertReason].plain : ''}</dd></div> : null}
      </dl>
      {r ? (
        <div className="detail-body">
          <DecisionChain history={r.history} revertReason={r.revertReason} compact />
          {r.dar ? (
            <RecordSheet record={r.dar} chainId={chainId} module={deployment.module} illustrative={mode === 'replay'}
              expected={expectedSigner(r.dar, mode, r.origin === 'exit_agent' ? { address: deployment.roles.exitKey, label: 'exit key' } : { address: deployment.roles.authorizer, label: 'authorizer' })} />
          ) : null}
          {r.explanation ? <p className="decision-why">{r.explanation}</p> : null}
        </div>
      ) : row.requestId && req.isLoading ? <Loading what="the request" /> : null}
    </div>
  )
}
