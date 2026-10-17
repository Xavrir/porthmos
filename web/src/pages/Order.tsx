import { useState, type CSSProperties, type ReactNode } from 'react'
import { Link, useLocation, useParams, useSearchParams } from 'react-router-dom'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { Hex } from 'viem'
import { ErrorNote, Hash, InfoTip, Loading, PageHeader, Section } from '../components/bits'
import { SwitchSeat, usePageTitle } from '../components/chrome'
import { CopyButton } from '../components/Drawer'
import { MenuButton } from '../components/Menu'
import { SignConfirm } from '../components/SignConfirm'
import { TxStatus } from '../components/TxStatus'
import { Meter } from '../components/charts'
import { Icon } from '../components/icons'
import { CountText } from '../components/Count'
import { HeldFlag, IssuerLabel, MilestonePill, OrderPill, Pill } from '../components/orders'
import { useAegis } from '../lib/source'
import { useIdentity } from '../lib/identity'
import { fromUnits, money, shortHex, stamp } from '../lib/format'
import { buildRefundTx, buildWaiveTx, type SafePlan } from '../lib/txguard'
import { confirmationPayload } from '../lib/tradeflow/confirm'
import { conditionText } from '../lib/tradeflow/model'
import { useFreeze, useOrder, useTradeFlow, type TradeFlowState } from '../lib/tradeflow/queries'
import { recordedBlock } from '../lib/tradeflow/replay'
import { committedRaw, conditionChecks, heldCount, milestoneDisplay, milestoneSpec, orderDisplay, PROPOSAL_TEXT, reasonText } from '../lib/tradeflow/state'
import type { DemoVariant, OrderMilestone, OrderView } from '../lib/tradeflow/types'
import { toast } from '../lib/toast'

const usdc = (raw: bigint) => money(fromUnits(raw))
const VARIANTS: { v: DemoVariant; label: string; hint: string }[] = [
  { v: 'valid', label: 'Valid proof', hint: 'Passes every condition' },
  { v: 'outOfRange', label: 'Out of range', hint: 'Fails the condition, so the milestone is held' },
  { v: 'corrected', label: 'Corrected proof', hint: 'A new valid proof after a hold; needs your confirmation' },
]

type Pending = { kind: 'waive' | 'refund'; plan: SafePlan; index?: number } | { kind: 'confirm'; index: number; proofHash: Hex; expiry: number }

