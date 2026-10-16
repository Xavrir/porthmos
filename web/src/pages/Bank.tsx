import { useLayoutEffect, useRef, useState } from 'react'
import { gsap } from 'gsap'
import { onTick, reducedMotion } from '../components/Count'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { Address, Hex } from 'viem'
import { ActionCardView, ApprovalPanel } from '../components/ActionCard'
import { Chip, Empty, ErrorNote, Figure, Hash, Kpis, Loading, PageHeader } from '../components/bits'
import { DataTable, type Column } from '../components/DataTable'
import { DetailDrawer, DrawerSection, KeyValues, useHashParam } from '../components/Drawer'
import { SwitchSeat, usePageTitle } from '../components/chrome'
import { BankLimits } from '../components/BankLimits'
import { TxStatus } from '../components/TxStatus'
import { plainError } from '../lib/onboard/errors'
import { useAegis } from '../lib/source'
import { useIdentity } from '../lib/identity'
import { useBankClients, usePendingApprovals, useReconciliation } from '../lib/queries'
import { stamp } from '../lib/format'
import { toast } from '../lib/toast'
import type { BankAction } from '../lib/api/contract'
import type { BankClient } from '../lib/types'

const ACTION_LABEL: Record<BankAction, string> = { bankFreeze: 'Freeze', bankUnfreeze: 'Unfreeze', revokeAuthorizer: 'Revoke agent' }

