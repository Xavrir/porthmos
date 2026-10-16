import { useLayoutEffect, useRef, useState } from 'react'
import { gsap } from 'gsap'
import { onTick, reducedMotion } from '../components/Count'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { Address, Hex } from 'viem'
import { ActionCardView, ApprovalPanel } from '../components/ActionCard'
import { Chip, Empty, ErrorNote, Figure, Hash, Kpis, Loading, PageHeader } from '../components/bits'
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
  const [selected, setSelected] = useState<Address | null>(null)
  const [confirming, setConfirming] = useState<{ action: BankAction; safe: Address } | null>(null)
  const [lastTx, setLastTx] = useState<string | null>(null)
  const [done, setDone] = useState<{ action: BankAction; name: string } | null>(null)
  const recon = useReconciliation(role === 'bank' ? selected ?? clients.data?.[0]?.safe ?? null : null)

  const act = useMutation({
    mutationFn: ({ action, safe }: { action: BankAction; safe: Address }) => bankAction(action, safe),
    onSuccess: (h, v) => {
      setConfirming(null)
      setLastTx(h ?? null)
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
  const focus = list.find((c) => c.safe === (selected ?? list[0]?.safe))

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
                <p>Risk score is the highest vault score for that client. Select a row to reconcile its ledger against the chain.{mode === 'replay' ? ' Client names other than Harbour Lane Imports are sample data.' : ''}</p>
              </div>
              {clients.isLoading ? <Loading what="clients" /> : list.length ? (
                <div className="table-wrap is-tall">
                  <table className="table clients">
                    <thead>
                      <tr><th scope="col">Client</th><th scope="col">Safe</th><th scope="col" className="r">Total, USDC</th><th scope="col">Risk</th><th scope="col">Deposits</th><th scope="col">Agent</th><th scope="col" className="r">Waiting</th><th scope="col" className="r">Mismatch</th><th scope="col">Bank actions</th></tr>
                    </thead>
                    <tbody>
                      {list.map((c) => (
                        <ClientRow key={c.safe} c={c} selected={focus?.safe === c.safe} onSelect={() => setSelected(c.safe)}
                          confirming={confirming?.safe === c.safe ? confirming.action : null}
                          onAsk={(action) => setConfirming({ action, safe: c.safe })}
                          onCancel={() => setConfirming(null)}
                          onConfirm={(action) => act.mutate({ action, safe: c.safe })}
                          busy={act.isPending} />
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : <Empty>No clients.</Empty>}
              <ErrorNote error={clients.error} />
              {act.error ? <p className="error-note" role="alert">{isLocal ? plainError(act.error, 'The bank key').message : act.error.message}</p> : null}
              <div role="status">
                {done ? (
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
                ) : null}
              </div>
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
    </main>
  )
}

function ClientRow({ c, selected, onSelect, confirming, onAsk, onCancel, onConfirm, busy }: {
  c: BankClient; selected: boolean; onSelect: () => void; confirming: BankAction | null
  onAsk: (a: BankAction) => void; onCancel: () => void; onConfirm: (a: BankAction) => void; busy: boolean
}) {
  const chipRef = useRef<HTMLTableCellElement>(null)
  const state = c.frozen.bank ? 'bank' : c.frozen.owner ? 'owner' : 'open'
  const prevState = useRef(state)
  useLayoutEffect(() => {
    if (prevState.current === state) return
    prevState.current = state
    const cell = chipRef.current
    if (!cell || reducedMotion()) return
    return onTick(() => { gsap.fromTo(cell.firstElementChild, { rotateX: -90, transformPerspective: 400, transformOrigin: '50% 100%' }, { rotateX: 0, duration: 0.5, ease: 'power3.out' }) })
  }, [state])
  const actions: BankAction[] = c.frozen.bank ? ['bankUnfreeze'] : ['bankFreeze']
  if (!c.authorizerRevoked) actions.push('revokeAuthorizer')
  return (
    <tr className={selected ? 'is-open' : undefined}>
      <td>
        <button type="button" className="row-toggle wide" aria-pressed={selected} onClick={onSelect}>{c.name}</button>
      </td>
      <td><Hash value={c.safe} kind="address" label={`${c.name} Safe`} /></td>
      <td className="r nums">{c.total?.display ?? ''}</td>
      <td>
        <span className="score" aria-label={`Risk score ${c.riskScore.toFixed(2)}`}>
          <span className="score-bar" aria-hidden="true"><span style={{ transform: `scaleX(${Math.min(1, c.riskScore)})` }} className={c.riskScore >= 0.5 ? 'hot' : ''} /></span>
          <span className="nums">{c.riskScore.toFixed(2)}</span>
        </span>
      </td>
      <td ref={chipRef}>{c.frozen.bank ? <Chip state="POLICY_CHANGED">Bank frozen</Chip> : c.frozen.owner ? <Chip state="POLICY_CHANGED">Owner frozen</Chip> : <Chip state="CONFIRMED">Open</Chip>}</td>
      <td>{c.authorizerRevoked ? <Chip state="REVERTED">Revoked</Chip> : 'Active'}</td>
      <td className="r nums">{c.pendingEscalations}</td>
      <td className="r nums">{c.mismatches ? <strong className="link-bad">{c.mismatches}</strong> : 0}</td>
      <td>
        {confirming ? (
          <span className="confirm">
            <button type="button" className={`button small ${confirming === 'bankUnfreeze' ? 'navy' : 'danger'}`} disabled={busy} onClick={() => onConfirm(confirming)}>
              {busy ? 'Sending…' : `Confirm ${ACTION_LABEL[confirming].toLowerCase()}`}
            </button>
            <button type="button" className="button small quiet" onClick={onCancel}>Cancel</button>
          </span>
        ) : (
          <span className="confirm">
            {actions.map((a) => (
              <button key={a} type="button" className={`button small ${a === 'bankUnfreeze' ? 'navy' : a === 'bankFreeze' ? 'secondary' : 'quiet'}`} onClick={() => onAsk(a)}>{ACTION_LABEL[a]}</button>
            ))}
          </span>
        )}
      </td>
    </tr>
  )
}
