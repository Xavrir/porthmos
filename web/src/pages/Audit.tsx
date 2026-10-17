import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Chip, ErrorNote, ErrorTag, Figure, Hash, Kpis, Loading, PageHeader, Section, stateTone, TierMark, type Tone } from '../components/bits'
import { DataTable, type Column } from '../components/DataTable'
import { CopyButton, DetailDrawer, DrawerSection, KeyValues, Timeline, useHashParam, type TimelineItem } from '../components/Drawer'
import { Icon } from '../components/icons'
import { toast } from '../lib/toast'
import { dailyTotals, latestTs } from '../lib/history'
import { EvidencePanel } from '../components/EvidencePanel'
import { expectedSigner, RecordSheet } from '../components/RecordSheet'
import { usePageTitle } from '../components/chrome'
import { useAegis } from '../lib/source'
import { useChainEvents, useLedger, useReconciliation, useRequest } from '../lib/queries'
import { verifyLinks } from '../lib/reconcile'
import { fromUnits, money, shortHex, stamp, TIME_ZONE_LABEL } from '../lib/format'
import { ERRORS, isErrorName, sentenceCase } from '../lib/vocabulary'
import { chainName, explorerTx } from '../lib/wallet'
import { isRecordedTx } from '../replay/hashes'
import { CONTRACT_SUITE, proofFor, proofSentence, refusalFor } from '../lib/proof'
import type { ChainEvent, LedgerRow, WorkflowState } from '../lib/types'

const FILTERS = [
  { value: 'execution', label: 'Executed' },
  { value: 'rejected', label: 'Refused' },
  { value: 'hold', label: 'Held or cancelled' },
  { value: 'policy', label: 'Policy and risk' },
]

function group(r: LedgerRow): string {
  if (r.kind === 'execution') return 'execution'
  if (r.kind === 'rejection' || r.kind === 'injection' || r.kind === 'denial') return 'rejected'
  if (r.kind === 'hold' || r.kind === 'cancel') return 'hold'
  return 'policy'
}

function txHref(row: LedgerRow, chainId: number, mode: string) {
  if (!row.txHash) return undefined
  if (mode === 'replay' && !isRecordedTx(row.txHash)) return undefined
  return explorerTx(chainId, row.txHash)
}

function TxCell({ row }: { row: LedgerRow }) {
  const { mode } = useAegis()
  if (row.revertReason && row.kind === 'rejection' && mode === 'replay' && !isRecordedTx(row.txHash)) {
    const ref = refusalFor(row.revertReason)
    const p = ref ? proofFor(ref) : null
    return (
      <span className="tx-none">
        None.{' '}
        {p?.kind === 'onchain' ? <a className="link-plain" href={p.href} target="_blank" rel="noreferrer">Real revert</a> : ref ? `Test ${ref.test}` : null}
      </span>
    )
  }
  return row.txHash ? <Hash value={row.txHash} label={`transaction for row ${row.seq}`} /> : <span className="muted">None</span>
}

function errorMatch(r: LedgerRow, error: string) {
  return error === 'No transaction' ? r.kind === 'injection' : r.revertReason === error
}

function OutcomeChip({ r }: { r: LedgerRow }) {
  const { mode } = useAegis()
  return r.kind === 'rejection' && mode === 'replay' && !isRecordedTx(r.txHash) ? <Chip state={r.state}>Refused in replay</Chip> : <Chip state={r.state} />
}

function eventSummary(e: ChainEvent) {
  if (e.name === 'AegisExecuted') return `${Number(e.args.op) === 0 ? 'Deposit' : 'Redeem'} ${money(fromUnits(String(e.args.assets)))} USDC, ${money(fromUnits(String(e.args.shares)))} shares, tier ${e.args.tier}`
  if (e.name === 'PolicyChanged') return `Policy v${e.args.version}, selector ${String(e.args.selector)}`
  return `Vault ${shortHex(String(e.args.vault))} quarantined by ${shortHex(String(e.args.by))}`
}

