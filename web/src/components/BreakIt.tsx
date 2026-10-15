import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { Hex } from 'viem'
import { useAegis } from '../lib/source'
import { useIdentity } from '../lib/identity'
import { useRequest, useTreasury } from '../lib/queries'
import { plainError } from '../lib/onboard/errors'
import type { AttackKind, AttackResult } from '../lib/onboard/types'
import { ERRORS, isErrorName } from '../lib/vocabulary'
import { ApprovalPanel } from './ActionCard'
import { Chip, ErrorTag } from './bits'
import { SwitchSeat } from './chrome'
import { SignConfirm } from './SignConfirm'
import { TxStatus } from './TxStatus'

const ATTACKS: { kind: AttackKind; title: string; what: string; why: string }[] = [
  { kind: 'tampered', title: 'Tampered record', what: 'The authorizer signs a small deposit. The attacker changes the amount after signing and sends it.', why: 'The amount changed after signing, so the signature recovers to a different key.' },
  { kind: 'replay', title: 'Replayed record', what: 'The attacker sends your last executed record a second time.', why: 'That record already ran once; its nonce is spent.' },
]

function AttackCard({ a }: { a: (typeof ATTACKS)[number] }) {
  const { api } = useAegis()
  const qc = useQueryClient()
  const run = useMutation({
    mutationFn: () => api.attack!(a.kind),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['ledger'] }) },
  })
  const r: AttackResult | undefined = run.data
  return (
    <div className="attack">
      <h3>{a.title}</h3>
      <p>{a.what}</p>
      <button type="button" className="button small danger" disabled={run.isPending} onClick={() => run.mutate()}>{run.isPending ? 'Sending, waiting for the block…' : 'Send the attack'}</button>
      {r ? (
        <div className="attack-result" role="status">
          <p>{r.reverted ? <>Refused on-chain with <ErrorTag name={r.error} short={false} />.</> : <>Not refused. Report this.</>}</p>
          <p className="muted">{isErrorName(r.error) ? ERRORS[r.error].plain : a.why} Nothing moved; the attacker paid the gas.</p>
          <TxStatus hash={r.txHash} label={`${a.title} transaction`} />
        </div>
      ) : run.error ? (
        <div className="attack-result is-plain" role="alert"><p>{plainError(run.error).message}</p></div>
      ) : null}
    </div>
  )
}

function AgentAsk({ message, expect }: { message: string; expect: string }) {
  const { api } = useAegis()
  const { role, signedIn } = useIdentity()
  const ask = useMutation({ mutationFn: () => api.chat(message) })
  const req = useRequest(ask.data?.requestId ?? null)
  const r = req.data
  if (role !== 'owner' || !signedIn) return <SwitchSeat to="owner" className="button small secondary">Switch to the owner seat to ask</SwitchSeat>
  return (
    <>
      <button type="button" className="button small" disabled={ask.isPending} onClick={() => ask.mutate()}>{ask.isPending ? 'Asking…' : `Ask: “${message}”`}</button>
      <p className="muted">{expect}</p>
      {ask.data ? (
        <div className="guided-out" role="status">
          <p>{ask.data.reply}</p>
          <p><Chip state={r?.state ?? ask.data.state} /></p>
          {r?.revertReason ? <p>Refused on-chain with <ErrorTag name={r.revertReason} />.</p> : null}
          {r?.revertReason && r.txHash ? <p><TxStatus hash={r.txHash} label="refused transaction" /></p> : null}
          {!r?.revertReason && r?.txHash ? <p>Executed: <TxStatus hash={r.txHash} label="transaction" /></p> : null}
          {r?.state === 'AWAITING_APPROVAL' && r.actionCard ? <ApprovalPanel card={r.actionCard} role="owner" /> : null}
        </div>
      ) : null}
      {ask.error ? <p className="error-note" role="alert">{plainError(ask.error).message}</p> : null}
    </>
  )
}

function BankStep({ action }: { action: 'bankFreeze' | 'bankUnfreeze' }) {
  const { tenant } = useAegis()
  const { sendAs, localAddress } = useIdentity()
  const qc = useQueryClient()
  const t = useTreasury()
  const [confirm, setConfirm] = useState(false)
  const bank = localAddress('bank')
  const send = useMutation({ mutationFn: () => sendAs('bank', action, [tenant!.safe]), onSettled: () => setConfirm(false) })
  const frozen = t.data?.policy.frozen.bank
  if (!bank || !tenant) return null
  const label = action === 'bankFreeze' ? 'Freeze as the bank' : 'Lift the freeze as the bank'
  return (
    <>
      {confirm ? (
        <SignConfirm role="bank" address={bank} what="a transaction" confirmLabel="Sign and send" busy={send.isPending} onConfirm={() => send.mutate()} onCancel={() => setConfirm(false)}>
          <p><code>{action}</code> on the PolicyRegistry for your Safe. {action === 'bankFreeze' ? 'Deposits stop until the bank lifts it. Exits still run.' : 'Deposits can run again.'}</p>
        </SignConfirm>
      ) : (
        <button type="button" className={`button small ${action === 'bankFreeze' ? 'navy' : 'quiet'}`} disabled={send.isPending || (action === 'bankFreeze' ? frozen === true : frozen === false)} onClick={() => setConfirm(true)}>{label}</button>
      )}
      <p className="muted">Bank freeze is {frozen === undefined ? '…' : frozen ? 'on' : 'off'} now.</p>
      {send.data ? <p className="guided-out" role="status"><span>Sent from your bank key: <TxStatus hash={send.data as Hex} label="bank transaction" onMined={() => { qc.invalidateQueries({ queryKey: ['treasury'] }) }} /></span></p> : null}
      {send.error ? <p className="error-note" role="alert">{plainError(send.error, 'The bank key').message}</p> : null}
    </>
  )
}

export function BreakIt() {
  const { role, signedIn } = useIdentity()
  const t = useTreasury()
  const held = t.data?.balances.vaults.find((v) => BigInt(v.shares.raw || '0') > 0n)?.name ?? 'Vault A'
  return (
    <section className="block" aria-labelledby="break-title">
      <div className="block-head">
        <h2 id="break-title">Try to break it</h2>
        <p>Real attacks on your own treasury. A server attacker key sends each one with a fixed gas limit, so it is mined and you can open the refusal on the explorer.</p>
      </div>
      {role === 'owner' && signedIn ? (
        <div className="break-grid">{ATTACKS.map((a) => <AttackCard key={a.kind} a={a} />)}</div>
      ) : (
        <div className="seat-note"><p>The attacks run against the treasury of the owner seat.</p><SwitchSeat to="owner" className="button small" /></div>
      )}
      <h3 className="guided-title">Freeze, then try to move money</h3>
      <ol className="guided">
        <li><div className="guided-body"><h3>The bank freezes deposits</h3><BankStep action="bankFreeze" /></div></li>
        <li><div className="guided-body"><h3>Ask the agent to deposit</h3><AgentAsk message="Deposit 100 into Vault A" expect="Expected: refused. The agent may stop it before anyone signs, or the contract reverts it with Frozen." /></div></li>
        <li><div className="guided-body"><h3>Ask the agent to exit</h3><AgentAsk message={`Exit ${held}`} expect="Expected: the exit runs, because a freeze never blocks a redeem back to the Safe. With no position there is nothing to exit." /></div></li>
        <li><div className="guided-body"><h3>The bank lifts its freeze</h3><BankStep action="bankUnfreeze" /></div></li>
      </ol>
    </section>
  )
}