export default function Bank() {
  usePageTitle('Bank desk')
  const { mode, tenant } = useAegis()
  const { role, identity, signedIn, session, sessionError, bankAction, isLocal } = useIdentity()
  const qc = useQueryClient()
  const clients = useBankClients()
  const pending = usePendingApprovals()
  const [openSafe, openClient, closeClient] = useHashParam('client')
  const [confirming, setConfirming] = useState<{ action: BankAction; safe: Address } | null>(null)
  const [lastTx, setLastTx] = useState<string | null>(null)
  const [done, setDone] = useState<{ action: BankAction; name: string } | null>(null)
  const sel = (clients.data ?? []).find((c) => c.safe.toLowerCase() === openSafe?.toLowerCase()) ?? null
  const [lastSafe, setLastSafe] = useState<Address | null>(null)
  if (sel && sel.safe !== lastSafe) setLastSafe(sel.safe)
  const recon = useReconciliation(role === 'bank' ? lastSafe ?? clients.data?.[0]?.safe ?? null : null)
  const selRecon = useReconciliation(role === 'bank' && sel ? sel.safe : null)

  const act = useMutation({
    mutationFn: ({ action, safe }: { action: BankAction; safe: Address }) => bankAction(action, safe),
    onSuccess: (h, v) => {
      setConfirming(null)
      setLastTx(h ?? null)
      if (h) toast({ tone: 'ok', title: `${ACTION_LABEL[v.action]} sent`, text: list.find((c) => c.safe === v.safe)?.name }, 5000)
      const name = list.find((c) => c.safe === v.safe)?.name ?? 'the client'
      setDone({ action: v.action, name })
      if (!h) toast({ tone: 'info', title: `${ACTION_LABEL[v.action]}: ${name}`, text: mode === 'replay' ? 'Recorded in the replay. No transaction was sent.' : undefined })
      qc.invalidateQueries({ queryKey: ['bank-clients'] })
      qc.invalidateQueries({ queryKey: ['treasury'] })
    },
  })

  const list = clients.data ?? []
  const frozen = list.filter((c) => c.frozen.bank || c.frozen.owner).length
  const escalations = role === 'bank' ? pending.data ?? [] : []
  const mismatches = list.reduce((a, c) => a + c.mismatches, 0)
  const focus = list.find((c) => c.safe === (lastSafe ?? list[0]?.safe))

  const actError = act.error ? (isLocal ? plainError(act.error, 'The bank key').message : act.error.message) : null
  const doneNote = done ? (
    <div className="ok-note">
      <p>
        {done.action === 'bankFreeze' ? `${done.name}: deposits frozen by the bank. Any deposit now reverts Frozen; exits still run.` : done.action === 'bankUnfreeze' ? `${done.name}: the bank lifted its freeze. Deposits can run again.` : `${done.name}: authorizer revoked and deposits frozen. No new decision record can be signed.`}
        {lastTx ? <> Sent: {mode === 'live' ? <TxStatus hash={lastTx as Hex} label="bank transaction" onMined={() => { qc.invalidateQueries({ queryKey: ['bank-clients'] }); qc.invalidateQueries({ queryKey: ['treasury'] }) }} /> : <Hash value={lastTx} />}</> : mode === 'replay' ? ' Recorded in the replay; no transaction was sent.' : ''}
      </p>
      {mode === 'live' && tenant && done.action !== 'bankUnfreeze' ? (
        <p className="seat-note"><span>To see the effect, ask the agent for a deposit from the owner seat: it is refused. Exits still run.</span> <SwitchSeat to="owner" then="/risk" className="button small quiet">Switch to owner and try to break it</SwitchSeat></p>
      ) : null}
      {mode === 'replay' && done.name === 'Harbour Lane Imports' && done.action !== 'bankUnfreeze' ? (
        <p className="seat-note"><span>To see the effect, look at the waiting deposit as the owner: it now fails its no-freeze check.</span> <SwitchSeat to="owner" then="/copilot" className="button small quiet">Switch to owner and open Copilot</SwitchSeat></p>
      ) : null}
    </div>
  ) : null

  const columns: Column<BankClient>[] = [
    { key: 'name', header: 'Client', primary: true, cell: (c) => c.name },
    { key: 'safe', header: 'Safe', hideNarrow: true, cell: (c) => <Hash value={c.safe} kind="address" label={`${c.name} Safe`} /> },
    { key: 'total', header: 'Total, USDC', align: 'right', cell: (c) => <span className="nums">{c.total?.display ?? ''}</span> },
    { key: 'risk', header: 'Risk', cell: (c) => <RiskScore c={c} /> },
    { key: 'deposits', header: 'Deposits', cell: (c) => <DepositChip c={c} /> },
    { key: 'agent', header: 'Agent', hideNarrow: true, cell: (c) => (c.authorizerRevoked ? <Chip state="REVERTED">Revoked</Chip> : 'Active') },
    { key: 'waiting', header: 'Waiting', align: 'right', hideNarrow: true, cell: (c) => <span className="nums">{c.pendingEscalations}</span> },
    { key: 'mismatch', header: 'Mismatch', align: 'right', cell: (c) => (c.mismatches ? <strong className="link-bad nums">{c.mismatches}</strong> : <span className="nums">0</span>) },
  ]

  return (
    <main id="main" className="page">
      <div className="page-body">
        <PageHeader
          title="Bank risk desk"
          description="Every client agent on one screen. The bank can freeze deposits, revoke an agent and tighten limits. It cannot move funds, add a vault, or stop an exit, and only the bank can lift its own freeze."
          actions={role === 'bank' && escalations.length ? <a className="button" href="#esc-title">Review escalations</a> : null}
        />
        {role === 'bank' ? <Kpis label="Bank desk figures">
          <Figure label="Client agents" value={role === 'bank' ? String(list.length) : '…'} />
          <Figure label="Frozen" value={role === 'bank' ? String(frozen) : '…'} note="Owner or bank freeze" />
          <Figure label="Escalations" value={role === 'bank' ? String(escalations.length) : '…'} note="Tier 4, waiting for the bank" tone={escalations.length ? 'alert' : undefined} />
          <Figure label="Ledger mismatches" value={role === 'bank' ? String(mismatches) : '…'} tone={mismatches ? 'alert' : undefined} />
        </Kpis> : null}

        {role !== 'bank' ? (
          <section className="gate-block" aria-labelledby="gate-title">
            <h2 id="gate-title">This desk is for the bank’s risk officer</h2>
            <p>
              The client list and the freeze controls need the bank’s seat.{' '}
              {session === 'error' && sessionError ? sessionError : mode === 'replay'
                ? `You are viewing as ${role === 'owner' ? 'the business owner' : 'a read-only visitor'}.`
                : signedIn ? `You are signed in as the ${role === 'owner' ? 'owner' : 'holder of no Porthmos role'}.` : identity.kind === 'wallet' ? 'Your wallet is connected but not signed in as the bank.' : 'You are not signed in.'}
            </p>
            <SwitchSeat to="bank" className="button" />
            <p className="muted">In the bank’s seat you can freeze a client, approve a tier 4 deposit and reconcile ledgers. You still cannot move funds.</p>
          </section>
        ) : (
          <>
            <section className="block" aria-labelledby="clients-title">
              <div className="block-head">
                <h2 id="clients-title">Clients</h2>
                <p>Risk score is the highest vault score for that client. Select a client for its detail and ledger check; freeze and revoke sit in the row menu and the detail panel.{mode === 'replay' ? ' Client names other than Harbour Lane Imports are sample data.' : ''}</p>
              </div>
              {clients.isLoading ? <Loading what="clients" /> : (
                <DataTable label="Clients" rows={list} columns={columns} rowKey={(c) => c.safe} rowName={(c) => c.name}
                  onOpen={(c) => openClient(c.safe)} selectedKey={sel?.safe ?? null}
                  status={{ label: 'Deposits', get: depositState, options: DEPOSIT_STATES }}
                  searchText={(c) => `${c.name} ${c.safe}`} searchLabel="Search clients or Safe address"
                  rowMenu={(c) => [
                    { key: 'open', label: 'View details', onSelect: () => openClient(c.safe) },
                    ...actionsFor(c).map((a) => ({ key: a, label: `${ACTION_LABEL[a]}…`, danger: a !== 'bankUnfreeze', onSelect: () => { setConfirming({ action: a, safe: c.safe }); openClient(c.safe) } })),
                    { key: 'copy', label: 'Copy Safe address', onSelect: () => { navigator.clipboard.writeText(c.safe).then(() => toast({ tone: 'ok', title: 'Safe address copied', text: c.safe }, 3500), () => toast({ tone: 'refused', title: 'Could not copy' }, 3500)) } },
                  ]}
                  empty="No clients." />
              )}
              <ErrorNote error={clients.error} />
              {act.error && !sel ? <p className="error-note" role="alert">{actError}</p> : null}
              <div role="status">{doneNote}</div>
            </section>

            {mode === 'live' && isLocal && focus ? <BankLimits safe={focus.safe} /> : null}

            <div className="cols">
              <section className="block col-wide" aria-labelledby="esc-title">
                <div className="block-head">
                  <h2 id="esc-title">Escalations</h2>
                  <p>Deposits above a client’s bank limit need the bank’s EIP-712 approval as well as the owner’s. Without it the module reverts <code>MissingApproval</code>.</p>
                </div>
                {escalations.length ? escalations.map((p) => (
                  <article key={p.requestId} className="escalation">
                    <header><h3>{p.client ?? p.safe}</h3><span className="muted">since {stamp(p.createdAt)}, expires {stamp(p.expiresAt)}</span></header>
                    <ActionCardView card={p.actionCard} />
                    <ApprovalPanel card={p.actionCard} role="bank" />
                  </article>
                )) : <Empty>Nothing waiting for the bank.</Empty>}
              </section>

              <section className="block col-narrow" aria-labelledby="rec-title">
                <div className="block-head">
                  <h2 id="rec-title">{focus ? `${focus.name}: ledger against chain` : 'Reconciliation'}</h2>
                  <p>The desk does not trust the service’s ledger. It reads <code>AegisExecuted</code> events and flags any row that differs or breaks the hash chain.</p>
                </div>
                {recon.isLoading ? <Loading what="reconciliation" /> : recon.data?.length ? (
                  <ul className="recon">
                    {recon.data.map((x) => (
                      <li key={x.key} className={`recon-${x.status}`}>
                        <span className="recon-what">{x.ledger?.summary ?? 'Event with no ledger row'}</span>
                        <span className="recon-amounts nums">
                          Ledger {x.ledger?.amount?.display ?? 'none'}, chain {x.chain?.amount?.display ?? 'none'}
                        </span>
                        <Chip state={x.status === 'match' ? 'CONFIRMED' : 'REVERTED'}>{x.status === 'match' ? 'Match' : x.status === 'amount-mismatch' ? 'Amounts differ' : x.status === 'hash-broken' ? 'Hash chain broken' : x.status.replace(/-/g, ' ')}</Chip>
                      </li>
                    ))}
                  </ul>
                ) : <Empty>No executions to reconcile.</Empty>}
                <ErrorNote error={recon.error} />
              </section>
            </div>

            <section className="block" aria-labelledby="matrix-title">
              <div className="block-head">
                <h2 id="matrix-title">What the bank key can do</h2>
                <p>From the PolicyRegistry role matrix. A stolen bank key can stop deposits; it can never move money.</p>
              </div>
              <div className="table-wrap" tabIndex={0} role="region" aria-label="Role matrix table, scrolls sideways on small screens">
                <table className="table">
                  <thead><tr><th scope="col">Call</th><th scope="col">Bank</th><th scope="col">Owner</th><th scope="col">Note</th></tr></thead>
                  <tbody>
                    <tr><td><code>bankFreeze</code>, <code>bankUnfreeze</code></td><td>Yes</td><td>No</td><td>Only the bank lifts its own freeze</td></tr>
                    <tr><td><code>revokeAuthorizer</code></td><td>Yes</td><td>Yes</td><td>Bank revoke also sets the bank freeze</td></tr>
                    <tr><td>Lower <code>autoCap</code>, <code>dailyCap</code>, <code>maxBandWidth</code></td><td>Yes</td><td>Yes</td><td>The bank may only tighten</td></tr>
                    <tr><td><code>setBankLimit</code></td><td>Yes</td><td>No</td><td>Decides when tier 4 applies</td></tr>
                    <tr><td><code>quarantine</code>, <code>removeVault</code></td><td>Yes</td><td>Yes</td><td>Stops deposits; exits still run</td></tr>
                    <tr><td><code>addVault</code>, <code>setAuthorizer</code>, raise a cap</td><td>No</td><td>Yes</td><td>Reverts <code>Unauthorized</code> for the bank</td></tr>
                  </tbody>
                </table>
              </div>
            </section>
          </>
        )}
      </div>
      <DetailDrawer open={!!sel} onClose={() => { setConfirming(null); closeClient() }} eyebrow="Client" title={sel?.name ?? ''} badge={sel ? <DepositChip c={sel} /> : null}
        amount={sel?.total ? <>{sel.total.display} <span className="drawer-unit">USDC</span></> : null}
        actions={sel ? (confirming?.safe === sel.safe ? (
          <span className="confirm" role="group" aria-label="Confirm bank action">
            <button type="button" className={`button small ${confirming.action === 'bankUnfreeze' ? 'navy' : 'danger'}`} disabled={act.isPending} onClick={() => act.mutate({ action: confirming.action, safe: sel.safe })}>
              {act.isPending ? 'Sending…' : `Confirm ${ACTION_LABEL[confirming.action].toLowerCase()}`}
            </button>
            <button type="button" className="button small quiet" onClick={() => setConfirming(null)}>Cancel</button>
          </span>
        ) : (
          actionsFor(sel).map((a) => (
            <button key={a} type="button" className={`button small ${a === 'bankUnfreeze' ? 'navy' : a === 'bankFreeze' ? 'secondary' : 'quiet'}`} onClick={() => setConfirming({ action: a, safe: sel.safe })}>{ACTION_LABEL[a]}</button>
          ))
        )) : null}>
        {sel ? (
          <>
            {confirming?.safe === sel.safe ? (
              <p className="drawer-note is-warn" role="status">
                {confirming.action === 'bankFreeze' ? 'Freezing stops every deposit for this client. Exits back to the Safe still run, and only the bank can lift its own freeze.' : confirming.action === 'bankUnfreeze' ? 'Lifting the bank freeze lets deposits run again within policy.' : 'Revoking the agent also sets the bank freeze. No new decision record can be signed until the owner sets a new authorizer.'}
                {mode === 'replay' ? ' In replay this is recorded in your browser; no transaction is sent.' : ''}
              </p>
            ) : null}
            {act.error ? <p className="error-note" role="alert">{actError}</p> : null}
            <DrawerSection title="Summary">
              <KeyValues items={[
                { label: 'Safe', value: <Hash value={sel.safe} kind="address" label={`${sel.name} Safe`} head={10} tail={8} /> },
                { label: 'Risk score', value: <RiskScore c={sel} /> },
                { label: 'Deposits', value: sel.frozen.bank ? 'Frozen by the bank' : sel.frozen.owner ? 'Frozen by the owner' : 'Open' },
                { label: 'Agent', value: sel.authorizerRevoked ? 'Authorizer revoked' : 'Active' },
                { label: 'Waiting for the bank', value: <span className="nums">{sel.pendingEscalations}</span> },
                { label: 'Ledger mismatches', value: <span className="nums">{sel.mismatches}</span> },
                sel.policyVersion !== undefined ? { label: 'Policy version', value: <span className="nums">{sel.policyVersion}</span> } : null,
                sel.lastActivity ? { label: 'Last activity', value: <span className="nums">{stamp(sel.lastActivity)}</span> } : null,
              ]} />
            </DrawerSection>
            <DrawerSection title="Ledger against chain">
              {selRecon.isLoading ? <Loading what="reconciliation" /> : selRecon.data?.length ? (
                <ul className="recon">
                  {selRecon.data.map((x) => (
                    <li key={x.key} className={`recon-${x.status}`}>
                      <span className="recon-what">{x.ledger?.summary ?? 'Event with no ledger row'}</span>
                      <Chip state={x.status === 'match' ? 'CONFIRMED' : 'REVERTED'}>{x.status === 'match' ? 'Match' : x.status === 'amount-mismatch' ? 'Amounts differ' : x.status === 'hash-broken' ? 'Hash chain broken' : x.status.replace(/-/g, ' ')}</Chip>
                    </li>
                  ))}
                </ul>
              ) : <p className="muted">No executions to reconcile.</p>}
            </DrawerSection>
          </>
        ) : null}
      </DetailDrawer>
    </main>
  )
}