export default function Audit() {
  usePageTitle('Audit')
  const { chainId, mode, deployment } = useAegis()
  const ledger = useLedger()
  const events = useChainEvents()
  const recon = useReconciliation(deployment.safe)
  const [params, setParams] = useSearchParams()
  const error = params.get('error')
  const [status, setStatus] = useState<string | null>(null)
  const [openSeq, openRow, closeRow] = useHashParam('row')

  const links = useMemo(() => (ledger.data ? verifyLinks(ledger.data) : new Map<number, boolean>()), [ledger.data])
  const intact = ledger.data ? [...links.values()].every(Boolean) : null
  const all = useMemo(() => [...(ledger.data ?? [])].sort((a, b) => b.seq - a.seq), [ledger.data])
  const rows = useMemo(() => (error ? all.filter((r) => errorMatch(r, error)) : all), [all, error])
  const executed = ledger.data?.filter((r) => r.kind === 'execution').length ?? 0
  const refused = ledger.data?.filter((r) => r.kind === 'rejection' || r.kind === 'injection').length ?? 0
  const mismatches = recon.data?.filter((x) => x.status !== 'match').length
  const daily = useMemo(() => {
    const list = ledger.data ?? []
    const end = latestTs(list)
    return {
      rows: dailyTotals(list.map((r) => ({ t: r.ts, v: 1 })), 7, end),
      refused: dailyTotals(list.filter((r) => r.kind === 'rejection' || r.kind === 'injection').map((r) => ({ t: r.ts, v: 1 })), 7, end),
    }
  }, [ledger.data])
  const selected = openSeq ? all.find((r) => String(r.seq) === openSeq) ?? null : null


  const columns: Column<LedgerRow>[] = [
    { key: 'seq', header: 'Row', className: 'dt-seq', cell: (r) => <span className="nums">{r.seq}</span> },
    { key: 'what', header: 'What happened', primary: true, className: 'dt-wide', cell: (r) => <>{r.summary}{r.revertReason ? <> <code className="err-code">{r.revertReason}</code></> : null}</> },
    { key: 'outcome', header: 'Outcome', cell: (r) => <OutcomeChip r={r} /> },
    { key: 'amount', header: 'Amount', align: 'right', cell: (r) => <span className="nums">{r.amount?.display ?? ''}</span> },
    { key: 'tier', header: 'Tier', hideNarrow: true, cell: (r) => <TierMark tier={r.tier} /> },
    { key: 'time', header: `Time, ${TIME_ZONE_LABEL}`, label: 'Time', cell: (r) => <span className="nums nowrap">{stamp(r.ts)}</span> },
    { key: 'tx', header: 'Transaction', hideNarrow: true, cell: (r) => <TxCell row={r} /> },
    { key: 'chain', header: 'Hash chain', hideNarrow: true, cell: (r) => (links.get(r.seq) ? <span className="chain-ok">Linked</span> : <span className="link-bad">Broken</span>) },
  ]

  return (
    <main id="main" className="page">
      <div className="page-body">
        <PageHeader
          title="Audit"
          info="Every decision leaves a row: executions, refusals, holds and denials. Each row hashes the one before it, and the bank reads the chain to check the ledger."
          actions={<a className="button quiet" href="#evidence">On-chain evidence</a>}
        />
        <Kpis label="Audit figures">
          <Figure label="Ledger rows" value={ledger.data ? String(ledger.data.length) : '…'} spark={ledger.data?.length ? daily.rows : undefined} sparkLabel="Rows per day, last 7 days"
            note={intact === null ? '' : intact ? 'Hash chain intact' : 'Hash chain broken'} tone={intact === false ? 'alert' : undefined} />
          <Figure label="Executed" value={ledger.data ? String(executed) : '…'} note="AegisExecuted rows" />
          <Figure label="Refused" value={ledger.data ? String(refused) : '…'} spark={ledger.data?.length ? daily.refused : undefined} sparkLabel="Refusals per day, last 7 days"
            note="Last 7 days" info={mode === 'replay' ? 'Counts rows of the replay narrative. Real refusals on Base Sepolia are listed under On-chain evidence.' : 'Typed reverts and requests no action can express.'} />
          <Figure label="Ledger against chain" value={mismatches === undefined ? '…' : mismatches === 0 ? 'Reconciled' : `${mismatches} mismatch`} tone={mismatches ? 'alert' : undefined}
            note={recon.data ? `${recon.data.length} checked` : ''} />
        </Kpis>

        <Section title="Decision ledger" info={`Newest first, times in ${TIME_ZONE_LABEL}. Open a row for its timeline, signed record and hash links.`}>
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
          {ledger.isLoading ? <Loading what="the ledger" rows={6} shape="table" /> : (
            <DataTable label="Ledger rows" rows={rows} columns={columns} rowKey={(r) => String(r.seq)} rowName={(r) => `row ${r.seq}`}
              onOpen={(r) => openRow(String(r.seq))} selectedKey={openSeq} tall
              status={{ label: 'Outcome', get: group, options: FILTERS }} statusValue={status} onStatusChange={setStatus}
              searchText={(r) => `${r.seq} ${r.summary} ${r.revertReason ?? ''} ${r.amount?.display ?? ''} ${r.vault ?? ''} ${r.txHash ?? ''} ${r.state}`}
              searchLabel="Search rows, amounts, errors"
              chips={error ? (
                <span className="fchip is-on">
                  <button type="button" className="fchip-x" onClick={() => setParams({})} aria-label="Clear error filter"><Icon name="clear" /></button>
                  <span className="fchip-main is-static">Error<span className="fchip-sep" aria-hidden="true" /><span className="fchip-value">{error}</span></span>
                </span>
              ) : undefined}
              onClearAll={() => { if (error) setParams({}) }}
              rowMenu={(r) => {
                const href = txHref(r, chainId, mode)
                return [
                  { key: 'open', label: 'View details', onSelect: () => openRow(String(r.seq)) },
                  { key: 'copy', label: 'Copy row hash', onSelect: () => { void copyText(r.rowHash, 'Row hash copied') } },
                  ...(href ? [{ key: 'tx', label: 'Open transaction on Basescan', onSelect: () => { window.open(href, '_blank', 'noopener,noreferrer') } }] : []),
                  ...(r.revertReason ? [{ key: 'err', label: `Show every ${r.revertReason}`, onSelect: () => setParams({ error: r.revertReason! }) }] : []),
                ]
              }}
              rowAttrs={(r) => ({ 'data-seq': r.seq })}
              empty="No ledger rows yet." />
          )}
          <ErrorNote error={ledger.error} />
        </Section>

        <div className="cols">
          <Section title="On-chain events" className="col-wide"
            info={`Read from ${chainName(chainId)}.${mode === 'replay' ? ' Replay lists only transactions recorded on Base Sepolia.' : explorerTx(chainId, '0x0') ? ' Hashes link to the block explorer.' : ' This chain has no public explorer; hashes are copyable.'}`}>
            {events.isLoading ? <Loading what="events" /> : (
              <DataTable label="On-chain events" rows={[...(events.data ?? [])].sort((a, b) => b.blockNumber - a.blockNumber)} tall
                rowKey={(e) => `${e.txHash}-${e.logIndex}`}
                columns={[
                  { key: 'block', header: 'Block', cell: (e) => <span className="nums">{e.blockNumber}</span> },
                  { key: 'name', header: 'Event', cell: (e) => <code>{e.name}</code> },
                  { key: 'detail', header: 'Detail', className: 'dt-wide', cell: (e) => eventSummary(e) },
                  { key: 'tx', header: 'Transaction', cell: (e) => <Hash value={e.txHash} label={`${e.name} transaction`} /> },
                ]}
                empty="No events yet." />
            )}
            <ErrorNote error={events.error} />
          </Section>

          <Section title="Ledger against chain" className="col-narrow" info="Every executed row must match an AegisExecuted event with the same hash and amount. The bank desk runs the same check for every client.">
            {recon.data ? (recon.data.length ? (
              <ul className="recon">
                {recon.data.map((x) => (
                  <li key={x.key} className={`recon-${x.status}`}>
                    <span>{x.ledger ? `Row ${x.ledger.seq}` : 'No row'} against {x.chain ? `block ${x.chain.blockNumber}` : 'no event'}</span>
                    <Chip state={x.status === 'match' ? 'CONFIRMED' : 'REVERTED'}>{x.status === 'match' ? 'Match' : x.status.replace(/-/g, ' ')}</Chip>
                  </li>
                ))}
              </ul>
            ) : <p className="empty">No executions with a transaction yet.</p>) : <Loading what="reconciliation" />}
          </Section>
        </div>

        <EvidencePanel />
      </div>
      <RowDrawer row={selected} linked={selected ? links.get(selected.seq) ?? false : false} onClose={closeRow} onError={(e) => setParams({ error: e })} />
    </main>
  )
}

