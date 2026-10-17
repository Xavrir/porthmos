import { useMemo, useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { decodeEventLog, getAddress, isAddress, isAddressEqual, type Address, type Hex } from 'viem'
import { useAegis } from '../lib/source'
import { useIdentity } from '../lib/identity'
import { useTreasury } from '../lib/queries'
import { publicClientFor, waitForReceipt } from '../lib/onboard/chain'
import { supplierAddress, withSupplier } from '../lib/keys'
import { buildFundOrderTx, type SafePlan } from '../lib/txguard'
import { ESCROW_ABI } from '../lib/tradeflow/abi'
import { buildTerms, conditionText, InputError, MILESTONES, parseUsdc, purchaseOrder, splitTotal, termsHash } from '../lib/tradeflow/model'
import type { TradeFlowState } from '../lib/tradeflow/queries'
import { exactUnits, shortHex, stamp } from '../lib/format'
import { toast } from '../lib/toast'
import { DetailDrawer, DrawerSection, KeyValues } from './Drawer'
import { ErrorNote, Hash, InfoTip } from './bits'
import { SwitchSeat } from './chrome'
import { SignConfirm } from './SignConfirm'
import { Icon } from './icons'

type Form = { supplierMode: 'demo' | 'other'; supplier: string; total: string; terms: string }
type Plan = SafePlan & { createdAt: bigint; cashAfter: bigint | null; floor: bigint | null; termsText: string; supplierIsDemo: boolean }

const usdc = (raw: bigint) => exactUnits(raw)

export function CreateOrderDrawer({ open, onClose, tf }: { open: boolean; onClose: () => void; tf: TradeFlowState }) {
  const { chainId, rpcUrl, wallet, setWallet, tenant, deployment, mode } = useAegis()
  const { role, address, sendTx, identity } = useIdentity()
  const t = useTreasury()
  const qc = useQueryClient()
  const navigate = useNavigate()
  const [form, setForm] = useState<Form>({ supplierMode: 'demo', supplier: '', total: '1000', terms: '' })
  const [plan, setPlan] = useState<Plan | null>(null)
  const [sent, setSent] = useState<Hex | null>(null)
  const demoSupplier = wallet ? supplierAddress(wallet) : null
  const safe = tenant?.safe ?? deployment.safe
  const pinned = tf.pinned

  const preview = useMemo(() => {
    try {
      const total = parseUsdc(form.total)
      return { total, parts: splitTotal(total), error: null as string | null }
    } catch (e) {
      return { total: null, parts: null, error: e instanceof InputError ? e.message : String(e) }
    }
  }, [form.total])

  const cash = t.data ? BigInt(t.data.balances.safeUsdc.raw) : null
  const floor = t.data ? BigInt(t.data.reserve.onchainFloor.raw) : null
  const cashAfter = cash !== null && preview.total !== null ? cash - preview.total : null
  const belowFloor = cashAfter !== null && floor !== null && cashAfter < floor
  const short = cashAfter !== null && cashAfter < 0n

  const ensureDemoSupplier = (): Address => {
    if (!wallet) throw new Error('No keys in this browser. Create your treasury first.')
    const w = withSupplier(wallet)
    if (w !== wallet) setWallet(w)
    return supplierAddress(w)!
  }

  const prepare = useMutation({
    mutationFn: async (): Promise<Plan> => {
      if (!pinned) throw new Error('This build pins no TradeEscrow for this chain.')
      if (tf.blocked) throw new Error(tf.blocked)
      if (role !== 'owner' || !address) throw new Error('Only the owner funds an order.')
      if (preview.error || preview.total === null) throw new Error(preview.error ?? 'Enter a total.')
      const termsText = form.terms.trim()
      if (!termsText) throw new Error('Enter a terms reference, for example the purchase order number.')
      const supplierIsDemo = form.supplierMode === 'demo'
      const supplierRaw = supplierIsDemo ? ensureDemoSupplier() : form.supplier.trim()
      if (!isAddress(supplierRaw, { strict: false })) throw new Error('The supplier address is not a valid address.')
      const supplier = getAddress(supplierRaw)
      if (isAddressEqual(supplier, safe) || isAddressEqual(supplier, address)) throw new Error('The supplier must not be your Safe or your owner key.')
      if (Object.values(pinned.issuers).some((i) => isAddressEqual(i, supplier))) throw new Error('The supplier must not be one of the milestone issuers.')
      const client = publicClientFor(chainId, rpcUrl)
      const [escrowCode, multiCode, block] = await Promise.all([
        client.getCode({ address: pinned.tradeEscrow }), client.getCode({ address: pinned.multiSendCallOnly }), client.getBlock(),
      ])
      if (!escrowCode || escrowCode === '0x') throw new Error(`No contract code at the pinned TradeEscrow ${pinned.tradeEscrow}. Nothing was signed.`)
      if (!multiCode || multiCode === '0x') throw new Error(`No contract code at the pinned MultiSendCallOnly ${pinned.multiSendCallOnly}. Nothing was signed.`)
      const createdAt = block.timestamp
      const terms = buildTerms(preview.total, pinned.issuers, createdAt)
      const hash = termsHash(purchaseOrder({ buyer: safe, supplier, token: pinned.usdc, total: preview.total, terms: termsText, ms: terms }))
      const p = buildFundOrderTx(chainId, { safe, owner: address, supplier, total: preview.total, termsHash: hash, terms })
      return { ...p, createdAt, cashAfter, floor, termsText, supplierIsDemo }
    },
    onSuccess: setPlan,
  })

  const send = useMutation({
    mutationFn: async (p: Plan) => {
      const hash = await sendTx(p.tx)
      setSent(hash)
      const r = await waitForReceipt(publicClientFor(chainId, rpcUrl), hash, 120_000)
      if (r.status !== 'success') throw new Error('The funding transaction was mined but reverted. No funds moved.')
      for (const log of r.logs) {
        if (!isAddressEqual(log.address, p.tradeFlow.tradeEscrow)) continue
        try {
          const ev = decodeEventLog({ abi: ESCROW_ABI, data: log.data, topics: log.topics })
          if (ev.eventName === 'OrderCreated') return (ev.args as { orderId: bigint }).orderId.toString()
        } catch { /* another event of the escrow */ }
      }
      throw new Error('The transaction succeeded but emitted no OrderCreated event.')
    },
    onSuccess: (id) => {
      toast({ tone: 'ok', title: `Order ${id} funded`, text: 'The escrow holds the total. Milestones release as proofs arrive.' }, 6000)
      qc.invalidateQueries({ queryKey: ['orders'] })
      qc.invalidateQueries({ queryKey: ['treasury'] })
      setPlan(null); setSent(null)
      navigate(`/orders/${id}`)
    },
  })

  const submit = (e: FormEvent) => { e.preventDefault(); prepare.reset(); send.reset(); prepare.mutate() }
  const close = () => { if (!send.isPending) { setPlan(null); prepare.reset(); send.reset(); setSent(null); onClose() } }
  const owner = role === 'owner'
  const shape = plan?.shape.kind === 'fund' ? plan.shape : null

  return (
    <DetailDrawer open={open} onClose={close} eyebrow="New trade order" title={plan ? 'Check and sign' : 'Create an order'}>
      {mode === 'replay' ? <p className="drawer-note">Replay holds no keys. Create a treasury to fund a real test order.</p> : null}
      {!plan ? (
        <form className="form" onSubmit={submit} aria-label="Create an order">
          <fieldset className="form-set">
            <legend>Supplier</legend>
            <label className="check"><input type="radio" name="supplier-mode" checked={form.supplierMode === 'demo'} onChange={() => setForm({ ...form, supplierMode: 'demo' })} />
              <span>Demo supplier key in this browser {demoSupplier ? <code>{shortHex(demoSupplier, 6, 4)}</code> : <span className="muted">(created when you review)</span>}</span></label>
            <label className="check"><input type="radio" name="supplier-mode" checked={form.supplierMode === 'other'} onChange={() => setForm({ ...form, supplierMode: 'other' })} /><span>Another address</span></label>
            {form.supplierMode === 'other' ? (
              <label>Supplier address<input id="order-supplier" className="field mono" required spellCheck={false} autoComplete="off" value={form.supplier} onChange={(e) => setForm({ ...form, supplier: e.target.value })} placeholder="0x…" /></label>
            ) : null}
          </fieldset>
          <label>Total, USDC<input id="order-total" className="field nums" required inputMode="decimal" value={form.total} onChange={(e) => setForm({ ...form, total: e.target.value })} placeholder="1000.00" /></label>
          <label>Terms reference<input id="order-terms" className="field" required maxLength={200} value={form.terms} onChange={(e) => setForm({ ...form, terms: e.target.value })} placeholder="PO-2026-114, reefer container" /></label>

          <DrawerSection title="Milestones" aside={<InfoTip label="About the milestones">Issuers, conditions, shares and deadlines come from this build, not from the service. The split is in whole token units; any remainder goes to the last milestone.</InfoTip>}>
            <ol className="ms-plan">
              {MILESTONES.map((m, i) => (
                <li key={m.index}>
                  <span className="ms-plan-name"><span className="ms-num">{i + 1}</span>{m.label}</span>
                  <span className="nums ms-plan-amt">{preview.parts ? usdc(preview.parts[i]) : '…'} <span className="muted">{Number(m.shareBps) / 100}%</span></span>
                  <span className="ms-plan-meta">{m.issuerLabel} <span className="demo-tag">demo issuer</span>. {conditionText(m, m.document)}. Due creation + {m.days} days.</span>
                </li>
              ))}
            </ol>
          </DrawerSection>

          {short ? <p className="drawer-note is-bad" role="alert"><Icon name="alert" /> The Safe holds {usdc(cash!)} USDC, less than this total.</p>
            : belowFloor ? <p className="drawer-note is-warn" role="alert"><Icon name="alert" /> Cash after funding, {usdc(cashAfter!)} USDC, is below the on-chain reserve floor of {usdc(floor!)}. Deposits wait until cash recovers.</p> : null}
          {preview.error ? <p className="error-note">{preview.error}</p> : null}
          <div className="row-actions">
            <button type="submit" className="button" disabled={!owner || prepare.isPending || !!preview.error || short || !!tf.blocked}>{prepare.isPending ? 'Checking…' : 'Review'}</button>
            {!owner ? <SwitchSeat to="owner" className="button small quiet" /> : null}
          </div>
          {!owner ? <p className="muted">Only the owner funds an order.</p> : null}
          {tf.blocked && !tf.replay ? <p className="error-note" role="alert">{tf.blocked}</p> : null}
          <ErrorNote error={prepare.error} />
        </form>
      ) : shape ? (
        <>
          <DrawerSection title="One Safe transaction">
            <p className="drawer-lede">The owner key sends <code>execTransaction</code> to your Safe. The Safe delegatecalls MultiSendCallOnly, which makes exactly these two calls.</p>
            <KeyValues items={[
              { label: 'Safe', value: <Hash value={plan.safe} kind="address" label="Safe" head={10} tail={8} /> },
              { label: 'Delegatecall to', value: <><span>MultiSendCallOnly</span><Hash value={plan.tradeFlow.multiSendCallOnly} kind="address" label="MultiSendCallOnly" /></> },
              { label: '1. USDC approve', value: <span><span className="nums">{usdc(shape.total)}</span> USDC to TradeEscrow <code>{shortHex(plan.tradeFlow.tradeEscrow, 6, 4)}</code></span> },
              { label: '2. createOrder', value: <span>on TradeEscrow <code>{shortHex(plan.tradeFlow.tradeEscrow, 6, 4)}</code>; pulls exactly the total, so the allowance ends at zero</span> },
            ]} />
          </DrawerSection>
          <DrawerSection title="Order fields">
            <KeyValues items={[
              { label: 'Supplier', value: <><Hash value={shape.supplier} kind="address" label="supplier" head={10} tail={8} />{plan.supplierIsDemo ? <span className="demo-tag">demo key</span> : null}</> },
              { label: 'Total', value: <span className="nums">{usdc(shape.total)} USDC ({shape.total.toString()} units)</span> },
              { label: 'Terms', value: plan.termsText },
              { label: 'Terms hash', value: <Hash value={shape.termsHash} kind="plain" label="terms hash" head={10} tail={8} /> },
            ]} />
          </DrawerSection>
          <DrawerSection title="Milestones as signed">
            <ol className="ms-plan">
              {shape.terms.map((m, i) => (
                <li key={i}>
                  <span className="ms-plan-name"><span className="ms-num">{i + 1}</span>{MILESTONES[i].label}</span>
                  <span className="nums ms-plan-amt">{usdc(m.amount)}</span>
                  <span className="ms-plan-meta">{MILESTONES[i].issuerLabel} <code>{shortHex(m.issuer, 6, 4)}</code>. {conditionText(m)}. Deadline {stamp(Number(m.deadline))}.</span>
                </li>
              ))}
            </ol>
          </DrawerSection>
          {plan.cashAfter !== null && plan.floor !== null && plan.cashAfter < plan.floor ? (
            <p className="drawer-note is-warn" role="alert"><Icon name="alert" /> Cash after funding, {usdc(plan.cashAfter)} USDC, is below the reserve floor of {usdc(plan.floor)}.</p>
          ) : null}
          {identity.kind !== 'none' && address ? (
            <SignConfirm role="owner" address={address} what="one Safe transaction" confirmLabel="Sign and fund" busy={send.isPending} onConfirm={() => send.mutate(plan)} onCancel={() => { setPlan(null); send.reset() }}>
              <p>It moves <strong className="nums">{usdc(shape.total)}</strong> USDC from the Safe into escrow. It costs a little test ETH for gas.</p>
            </SignConfirm>
          ) : null}
          {sent ? <p className="ok-note" role="status">Sent <Hash value={sent} label="funding transaction" />. Waiting for the block…</p> : null}
          <ErrorNote error={send.error} />
        </>
      ) : null}
    </DetailDrawer>
  )
}