export default function Order() {
  const { id } = useParams()
  const loc = useLocation()
  const [params] = useSearchParams()
  const supplierView = loc.pathname.startsWith('/o/') || params.get('view') === 'supplier'
  usePageTitle(id ? `Order ${id}${supplierView ? ', supplier view' : ''}` : 'Order')
  const { mode, chainId, tenant, deployment, http } = useAegis()
  const { role, address, sendTx, sign } = useIdentity()
  const qc = useQueryClient()
  const tf = useTradeFlow()
  const q = useOrder(id, supplierView && mode === 'live')
  const o = q.data ?? null
  const freeze = useFreeze(o && !supplierView ? o.order.buyer : undefined)
  const [pending, setPending] = useState<Pending | null>(null)
  const [sent, setSent] = useState<{ hash: Hex; label: string } | null>(null)

  const owner = !supplierView && mode === 'live' && role === 'owner' && !!o && o.view === 'full'
  const ownSafe = (tenant?.safe ?? deployment.safe).toLowerCase() === o?.order.buyer.toLowerCase()
  const canAct = owner && ownSafe && !tf.blocked
  const refresh = () => { qc.invalidateQueries({ queryKey: ['order'] }); qc.invalidateQueries({ queryKey: ['orders'] }) }

  const demo = useMutation({
    mutationFn: ({ index, variant }: { index: number; variant: DemoVariant }) => http.demoProof(id!, index, variant),
    onSuccess: (r, v) => {
      const label = VARIANTS.find((x) => x.v === v.variant)!.label
      toast({ tone: r.state === 'HELD' ? 'refused' : 'ok', title: `${label} admitted`, text: r.awaitingConfirmation ? 'Waiting for your confirmation.' : r.state === 'HELD' ? `Held: ${r.reason}` : `Milestone ${r.index + 1} is ${r.state.toLowerCase().replace(/_/g, ' ')}.` }, 5000)
      refresh()
    },
  })

  const act = useMutation({
    mutationFn: async (p: Pending): Promise<{ hash?: Hex; label: string }> => {
      if (p.kind === 'confirm') {
        if (!tf.pinned) throw new Error('This build pins no TradeEscrow for this chain.')
        const signature = await sign(confirmationPayload(chainId, tf.pinned.tradeEscrow, { orderId: id!, index: p.index, proofHash: p.proofHash, expiry: p.expiry }))
        await http.confirmRelease(id!, { index: p.index, proofHash: p.proofHash, expiry: p.expiry, signature })
        return { label: 'confirmation' }
      }
      return { hash: await sendTx(p.plan.tx), label: p.kind === 'waive' ? 'waive' : 'refund' }
    },
    onSuccess: (r) => {
      setPending(null)
      if (r.hash) setSent({ hash: r.hash, label: r.label })
      else toast({ tone: 'ok', title: 'Release confirmed', text: 'The service asks the Authorizer for the release.' }, 5000)
      refresh()
    },
  })

  const ask = (make: () => Pending) => {
    act.reset()
    try { setPending(make()) } catch (e) { toast({ tone: 'refused', title: 'Refused', text: (e as Error).message }, 8000) }
  }
  const waive = (m: OrderMilestone) => ask(() => ({ kind: 'waive', index: m.index, plan: buildWaiveTx(chainId, { safe: o!.order.buyer, owner: address!, orderId: BigInt(id!), index: m.index }) }))
  const refund = () => ask(() => ({ kind: 'refund', plan: buildRefundTx(chainId, { safe: o!.order.buyer, owner: address!, orderId: BigInt(id!) }) }))
  const confirm = (m: OrderMilestone) => ask(() => ({ kind: 'confirm', index: m.index, proofHash: m.resolution!.confirmation!.proofHash, expiry: m.resolution!.confirmation!.expiry }))

  if (q.isLoading || tf.loading) return <Shell><Loading what="the order" rows={5} shape="table" /></Shell>
  if (!o) {
    return (
      <Shell>
        <section className="gate-block">
          <h1>No order {id}</h1>
          <p>{mode === 'replay' ? 'Replay shows only the recorded reference order.' : q.error ? (q.error as Error).message : 'The escrow has no order with this number.'}</p>
          <Link className="button" to="/orders">All orders</Link>
        </section>
      </Shell>
    )
  }

  const total = BigInt(o.order.total.raw)
  const released = BigInt(o.order.released.raw)
  const refundable = o.milestones.some((m) => m.resolution?.canRefund)
  const frozen = freeze.data && (freeze.data.owner || freeze.data.bank)
  const confirmPanel = pending && address ? (
    <SignConfirm role="owner" address={address} busy={act.isPending} onCancel={() => setPending(null)}
      what={pending.kind === 'confirm' ? 'a ReleaseConfirmation (EIP-712)' : 'one Safe transaction'}
      confirmLabel={pending.kind === 'confirm' ? 'Sign confirmation' : pending.kind === 'waive' ? 'Sign and waive' : 'Sign and refund'}
      tone={pending.kind === 'refund' ? 'danger' : undefined} onConfirm={() => act.mutate(pending)}>
      {pending.kind === 'confirm' ? (
        <p>Domain TradeEscrow v1, chain {chainId}, contract <code>{shortHex(tf.pinned?.tradeEscrow, 6, 4)}</code>. Order <strong>{id}</strong>, milestone index <strong>{pending.index}</strong>, proof <code>{shortHex(pending.proofHash, 8, 6)}</code>, expires {stamp(pending.expiry)}. Nothing moves on-chain; the Authorizer checks it before it signs the release.</p>
      ) : pending.kind === 'waive' ? (
        <p>Safe <code>{shortHex(pending.plan.safe, 6, 4)}</code> calls <code>waive({id}, {pending.index})</code> on TradeEscrow <code>{shortHex(pending.plan.tradeFlow.tradeEscrow, 6, 4)}</code>. It pays <strong className="nums">{o.milestones[pending.index!].amount.display}</strong> USDC to the fixed supplier despite the failed check.</p>
      ) : (
        <p>Safe <code>{shortHex(pending.plan.safe, 6, 4)}</code> calls <code>refund({id})</code> on TradeEscrow <code>{shortHex(pending.plan.tradeFlow.tradeEscrow, 6, 4)}</code>. All unreleased funds, <strong className="nums">{usdc(total - released)}</strong> USDC, return to the Safe.</p>
      )}
    </SignConfirm>
  ) : null

  return (
    <Shell>
      <nav className="crumbs" aria-label="Breadcrumb"><Link to="/orders">Orders</Link><Icon name="right" /><span aria-current="page">Order {o.order.orderId}</span></nav>
      <PageHeader
        title={<>Order {o.order.orderId}<span className="title-pills"><OrderPill state={orderDisplay(o.order.status)} />{heldCount(o) ? <HeldFlag /> : null}</span></>}
        subtitle={supplierView ? 'Supplier view: on-chain fields only.' : tf.replay ? 'Recorded reference run on Base Sepolia (E6). Real transactions and states.' : undefined}
        actions={canAct && refundable ? <button type="button" className="button danger small" onClick={refund}>Refund unreleased</button>
          : !supplierView ? <Link className="button small quiet" to={`/o/${o.order.orderId}`}>Supplier view</Link> : null}
      />

      {supplierView ? (
        <p className="drawer-note"><Icon name="info" /> This page reads only what the escrow contract stores: terms, statuses and settlement transactions. Payments go only to the supplier fixed at creation.</p>
      ) : null}
      {!supplierView && frozen ? (
        <section className="alert-block" role="status"><h2><Icon name="lock" />Treasury frozen</h2><p>{freeze.data!.bank ? 'The bank froze this treasury.' : 'The owner froze this treasury.'} Releases and waivers wait; a refund after the deadline still works.</p></section>
      ) : null}
      {!supplierView && mode === 'live' && role === 'bank' ? <p className="drawer-note"><Icon name="lock" /> Bank seat: read-only. The bank can freeze this treasury from the Bank desk; it cannot release, waive or refund.</p> : null}
      {tf.blocked && owner ? <p className="error-note" role="alert">{tf.blocked}</p> : null}
      {pending?.kind === 'refund' ? confirmPanel : null}
      <div role="status">{sent ? <p className="ok-note">{sent.label === 'waive' ? 'Waive' : 'Refund'} sent: <TxStatus hash={sent.hash} label={sent.label} onMined={refresh} /></p> : null}</div>
      <ErrorNote error={act.error ?? demo.error} />

      <section className="order-summary card" aria-label="Order summary">
        <div className="order-money">
          <p className="hero-label">Released</p>
          <p className="order-amount nums"><CountText text={o.order.released.display} id={`order:${o.order.orderId}:released`} /><span className="hero-unit">of {o.order.total.display} USDC</span></p>
          <Meter value={fromUnits(released)} max={fromUnits(total)} label={`Released ${o.order.released.display} of ${o.order.total.display} USDC`} />
        </div>
        <dl className="facts order-facts">
          <div><dt>Committed</dt><dd className="nums">{usdc(committedRaw(o))} USDC</dd></div>
          <div><dt>Supplier</dt><dd><Hash value={o.order.supplier} kind="address" label="supplier" /></dd></div>
          <div><dt>Buyer Safe</dt><dd><Hash value={o.order.buyer} kind="address" label="buyer Safe" /></dd></div>
          <div><dt>Created</dt><dd>{o.order.createdAt ? stamp(o.order.createdAt) : recordedBlock(o.transactions.created) ? `Block ${recordedBlock(o.transactions.created)!.toLocaleString('en-US')}` : 'Unknown'}{o.transactions.created ? <Hash value={o.transactions.created} label="funding transaction" /> : null}</dd></div>
          <div><dt>Terms hash<InfoTip label="About the terms hash">keccak256 of the purchase order fields, fixed on-chain at creation.</InfoTip></dt><dd><span className="kv-copy"><code>{shortHex(o.order.termsHash, 8, 6)}</code><CopyButton value={o.order.termsHash} label="terms hash" /></span></dd></div>
          {o.recorded ? <div><dt>Terms</dt><dd>{o.recorded.terms}</dd></div> : null}
          {o.transactions.refund ? <div><dt>Refund</dt><dd><Hash value={o.transactions.refund} label="refund transaction" /></dd></div> : null}
        </dl>
      </section>

      <Section title="Milestones" info="Paid in order. A milestone releases only on a proof signed by its issuer that passes every check; the Authorizer re-checks and the escrow enforces the binding rules.">
        <ol className="ms-line">
          {o.milestones.map((m) => (
            <MilestoneStep key={m.index} m={m} o={o} tf={tf} supplierView={supplierView}
              actions={canAct ? <OwnerActions m={m} o={o} tf={tf} busy={demo.isPending || act.isPending}
                onProof={(variant) => demo.mutate({ index: m.index, variant })} onWaive={() => waive(m)} onConfirm={() => confirm(m)} /> : null}
              confirm={pending && pending.kind !== 'refund' && pending.index === m.index ? confirmPanel : null} />
          ))}
        </ol>
        {!supplierView && mode === 'live' && role !== 'owner' && o.view === 'full' ? <div className="row-actions"><SwitchSeat to="owner" className="button small quiet" /></div> : null}
      </Section>

      {o.recorded?.attacks.length ? (
        <Section title="Recorded attacks on this order" info="Transactions the evidence script forced against the escrow. Each reverted on-chain.">
          <ul className="attack-list">
            {o.recorded.attacks.map((a) => (
              <li key={a.hash}><Pill tone="refused" icon="stop">Reverted</Pill><span>{a.id}: {a.label}</span>{a.error ? <code className="err-code">{a.error}</code> : null}<Hash value={a.hash} label={a.label} /></li>
            ))}
          </ul>
        </Section>
      ) : null}
    </Shell>
  )
}