async function copyText(value: string, title: string) {
  try {
    await navigator.clipboard.writeText(value)
    toast({ tone: 'ok', title, text: shortHex(value, 10, 8) }, 3500)
  } catch {
    toast({ tone: 'refused', title: 'Could not copy', text: 'The browser blocked the clipboard.' }, 4000)
  }
}

const TL_TONE: Record<Tone, TimelineItem['tone']> = { ok: 'ok', held: 'held', wait: 'held', frozen: 'neutral', refused: 'refused', info: 'info', neutral: 'neutral' }

function RowDrawer({ row, linked, onClose, onError }: { row: LedgerRow | null; linked: boolean; onClose: () => void; onError: (e: string) => void }) {
  const { deployment, chainId, mode } = useAegis()
  const req = useRequest(row?.requestId ?? null)
  const r = row?.requestId ? req.data : undefined
  const href = row ? txHref(row, chainId, mode) : undefined
  return (
    <DetailDrawer open={!!row} onClose={onClose} eyebrow={row ? `Ledger row ${row.seq}` : ''}
      title={row ? (row.amount ? `${row.op === 'REDEEM' ? 'Redeem' : row.op === 'DEPOSIT' ? 'Deposit' : 'Amount'} ${row.vault ? `into ${row.vault}` : ''}`.replace('Redeem into', 'Redeem from').trim() : KIND_TITLE[row.kind]) : ''}
      badge={row ? <OutcomeChip r={row} /> : null}
      amount={row?.amount ? <>{row.amount.display} <span className="drawer-unit">USDC</span></> : null}
      actions={row ? (
        <>
          {href ? <a className="button small quiet" href={href} target="_blank" rel="noreferrer">Basescan <Icon name="external" /></a> : null}
          <button type="button" className="button small quiet" onClick={() => { void copyText(row.rowHash, 'Row hash copied') }}><Icon name="copy" />Row hash</button>
          {row.revertReason ? <button type="button" className="button small quiet" onClick={() => { onClose(); onError(row.revertReason!) }}>Show every {row.revertReason}</button> : null}
        </>
      ) : null}>
      {row ? (
        <>
          <p className="drawer-lede">{row.summary}</p>
          {row.revertReason ? (
            <p className="drawer-note is-bad"><ErrorTag name={row.revertReason} short={false} /> {isErrorName(row.revertReason) ? ERRORS[row.revertReason].plain : ''}</p>
          ) : null}
          <DrawerSection title="Summary">
            <KeyValues items={[
              { label: 'Time', value: <span className="nums">{stamp(row.ts)} ({TIME_ZONE_LABEL})</span> },
              { label: 'Outcome', value: sentenceCase(row.state as WorkflowState) },
              row.tier !== undefined && { label: 'Tier', value: <TierMark tier={row.tier} short /> },
              row.vault ? { label: 'Vault', value: row.vault } : null,
              { label: 'Transaction', value: <TxCell row={row} /> },
              row.requestId ? { label: 'Request', value: <span className="kv-copy"><code>{row.requestId}</code><CopyButton value={row.requestId} label="request ID" /></span> } : null,
            ]} />
          </DrawerSection>
          {r?.history?.length ? (
            <DrawerSection title="Timeline">
              <Timeline items={[...r.history].reverse().map((h, i) => ({
                key: `${h.state}-${i}`, title: sentenceCase(h.state), note: h.note, time: stamp(h.at), tone: TL_TONE[stateTone(h.state)],
              }))} />
            </DrawerSection>
          ) : row.requestId && req.isLoading ? <Loading what="the request" /> : null}
          {r?.explanation ? <p className="decision-why">{r.explanation}</p> : null}
          {r?.dar ? (
            <DrawerSection title="Signed record">
              <RecordSheet record={r.dar} chainId={chainId} module={deployment.module} illustrative={mode === 'replay'}
                expected={expectedSigner(r.dar, mode, r.origin === 'exit_agent' ? { address: deployment.roles.exitKey, label: 'exit key' } : { address: deployment.roles.authorizer, label: 'authorizer' })} />
            </DrawerSection>
          ) : null}
          <DrawerSection title="Raw fields">
            <KeyValues items={[
              { label: 'Row hash', value: <span className="kv-copy"><code>{shortHex(row.rowHash, 10, 8)}</code><CopyButton value={row.rowHash} label="row hash" /></span> },
              { label: 'Previous hash', value: <span className="kv-copy"><code>{shortHex(row.prevHash, 10, 8)}</code><CopyButton value={row.prevHash} label="previous hash" /></span> },
              row.evidenceHash ? { label: 'Evidence hash', value: <span className="kv-copy"><code>{shortHex(row.evidenceHash, 10, 8)}</code><CopyButton value={row.evidenceHash} label="evidence hash" /></span> } : null,
              { label: 'Hash chain', value: linked ? <span className="chain-ok">Linked to row {row.seq - 1 || 'genesis'}</span> : <span className="link-bad">Broken</span> },
              { label: 'Kind', value: <code>{row.kind}</code> },
            ]} />
          </DrawerSection>
        </>
      ) : null}
    </DetailDrawer>
  )
}

const KIND_TITLE: Record<LedgerRow['kind'], string> = {
  execution: 'Execution', rejection: 'Refusal', hold: 'Hold', denial: 'Denial', policy: 'Policy change', risk: 'Risk action', obligation: 'Obligation change', injection: 'Refused request', cancel: 'Cancellation',
}
