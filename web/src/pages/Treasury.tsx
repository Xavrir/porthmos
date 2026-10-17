import { useMemo, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { type Address, type Hex } from 'viem'
import { ReserveBar } from '../components/ReserveBar'
import { Chip, ErrorNote, Figure, Hash, InfoTip, Kpis, Loading, PageHeader, Section, type Tone, type Trend } from '../components/bits'
import { SwitchSeat, usePageTitle } from '../components/chrome'
import { SignConfirm } from '../components/SignConfirm'
import { TxStatus } from '../components/TxStatus'
import { GLOSSARY_DEF } from '../components/Glossary'
import { StackedAreaChart, type AreaSeries, type Slot } from '../components/charts'
import { DataTable, type Column } from '../components/DataTable'
import { MenuButton } from '../components/Menu'
import { CopyButton, DetailDrawer, DrawerSection, KeyValues, useHashParam } from '../components/Drawer'
import { useAegis } from '../lib/source'
import { useIdentity } from '../lib/identity'
import { useLedger, useObligations, useRisk, useTreasury } from '../lib/queries'
import { day, fromUnits, money, num, pct, shortHex, stamp } from '../lib/format'
import { CASH, delta, holdingSeries, latestTs, resample, since } from '../lib/history'
import { buildFloorTx, guardedSend, pinnedFor, sendFloorUpdate, type FloorPlan } from '../lib/txguard'
import { explorerAddress } from '../lib/wallet'
import { toast } from '../lib/toast'
import { Icon } from '../components/icons'
import type { Obligation, TreasuryState, TxRequest } from '../lib/types'
import { useOrders, useTradeFlow } from '../lib/tradeflow/queries'
import { committedRaw } from '../lib/tradeflow/state'

type ObStatus = 'due' | 'inflow' | 'settled'
const OB_STATUS: { value: ObStatus; label: string }[] = [
  { value: 'due', label: 'Due' }, { value: 'inflow', label: 'Confirmed inflow' }, { value: 'settled', label: 'Settled' },
]
const obStatus = (o: Obligation): ObStatus => (o.settled ? 'settled' : o.confirmedInflow ? 'inflow' : 'due')

function ObChip({ o }: { o: Obligation }) {
  return o.settled ? <Chip state="EXPLAINED">Settled</Chip> : o.confirmedInflow ? <Chip state="CONFIRMED">Confirmed inflow</Chip> : <Chip state="HELD" tone="held">Due</Chip>
}

type Position = { key: string; name: string; address: Address; shares: string | null; value: string; label: string; tone: Tone; quarantined: boolean; isSafe: boolean }

function positionsOf(tr: TreasuryState): Position[] {
  const above = num(tr.balances.safeUsdc) >= num(tr.reserve.onchainFloor)
  return [
    { key: tr.safe, name: 'Safe (cash)', address: tr.safe, shares: null, value: tr.balances.safeUsdc.display, label: above ? 'Above floor' : 'Below floor', tone: above ? 'ok' : 'refused', quarantined: false, isSafe: true },
    ...tr.balances.vaults.map((v) => ({
      key: v.address, name: v.name, address: v.address, shares: v.shares.display, value: v.assets.display,
      label: v.quarantined ? 'Quarantined' : num(v.assets) > 0 ? 'Earning' : 'Empty',
      tone: (v.quarantined ? 'held' : num(v.assets) > 0 ? 'ok' : 'neutral') as Tone,
      quarantined: !!v.quarantined, isSafe: false,
    })),
  ]
}

function signed(v: number) {
  return `${v >= 0 ? '+' : '−'}${money(Math.abs(v))}`
}

const SPARK_POINTS = 24
const RANGES = [
  { key: '1d', label: 'Last 24 hours', seconds: 86400 },
  { key: '3d', label: 'Last 3 days', seconds: 3 * 86400 },
  { key: 'all', label: 'All time', seconds: Infinity },
] as const

export default function Treasury() {
  usePageTitle('Treasury')
  const { api, mode, chainId, tenant } = useAegis()
  const { role, address, sendTx, isLocal, identity } = useIdentity()
  const qc = useQueryClient()
  const t = useTreasury()
  const obs = useObligations()
  const ledger = useLedger()
  const risk = useRisk()
  const tf = useTradeFlow()
  const orders = useOrders()
  const [floorTx, setFloorTx] = useState<TxRequest | null>(null)
  const [plan, setPlan] = useState<FloorPlan | null>(null)
  const [sent, setSent] = useState<string | null>(null)
  const [form, setForm] = useState({ label: '', amount: '', dueDate: '', confirmedInflow: false })
  const [status, setStatus] = useState('')
  const [obOpen, openOb, closeOb] = useHashParam('ob')
  const [posOpen, openPos, closePos] = useHashParam('pos')
  const [addOpen, openAdd, closeAdd] = useHashParam('add')
  const [polOpen, openPol, closePol] = useHashParam('policy')
  const [range, setRange] = useState<(typeof RANGES)[number]['key']>('all')
  const tr = t.data
  const sessionSafe = tenant?.safe ?? pinnedFor(chainId)?.safe ?? null

  const add = useMutation({
    mutationFn: () => api.addObligation(form),
    onSuccess: (res) => {
      setFloorTx(res.floorUpdate)
      setStatus(`Added ${res.obligation.label}, ${res.obligation.amount.display} due ${day(res.obligation.dueDate)}. The reserve was recomputed.`)
      toast({ tone: 'ok', title: `Added ${res.obligation.label}`, text: `${res.obligation.amount.display} due ${day(res.obligation.dueDate)}` }, 5000)
      setForm({ label: '', amount: '', dueDate: '', confirmedInflow: false })
      qc.invalidateQueries({ queryKey: ['obligations'] })
      qc.invalidateQueries({ queryKey: ['treasury'] })
      if (!(res.floorUpdate && mode === 'live')) closeAdd()
    },
  })
  const settle = useMutation({
    mutationFn: (id: string) => api.settleObligation(id),
    onSuccess: (_res, id) => {
      const ob = obs.data?.find((o) => o.id === id)
      setStatus(`Settled ${ob?.label ?? 'the obligation'}${ob ? `, ${ob.amount.display}` : ''}. The on-chain floor stays where the owner signed it.`)
      toast({ tone: 'ok', title: `Settled ${ob?.label ?? 'the obligation'}`, text: 'It no longer counts toward the reserve.' }, 5000)
      qc.invalidateQueries({ queryKey: ['obligations'] }); qc.invalidateQueries({ queryKey: ['treasury'] })
    },
  })

  const fetchApiTx = async () => floorTx ?? (await api.floorUpdate?.().catch(() => null)) ?? null
  const fallback = () => ({ floor: BigInt(tr!.reserve.required.raw), scheduleHash: tr!.reserve.scheduleHash })
  const requireSafe = () => {
    if (!sessionSafe) throw new Error('No Safe is known for this session, so nothing was sent.')
    return sessionSafe
  }

  const prepare = useMutation({
    mutationFn: async () => buildFloorTx({ chainId, safe: requireSafe(), apiTx: await fetchApiTx(), ...fallback() }),
    onSuccess: (p) => setPlan(p),
  })
  const signFloor = useMutation({
    mutationFn: async (p: FloorPlan | null): Promise<string> => {
      if (!address) throw new Error('Choose the owner identity first.')
      if (mode === 'replay') { await api.simulateFloorUpdate!(address); return 'recorded in replay' }
      if (p) return guardedSend(chainId, p.tx, sendTx)
      return sendFloorUpdate({ chainId, safe: requireSafe(), fetchApiTx, fallback: fallback(), send: sendTx })
    },
    onSuccess: (h) => { setSent(h); setFloorTx(null); setPlan(null); qc.invalidateQueries({ queryKey: ['treasury'] }) },
    onError: () => setPlan(null),
  })
  const askFloor = () => {
    signFloor.reset(); prepare.reset()
    if (isLocal && mode === 'live') prepare.mutate()
    else signFloor.mutate(null)
  }
  const floorError = prepare.error ?? signFloor.error
  const floorConfirm = plan && identity.kind === 'local' ? (
    <SignConfirm role="owner" address={identity.address} what="a transaction" confirmLabel="Sign and send" busy={signFloor.isPending}
      onConfirm={() => signFloor.mutate(plan)} onCancel={() => setPlan(null)}>
      <p><code>setReserveFloor</code> on the PolicyRegistry <code>{shortHex(plan.registry, 6, 4)}</code>: Safe <code>{shortHex(plan.safe, 6, 4)}</code> must keep <strong className="nums">{money(fromUnits(plan.floor))}</strong> USDC (schedule <code>{shortHex(plan.scheduleHash, 6, 4)}</code>). It costs a little test ETH for gas.</p>
    </SignConfirm>
  ) : null

  const submit = (e: FormEvent) => { e.preventDefault(); add.mutate() }
  const today = tr ? num(tr.depositedToday) : 0
  const cap = tr ? num(tr.policy.dailyCap) : 0
  const outOfSync = !!tr && !tr.reserve.inSync
  const floorNote = !tr ? '' : outOfSync
    ? `Schedule needs ${tr.reserve.required.display}`
    : Math.abs(num(tr.reserve.onchainFloor) - num(tr.reserve.required)) < 0.005 ? 'Matches schedule' : `Schedule needs ${tr.reserve.required.display}`

  const vaultSeries: AreaSeries[] = (tr?.balances.vaults ?? []).slice(0, 3).map((v, i) => ({ key: v.name, label: v.name, slot: (i + 2) as Slot }))
  const series: AreaSeries[] = [{ key: CASH, label: 'Cash in Safe', slot: 1 }, ...vaultSeries]
  const history = useMemo(() => {
    const rows = ledger.data ?? []
    if (!tr) return { changes: [], points: [] }
    const end = tr.updatedAt ?? latestTs(rows)
    const all = holdingSeries(rows, { t: end, cash: num(tr.balances.safeUsdc), vaults: tr.balances.vaults.map((v) => ({ key: v.name, value: num(v.assets) })) })
    const seconds = RANGES.find((r) => r.key === range)!.seconds
    const changes = Number.isFinite(seconds) ? since(all, end - seconds) : all
    return { changes, points: resample(changes) }
  }, [ledger.data, tr, range])
  const vaultsNow = tr ? tr.balances.vaults.reduce((a, v) => a + num(v.assets), 0) : 0
  const inVaults = (p: { values: Record<string, number> }) => vaultSeries.reduce((a, s) => a + (p.values[s.key] ?? 0), 0)
  const spark = history.points.length ? resample(history.changes, SPARK_POINTS).map(inVaults) : undefined
  const vaultTrend: Trend | undefined = history.changes.length ? (() => {
    const d = delta(inVaults(history.changes[0]), vaultsNow)
    return { text: d.pct === null ? signed(d.abs) : `${d.abs >= 0 ? '+' : '−'}${pct(Math.abs(d.pct), 1)}`, dir: d.dir }
  })() : undefined

  const obRows = obs.data ?? []
  const obSel = obRows.find((o) => o.id === obOpen) ?? null
  const positions = tr ? positionsOf(tr) : []
  const posSel = positions.find((p) => p.key.toLowerCase() === posOpen?.toLowerCase()) ?? null
  const vaultRisk = posSel ? risk.data?.vaults.find((v) => v.address.toLowerCase() === posSel.address.toLowerCase()) : undefined
  const canSettle = role === 'owner' && !settle.isPending
  const frozen = tr ? tr.policy.frozen.owner || tr.policy.frozen.bank : false

  const obColumns: Column<Obligation>[] = [
    { key: 'label', header: 'Item', primary: true, cell: (o) => o.label },
    { key: 'due', header: 'Due', cell: (o) => <span className="nums nowrap">{day(o.dueDate)}</span> },
    { key: 'amount', header: 'Amount, USDC', align: 'right', cell: (o) => <span className="nums">{o.confirmedInflow ? '+' : ''}{o.amount.display}</span> },
    { key: 'kind', header: 'Status', cell: (o) => <ObChip o={o} /> },
  ]
  const posColumns: Column<Position>[] = [
    { key: 'name', header: 'Holding', primary: true, cell: (p) => p.name },
    { key: 'address', header: 'Address', hideNarrow: true, cell: (p) => <Hash value={p.address} kind="address" label={p.name} /> },
    { key: 'shares', header: 'Shares', align: 'right', hideNarrow: true, cell: (p) => <span className="nums">{p.shares ?? ''}</span> },
    { key: 'value', header: 'Value, USDC', align: 'right', cell: (p) => <span className="nums">{p.value}</span> },
    { key: 'status', header: 'Status', cell: (p) => <Chip state={p.label} tone={p.tone}>{p.label}</Chip> },
  ]
  const floorButton = (
    <button type="button" className="button" disabled={role !== 'owner' || signFloor.isPending || prepare.isPending || !!plan} onClick={askFloor}>
      {signFloor.isPending || prepare.isPending ? 'Preparing…' : 'Sign the new floor'}
    </button>
  )
  const addButton = (primary: boolean) => <button type="button" className={`button${primary ? '' : ' quiet'}`} onClick={() => openAdd('obligation')}><Icon name="plus" />Add obligation</button>

  return (
    <main id="main" className="page">
      <div className="page-body">
        <PageHeader
          title="Treasury"
          info="Cash for what the business owes stays in the Safe. Only the surplus goes to work in vaults the owner added."
          actions={outOfSync ? <>{addButton(false)}{floorButton}</> : addButton(true)}
        />

        {outOfSync && tr ? (
          <section className="alert-block" role="alert" aria-labelledby="sync-title">
            <h2 id="sync-title"><Icon name="alert" />Floor out of date</h2>
            <p>The schedule needs {tr.reserve.required.display}; the floor on-chain is {tr.reserve.onchainFloor.display}. Deposits wait with <code>FloorOutOfSync</code> until the owner signs.</p>
            {role !== 'owner' ? <div className="row-actions"><SwitchSeat to="owner" className="button small quiet" /></div> : null}
            {floorConfirm}
            <ErrorNote error={floorError} />
          </section>
        ) : null}
        <div role="status">{sent ? <p className="ok-note">Floor update {sent.startsWith('0x') ? <>sent: {mode === 'live' ? <TxStatus hash={sent as Hex} label="floor update" onMined={() => qc.invalidateQueries({ queryKey: ['treasury'] })} /> : <Hash value={sent} />}</> : sent}.</p> : null}</div>

        <div className="filters" role="group" aria-label="Filter the treasury">
          <span className="fchip is-on">
            <MenuButton buttonClass="fchip-main" align="start" radio
              items={RANGES.map((r) => ({ key: r.key, label: r.label, checked: r.key === range, onSelect: () => setRange(r.key) }))}>
              <Icon name="clock" />Date range<span className="fchip-sep" aria-hidden="true" /><span className="fchip-value">{RANGES.find((r) => r.key === range)!.label}</span>
            </MenuButton>
          </span>
        </div>

        <div className="home">
          <section className="card today" aria-labelledby="today-title">
            <h2 id="today-title" className="card-kicker">Today</h2>
            <div className="hero">
              <p className="hero-label">Total balance<InfoTip label="About the total balance">USDC across the Safe and both vaults. The history is rebuilt from executed deposits and redemptions, anchored on today’s balances; yield is not split out.</InfoTip></p>
              <p className="hero-value">{tr ? tr.balances.total.display : <span className="sk sk-value" role="img" aria-label="Loading" />}<span className="hero-unit">USDC</span></p>
              {tr?.updatedAt ? <p className="hero-sub nums">Updated {stamp(tr.updatedAt)}</p> : null}
            </div>
            {history.points.length > 1 ? (
              <StackedAreaChart points={history.points} changes={history.changes} series={series} label="Balance by holding over time" />
            ) : ledger.isLoading || !tr ? <Loading what="the balance history" /> : <p className="empty">No executions yet.</p>}
          </section>

          <div className="home-side">
            <section className="card" aria-labelledby="alloc-title">
              <header className="card-head">
                <h2 id="alloc-title">Allocation</h2>
                <InfoTip label="About the allocation">The reserve is the largest shortfall the calendar can produce over 30 days, plus a buffer of 10% of outflows or 500, whichever is larger. Everything beyond it may earn.</InfoTip>
              </header>
              {tr ? <ReserveBar t={tr} /> : <Loading what="the treasury" />}
            </section>

            <section className="card" aria-labelledby="pol-title">
              <header className="card-head">
                <h2 id="pol-title">Policy</h2>
                {tr ? <span className="card-meta nums">v{tr.policy.version}</span> : null}
                <button type="button" className="card-link" onClick={() => openPol('onchain')}>View all</button>
              </header>
              {tr ? (
                <dl className="facts">
                  <div><dt>Auto cap</dt><dd className="nums">{tr.policy.autoCap.display}</dd></div>
                  <div><dt>Daily cap</dt><dd className="nums">{tr.policy.dailyCap.display}</dd></div>
                  <div><dt>Bank limit</dt><dd className="nums">{tr.policy.bankLimit.display}</dd></div>
                  <div><dt>Deposits</dt><dd>{frozen ? <Chip state="POLICY_CHANGED" tone="frozen">Frozen</Chip> : tr.policy.authorizerRevoked ? <Chip state="REVERTED">Agent revoked</Chip> : <Chip state="CONFIRMED">Open</Chip>}</dd></div>
                </dl>
              ) : <Loading what="policy" />}
            </section>
          </div>
        </div>

        <Kpis label="Treasury figures">
          <Figure label="Reserve floor" value={tr ? tr.reserve.onchainFloor.display : '…'} note={floorNote} tone={outOfSync ? 'alert' : undefined}
            info="Signed on-chain by the owner. A deposit that would take the Safe below it reverts ReserveFloorBreached." />
          <Figure label="Free to deploy" value={tr ? tr.deployable.display : '…'} note="After floor and fees" />
          <Figure label="In vaults" value={tr ? money(vaultsNow) : '…'} spark={spark} sparkLabel={spark ? `In vaults over time, from ${money(spark[0])} to ${money(spark[spark.length - 1])}` : undefined} trend={vaultTrend}
            note={history.changes.length ? `Since ${day(history.changes[0].t)}` : 'No executions yet'} />
          <Figure label="Deposited today" value={tr ? money(today) : '…'} note={tr ? `of ${tr.policy.dailyCap.display} daily cap` : ''}
            meter={tr ? { value: today, max: cap, label: `Deposited today, ${money(today)} of the ${money(cap)} daily cap`, tone: cap && today / cap > 0.9 ? 'warn' : undefined } : undefined}
            info="Counted per UTC day, the way the contract counts its daily cap." />
        </Kpis>

        {tf.available && tr ? (() => {
          const committed = tr.figures?.committed.display ?? (orders.data ? money(fromUnits(orders.data.reduce((a, o) => a + committedRaw(o), 0n))) : '…')
          const active = orders.data?.filter((o) => o.order.status === 'ACTIVE').length
          return (
            <Kpis label="Trade position">
              <Figure label="Cash" value={(tr.figures?.cash ?? tr.balances.safeUsdc).display} note={tr.figures ? 'Safe plus withdrawable vault value' : 'USDC in the Safe'} info="What the treasury can pay from now. Escrowed funds are not part of it." />
              <Figure label="Committed" value={committed} note={<Link className="card-link" to="/orders">{active === undefined ? 'View orders' : `${active} active order${active === 1 ? '' : 's'}`}</Link>}
                info="Unreleased funds of active trade orders, read from TradeEscrow.committedOf. They left the Safe and can never be invested." />
              <Figure label="Free" value={(tr.figures?.free ?? tr.deployable).display} note="Deployable after floor and fees" />
            </Kpis>
          )
        })() : null}

        <Section title="Positions" info={<>Two <strong>ERC-4626</strong> vaults the owner added. {GLOSSARY_DEF.erc4626} A quarantined vault refuses deposits; redemptions to the Safe always run.</>}>
          {tr ? (
            <DataTable label="Positions" rows={positions} columns={posColumns} rowKey={(p) => p.key} rowName={(p) => p.name}
              onOpen={(p) => openPos(p.key)} selectedKey={posSel?.key}
              rowMenu={(p) => {
                const href = explorerAddress(chainId, p.address)
                return [
                  { key: 'open', label: 'View details', onSelect: () => openPos(p.key) },
                  ...(href ? [{ key: 'explorer', label: 'Open on the block explorer', onSelect: () => { window.open(href, '_blank', 'noopener,noreferrer') } }] : []),
                ]
              }} />
          ) : <Loading what="positions" />}
          <ErrorNote error={t.error} />
        </Section>

        <Section title="Obligations" info="Entered and approved by the owner. The agent never infers obligations. Unconfirmed inflows count as zero.">
          {obs.isLoading ? <Loading what="obligations" /> : (
            <DataTable label="Obligations" rows={obRows} columns={obColumns} rowKey={(o) => o.id} rowName={(o) => o.label}
              onOpen={(o) => openOb(o.id)} selectedKey={obOpen}
              status={{ label: 'Status', get: obStatus, options: OB_STATUS }}
              searchText={(o) => `${o.label} ${o.amount.display} ${day(o.dueDate)}`} searchLabel="Search obligations"
              rowMenu={(o) => [
                { key: 'open', label: 'View details', onSelect: () => openOb(o.id) },
                { key: 'settle', label: role === 'owner' ? 'Settle' : 'Settle (owner only)', disabled: o.settled || !canSettle, onSelect: () => settle.mutate(o.id) },
              ]}
              empty="No obligations yet." />
          )}
          <ErrorNote error={obs.error ?? settle.error} />
          <p className="ok-line" role="status">{status}</p>
        </Section>
      </div>

      <DetailDrawer open={addOpen === 'obligation'} onClose={closeAdd} eyebrow="New obligation" title="Add an obligation">
        <form className="form" onSubmit={submit} aria-label="Add an obligation">
          <label>Label<input id="ob-label" className="field" required value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} placeholder="Supplier invoice" /></label>
          <label>Amount, USDC<input className="field nums" required inputMode="decimal" pattern="[0-9]+(\.[0-9]{1,6})?" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} placeholder="1200.00" /></label>
          <label>Due date<input className="field" required type="date" value={form.dueDate} onChange={(e) => setForm({ ...form, dueDate: e.target.value })} /></label>
          <label className="check"><input type="checkbox" checked={form.confirmedInflow} onChange={(e) => setForm({ ...form, confirmedInflow: e.target.checked })} /> <span>Confirmed inflow, not a payment</span></label>
          <div className="row-actions">
            <button type="submit" className="button" disabled={role !== 'owner' || add.isPending}>{add.isPending ? 'Adding…' : 'Add and recompute'}</button>
            {role !== 'owner' ? <SwitchSeat to="owner" className="button small quiet" /> : null}
          </div>
          {role !== 'owner' ? <p className="muted">Only the owner adds obligations.</p> : null}
          <ErrorNote error={add.error} />
          {floorTx && mode === 'live' ? (
            <div className="ok-note">
              <p>The service proposed a new floor. Porthmos checks it and encodes the transaction itself, to the pinned PolicyRegistry, before the owner signs.</p>
              {plan ? floorConfirm : <button type="button" className="button small secondary" disabled={signFloor.isPending || prepare.isPending || role !== 'owner'} onClick={askFloor}>Check and sign</button>}
              <ErrorNote error={floorError} />
            </div>
          ) : null}
        </form>
      </DetailDrawer>

      <DetailDrawer open={polOpen === 'onchain'} onClose={closePol} eyebrow="PolicyRegistry" title="Policy on-chain" badge={tr ? <span className="chip tone-neutral">Version {tr.policy.version}</span> : null}>
        {tr ? (
          <>
            <DrawerSection title="Limits">
              <KeyValues items={[
                { label: 'Auto cap', value: <span className="nums">{tr.policy.autoCap.display} USDC</span> },
                { label: 'Daily cap', value: <span className="nums">{tr.policy.dailyCap.display} USDC</span> },
                { label: 'Bank limit', value: <span className="nums">{tr.policy.bankLimit.display} USDC</span> },
                { label: 'Reserve floor', value: <span className="nums">{tr.reserve.onchainFloor.display} USDC</span> },
                { label: 'Price band width', value: <span className="nums">{tr.policy.maxBandWidth ? fromUnits(tr.policy.maxBandWidth, 8).toFixed(4) : '0.0200'}</span> },
                { label: 'Oracle age limit', value: <span className="nums">{tr.policy.maxOracleAge ?? 180} s</span> },
              ]} />
            </DrawerSection>
            <DrawerSection title="Controls">
              <KeyValues items={[
                { label: 'Owner freeze', value: tr.policy.frozen.owner ? <Chip state="POLICY_CHANGED" tone="frozen">Frozen</Chip> : 'Off' },
                { label: 'Bank freeze', value: tr.policy.frozen.bank ? <Chip state="POLICY_CHANGED" tone="frozen">Frozen</Chip> : 'Off' },
                { label: 'Authorizer', value: tr.policy.authorizerRevoked ? <Chip state="REVERTED">Revoked</Chip> : 'Active' },
                { label: 'Safe', value: <Hash value={tr.safe} kind="address" label="Safe address" head={10} tail={8} /> },
              ]} />
            </DrawerSection>
            <p className="drawer-note">Every policy change raises the version, which voids every record signed under the old one.</p>
          </>
        ) : null}
      </DetailDrawer>

      <DetailDrawer open={!!obSel} onClose={closeOb} eyebrow="Obligation" title={obSel?.label ?? ''} badge={obSel ? <ObChip o={obSel} /> : null}
        amount={obSel ? <>{obSel.confirmedInflow ? '+' : ''}{obSel.amount.display} <span className="drawer-unit">USDC</span></> : null}
        actions={obSel && !obSel.settled ? (role === 'owner'
          ? <button type="button" className="button small" disabled={!canSettle} onClick={() => settle.mutate(obSel.id)}>{settle.isPending ? 'Settling…' : 'Settle'}</button>
          : <SwitchSeat to="owner" className="button small quiet" />) : null}>
        {obSel ? (
          <>
            <DrawerSection title="Summary">
              <KeyValues items={[
                { label: 'Due', value: day(obSel.dueDate) },
                { label: 'Kind', value: obSel.confirmedInflow ? 'Confirmed inflow' : 'Payment' },
                { label: 'Counts toward reserve', value: obSel.settled ? 'No, settled' : obSel.confirmedInflow ? 'Offsets later payments' : 'Yes' },
                { label: 'ID', value: <span className="kv-copy"><code>{obSel.id}</code><CopyButton value={obSel.id} label="obligation ID" /></span> },
              ]} />
            </DrawerSection>
            <p className="drawer-note">Settling removes it from the schedule. The on-chain floor stays where the owner signed it until the owner signs a new one.</p>
            <ErrorNote error={settle.error} />
          </>
        ) : null}
      </DetailDrawer>

      <DetailDrawer open={!!posSel} onClose={closePos} eyebrow={posSel?.isSafe ? 'Safe' : 'Vault position'} title={posSel?.name ?? ''}
        badge={posSel ? <Chip state={posSel.label} tone={posSel.tone}>{posSel.label}</Chip> : null}
        amount={posSel ? <>{posSel.value} <span className="drawer-unit">USDC</span></> : null}
        actions={posSel ? (
          <>
            {explorerAddress(chainId, posSel.address) ? <a className="button small quiet" href={explorerAddress(chainId, posSel.address)} target="_blank" rel="noreferrer">Block explorer</a> : null}
            {!posSel.isSafe ? <Link className="button small quiet" to="/risk">Open in Risk</Link> : null}
          </>
        ) : null}>
        {posSel ? (
          <>
            <DrawerSection title="Summary">
              <KeyValues items={[
                { label: 'Address', value: <Hash value={posSel.address} kind="address" label={posSel.name} head={10} tail={8} /> },
                !posSel.isSafe && { label: 'Shares', value: <span className="nums">{posSel.shares}</span> },
                { label: 'Value', value: <span className="nums">{posSel.value} USDC</span> },
                posSel.isSafe && tr ? { label: 'Reserve floor', value: <span className="nums">{tr.reserve.onchainFloor.display} USDC</span> } : null,
                !posSel.isSafe && { label: 'Deposits', value: posSel.quarantined ? 'Refused while quarantined' : 'Allowed' },
              ]} />
            </DrawerSection>
            {vaultRisk ? (
              <DrawerSection title="Risk">
                <KeyValues items={[
                  { label: 'Score', value: <span className="nums">{vaultRisk.score.toFixed(2)}</span> },
                  { label: 'Peg', value: <span className="nums">{pct(vaultRisk.components.peg)}</span> },
                  { label: 'Liquidity', value: <span className="nums">{pct(vaultRisk.components.liquidity)}</span> },
                  { label: 'Utilisation', value: <span className="nums">{pct(vaultRisk.components.utilisation)}</span> },
                  { label: 'Redeemable now', value: <span className="nums">{vaultRisk.maxRedeem.display} USDC</span> },
                  { label: 'Triggers', value: vaultRisk.triggers.length ? vaultRisk.triggers.join(', ') : 'None' },
                ]} />
              </DrawerSection>
            ) : null}
          </>
        ) : null}
      </DetailDrawer>
    </main>
  )
}