type DepositState = 'open' | 'owner' | 'bank'
const DEPOSIT_STATES: { value: DepositState; label: string }[] = [
  { value: 'open', label: 'Open' }, { value: 'owner', label: 'Owner frozen' }, { value: 'bank', label: 'Bank frozen' },
]
const depositState = (c: BankClient): DepositState => (c.frozen.bank ? 'bank' : c.frozen.owner ? 'owner' : 'open')

function actionsFor(c: BankClient): BankAction[] {
  const actions: BankAction[] = c.frozen.bank ? ['bankUnfreeze'] : ['bankFreeze']
  if (!c.authorizerRevoked) actions.push('revokeAuthorizer')
  return actions
}

function RiskScore({ c }: { c: BankClient }) {
  return (
    <span className="score">
      <span className="score-bar" aria-hidden="true"><span style={{ transform: `scaleX(${Math.min(1, c.riskScore)})` }} className={c.riskScore >= 0.5 ? 'hot' : ''} /></span>
      <span className="nums"><span className="sr-only">Risk score </span>{c.riskScore.toFixed(2)}</span>
    </span>
  )
}

function DepositChip({ c }: { c: BankClient }) {
  const ref = useRef<HTMLSpanElement>(null)
  const state = depositState(c)
  const prev = useRef(state)
  useLayoutEffect(() => {
    if (prev.current === state) return
    prev.current = state
    const el = ref.current
    if (!el || reducedMotion()) return
    return onTick(() => { gsap.fromTo(el, { rotateX: -90, transformPerspective: 400, transformOrigin: '50% 100%' }, { rotateX: 0, duration: 0.5, ease: 'power3.out' }) })
  }, [state])
  return (
    <span ref={ref} className="chip-flip">
      {state === 'bank' ? <Chip state="POLICY_CHANGED" tone="frozen">Bank frozen</Chip> : state === 'owner' ? <Chip state="POLICY_CHANGED" tone="frozen">Owner frozen</Chip> : <Chip state="CONFIRMED">Open</Chip>}
    </span>
  )
}