function Shell({ children }: { children: ReactNode }) {
  return <main id="main" className="page"><div className="page-body order-page">{children}</div></main>
}

function MilestoneStep({ m, o, tf, supplierView, actions, confirm }: { m: OrderMilestone; o: OrderView; tf: TradeFlowState; supplierView: boolean; actions: ReactNode; confirm: ReactNode }) {
  const spec = milestoneSpec(m.index)
  const d = milestoneDisplay(m)
  const share = BigInt(o.order.total.raw) > 0n ? Number((BigInt(m.amount.raw) * 1000n) / BigInt(o.order.total.raw)) / 10 : 0
  const tx = o.transactions.milestones[String(m.index)]
  const proof = m.pendingProof ?? m.proof
  const checks = proof?.proof ? conditionChecks(m, proof.proof) : []
  const isNext = o.order.status === 'ACTIVE' && o.order.nextIndex === m.index
  return (
    <li className={`ms-step ms-${d}${isNext ? ' is-next' : ''}`} id={`m-${m.index + 1}`} style={{ '--i': m.index } as CSSProperties}>
      <span className="ms-node" aria-hidden="true"><Icon key={d} name={d === 'released' || d === 'waived' ? 'check' : d === 'held' ? 'alert' : d === 'refunded' ? 'left' : 'clock'} /></span>
      <div className="ms-card">
        <header className="ms-head">
          <h3><span className="ms-index">{m.index + 1}</span>{spec.label}</h3>
          <MilestonePill state={d} reason={d === 'held' ? m.reason : null} />
          <span className="ms-amount nums">{m.amount.display} <span className="muted">USDC, {share}%</span></span>
        </header>
        <dl className="ms-facts">
          <div><dt>Issuer</dt><dd><IssuerLabel issuer={m.issuer} index={m.index} pinned={tf.pinned} /></dd></div>
          <div><dt>Condition</dt><dd>{conditionText(m, spec.document)}</dd></div>
          <div><dt>Deadline</dt><dd className="nums">{stamp(m.deadline)}</dd></div>
          {!supplierView ? <div><dt>Proof</dt><dd>{proofStatus(m)}</dd></div> : null}
          {tx ? <div><dt>{d === 'waived' ? 'Waive' : 'Release'} tx</dt><dd><Hash value={tx} label={`milestone ${m.index + 1} settlement`} /></dd></div> : null}
        </dl>
        {checks.length ? (
          <ul className="ms-checks" aria-label="Check results">
            {checks.map((c) => (
              <li key={c.name} className={c.ok ? 'ok' : 'bad'}><Icon name={c.ok ? 'check' : 'stop'} /><span className="check-name">{c.name}</span><span className="check-detail">{c.detail}</span></li>
            ))}
          </ul>
        ) : null}
        {(d === 'held' || d === 'waiting' || (m.reason && d === 'waived')) && !supplierView ? (
          <div className={`ms-hold${d === 'held' ? ' is-held' : ''}`}>
            {m.reason ? <p className="ms-reason"><code className="err-code">{m.reason}</code> {reasonText(m.reason)}</p> : null}
            {m.explanation ? (
              <div className="agent-note">
                <p className="agent-who">Verification Agent<InfoTip label="About the Verification Agent">It explains the deterministic checks and proposes one action from a fixed set. It holds no keys; nothing runs without you.</InfoTip></p>
                <p>{m.explanation.text}</p>
                {m.explanation.proposal && m.explanation.proposal !== 'NO_ACTION' && !/proposed next step/i.test(m.explanation.text) ? <p className="agent-next"><strong>Proposed next step:</strong> {PROPOSAL_TEXT[m.explanation.proposal] ?? m.explanation.proposal}</p> : null}
              </div>
            ) : null}
            {d === 'waived' ? <p className="muted">Held, then waived by the owner.</p> : null}
          </div>
        ) : null}
        {actions}
        {confirm}
      </div>
    </li>
  )
}

