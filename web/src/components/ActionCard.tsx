import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { Address } from 'viem'
import { ErrorNote, ErrorTag, TierMark } from './bits'
import { RecordSheet } from './RecordSheet'
import { SwitchSeat } from './chrome'
import { useAegis } from '../lib/source'
import { useIdentity } from '../lib/identity'
import { CHECK_NAMES, TIERS } from '../lib/vocabulary'
import { REPLAY_SIMULATED_SIGNATURE } from '../lib/api/contract'
import type { ActionCard, Role } from '../lib/types'

const SIGNER_NAMES: Record<string, string> = { authorizer: 'Authorizer', exitKey: 'Exit key', owner: 'Owner', bank: 'Bank' }

export function ActionCardView({ card }: { card: ActionCard }) {
  return (
    <div className="card" data-ui>
      <div className="card-top">
        <p className="card-op"><span className="card-verb">{card.op === 'DEPOSIT' ? 'Deposit' : 'Redeem'}</span> <span className="nums">{card.amount.display}</span> {card.op === 'REDEEM' ? 'shares of' : 'USDC into'} {card.vault.name}</p>
        <TierMark tier={card.tier} />
      </div>
      <p className="card-reason">{card.reason}</p>
      <dl className="card-facts">
        <div><dt>Tier</dt><dd>T{card.tier}, {TIERS[card.tier].name.toLowerCase()}: {TIERS[card.tier].signers.toLowerCase()} sign</dd></div>
        <div><dt>Signers</dt><dd>{card.requiredSigners.map((s) => SIGNER_NAMES[s] ?? s).join(', ')}</dd></div>
        <div><dt>Safe after</dt><dd className="nums">{card.reserveAfter.display} USDC</dd></div>
        <div><dt>Simulation</dt><dd>{card.simulation.ok ? <>Passes, {card.simulation.sharesOut ? `${card.simulation.sharesOut.display} shares out` : card.simulation.assetsOut ? `${card.simulation.assetsOut.display} USDC out` : 'ok'}</> : <>Would revert <ErrorTag name={card.simulation.error} /></>}</dd></div>
      </dl>
      {card.policyChecks.length ? (
        <ul className="checks" aria-label="Policy checks">
          {card.policyChecks.map((c) => (
            <li key={c.name} className={c.ok ? 'ok' : 'bad'}>
              <span className="check-mark" aria-hidden="true">{c.ok ? 'Pass' : 'Fail'}</span>
              <span className="check-name">{CHECK_NAMES[c.name] ?? c.name}</span>
              <span className="check-detail">{c.detail}</span>
              <span className="sr-only">{c.ok ? 'passes' : 'fails'}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}

export function ApprovalPanel({ card, role, onDone }: { card: ActionCard; role: Role; onDone?: () => void }) {
  const { api, deployment, chainId, mode: dataMode } = useAegis()
  const { role: myRole, sign, identity } = useIdentity()
  const qc = useQueryClient()
  const [reason, setReason] = useState('')
  const [correction, setCorrection] = useState('')
  const [mode, setMode] = useState<'deny' | 'correct' | null>(null)
  const typed = card.approvalTypedData
  const replaying = identity.kind === 'replay'
  const recordedSig = useQuery({
    queryKey: ['recorded-approval', dataMode, card.requestId],
    queryFn: async () => (await api.recordedApproval?.(card.requestId)) ?? null,
    enabled: replaying,
  })

  const approve = useMutation({
    mutationFn: async () => {
      if (!typed) throw new Error('This action has no approval to sign.')
      const signature = replaying ? recordedSig.data?.signature ?? REPLAY_SIMULATED_SIGNATURE : await sign(typed)
      return api.submitApproval(card.requestId, { signature, approval: typed.message })
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['approvals'] }); qc.invalidateQueries({ queryKey: ['request'] }); onDone?.() },
  })
  const deny = useMutation({
    mutationFn: () => api.deny(card.requestId, reason),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['approvals'] }); qc.invalidateQueries({ queryKey: ['request'] }); onDone?.() },
  })
  const correct = useMutation({
    mutationFn: () => api.correct(card.requestId, correction),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['approvals'] }); qc.invalidateQueries({ queryKey: ['request'] }); qc.invalidateQueries({ queryKey: ['requests'] }); onDone?.() },
  })

  const expected: { address: Address; label: string } = role === 'bank' ? { address: deployment.roles.bank, label: 'bank' } : { address: deployment.roles.owner, label: 'owner' }
  const canAct = myRole === role
  const busy = approve.isPending || deny.isPending || correct.isPending
  const failing = card.policyChecks.filter((c) => !c.ok)

  return (
    <div className="approval" id={`approval-${card.requestId}`} tabIndex={-1} aria-labelledby={`approval-title-${card.requestId}`}>
      <h3 id={`approval-title-${card.requestId}`}>{role === 'bank' ? 'Bank approval' : 'Your approval'}</h3>
      <p>
        You sign an envelope, not the transaction: a ceiling of {card.amount.display} for {card.vault.name}, valid 24 hours, tied to policy v{String(typed?.message.policyVersion ?? '')}. The authorizer fills in fresh market data later, and the contract checks it still fits.
      </p>
      <p className={`check-sum${failing.length ? ' is-bad' : ''}`}>
        {failing.length
          ? <>Right now it would not run. Failing check: {failing.map((c) => CHECK_NAMES[c.name] ?? c.name).join(', ')}.{card.simulation.ok ? '' : <> The contract would revert <ErrorTag name={card.simulation.error} short={false} />.</>} Approving now leads to a hold, not a transaction.</>
          : `All ${card.policyChecks.length} policy checks pass and the simulation passes.`}
      </p>
      {!canAct ? (
        <div className="seat-note">
          <p className="muted">
            {replaying ? `You are viewing as ${myRole === 'bank' ? 'the bank officer' : myRole === 'owner' ? 'the owner' : 'a read-only visitor'}.` : myRole ? `Signed in as the ${myRole === 'bank' ? 'bank officer' : 'owner'}.` : identity.kind === 'wallet' ? 'This wallet holds no AEGIS role.' : 'You are not signed in.'}{' '}
            Only the {role === 'bank' ? 'bank officer' : 'owner'} can sign this.
          </p>
          <SwitchSeat to={role} className="button small" />
        </div>
      ) : (
        <>
          {replaying ? (
            <p className="muted">Replay holds no keys. {recordedSig.data ? 'This approval was recorded, so its illustrative signature is submitted and checked by recovery.' : 'This approval was not recorded, so it is submitted as simulated and marked so in the ledger.'}</p>
          ) : null}
          <div className="decide">
            <button type="button" className={`button ${role === 'bank' ? 'navy' : ''}`} disabled={busy || !typed} onClick={() => approve.mutate()}>
              {approve.isPending ? 'Signing…' : replaying ? (recordedSig.data ? 'Approve (recorded signature)' : 'Approve (simulated)') : `Approve and sign as ${role === 'bank' ? 'bank' : 'owner'}`}
            </button>
            <button type="button" className="button quiet" aria-expanded={mode === 'deny'} aria-controls={`deny-${card.requestId}`} onClick={() => setMode(mode === 'deny' ? null : 'deny')}>Deny…</button>
            <button type="button" className="button quiet" aria-expanded={mode === 'correct'} aria-controls={`correct-${card.requestId}`} onClick={() => setMode(mode === 'correct' ? null : 'correct')}>Change the amount…</button>
          </div>
          {mode === 'deny' ? (
            <form className="inline-form" id={`deny-${card.requestId}`} onSubmit={(e) => { e.preventDefault(); deny.mutate() }}>
              <label>Reason, optional<input className="field" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Not this week" /></label>
              <button type="submit" className="button danger" disabled={busy}>{deny.isPending ? 'Denying…' : 'Confirm deny'}</button>
            </form>
          ) : mode === 'correct' ? (
            <form className="inline-form" id={`correct-${card.requestId}`} onSubmit={(e) => { e.preventDefault(); correct.mutate() }}>
              <label>Correction<input className="field" required value={correction} onChange={(e) => setCorrection(e.target.value)} placeholder="Make it 900" /></label>
              <button type="submit" className="button secondary" disabled={busy}>{correct.isPending ? 'Sending…' : 'Send correction'}</button>
            </form>
          ) : null}
        </>
      )}
      <ErrorNote error={approve.error ?? deny.error ?? correct.error} />
      {typed ? (
        <details className="sign-detail" open>
          <summary>The record you sign</summary>
          <RecordSheet record={{ primaryType: 'Approval', message: typed.message, signature: null, signer: null }} chainId={typed.domain.chainId ?? chainId} module={typed.domain.verifyingContract} expected={expected} names={{ [deployment.safe.toLowerCase()]: 'Safe', [deployment.vaultA.toLowerCase()]: 'Vault A', [deployment.vaultB.toLowerCase()]: 'Vault B' }} showNotes />
        </details>
      ) : null}

      <p className="sr-only" role="status">{approve.isSuccess ? 'Approved. The authorizer now revalidates, signs the record and submits.' : deny.isSuccess ? 'Denied. Nothing was signed.' : ''}</p>
    </div>
  )
}