function proofStatus(m: OrderMilestone): ReactNode {
  if (m.pendingProof) return <><Pill tone="held" icon="clock">Corrected proof, needs confirmation</Pill><code>{shortHex(m.pendingProof.proofHash, 8, 6)}</code></>
  const p = m.proof
  if (!p) return m.status === 'PENDING' ? <span className="muted">Not received</span> : <span className="muted">Not recorded</span>
  return <span className="proof-line"><span>{p.source.startsWith('demo:') ? 'Demo issuer proof' : p.source === 'recorded' ? 'Recorded proof' : 'Submitted proof'}</span>{p.proofHash ? <><code>{shortHex(p.proofHash, 8, 6)}</code><CopyButton value={p.proofHash} label="proof hash" /></> : null}</span>
}

function OwnerActions({ m, o, tf, busy, onProof, onWaive, onConfirm }: { m: OrderMilestone; o: OrderView; tf: TradeFlowState; busy: boolean; onProof: (v: DemoVariant) => void; onWaive: () => void; onConfirm: () => void }) {
  const d = milestoneDisplay(m)
  const isNext = o.order.status === 'ACTIVE' && o.order.nextIndex === m.index
  if (!isNext) return null
  const role = milestoneSpec(m.index).role
  const demoOk = tf.config?.demoIssuers?.[role] !== false
  const canProof = demoOk && (d === 'pending' || d === 'held') && !m.pendingProof
  const items = VARIANTS.filter((v) => (d === 'held' ? v.v === 'corrected' : v.v !== 'corrected'))
    .map((v) => ({ key: v.v, label: v.label, meta: v.hint, onSelect: () => onProof(v.v) }))
  const conf = m.resolution?.confirmation
  if (!canProof && !conf && !m.resolution?.canWaive) return null
  return (
    <div className="ms-actions">
      {conf ? <button type="button" className="button small" disabled={busy} onClick={onConfirm}>{m.reason === 'DeadlinePassed' && !m.pendingProof ? 'Confirm late release' : 'Confirm corrected proof'}</button> : null}
      {m.resolution?.canWaive ? <button type="button" className="button small secondary" disabled={busy} onClick={onWaive}>Waive and pay</button> : null}
      {canProof ? (
        <MenuButton buttonClass="button small quiet" align="start" buttonLabel="Request demo proof" items={items}>
          <Icon name="plus" />Request demo proof
        </MenuButton>
      ) : null}
      {canProof ? <InfoTip label="About demo proofs">A server-held demo issuer key signs a proof for this milestone, as a carrier, sensor gateway or surveyor would.</InfoTip> : null}
    </div>
  )
}
