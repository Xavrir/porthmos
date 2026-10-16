import { useMemo, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { type Address, type Hex } from 'viem'
import { ReserveBar } from '../components/ReserveBar'
import { Chip, ErrorNote, Figure, Hash, Kpis, Loading, PageHeader, type Tone, type Trend } from '../components/bits'
import { SwitchSeat, usePageTitle, useTreasuryName } from '../components/chrome'
import { SignConfirm } from '../components/SignConfirm'
import { TxStatus } from '../components/TxStatus'
import { GLOSSARY_DEF, Term } from '../components/Glossary'
import { BalanceChart } from '../components/charts'
import { DataTable, type Column } from '../components/DataTable'
import { CopyButton, DetailDrawer, DrawerSection, KeyValues, useHashParam } from '../components/Drawer'
import { useAegis } from '../lib/source'
import { useIdentity } from '../lib/identity'
import { useLedger, useObligations, useRisk, useTreasury } from '../lib/queries'
import { day, fromUnits, money, num, pct, shortHex } from '../lib/format'
import { balanceSeries, dailyTotals, delta, latestTs, treasuryNow, vaultFlows } from '../lib/history'
import { buildFloorTx, guardedSend, pinnedFor, sendFloorUpdate, type FloorPlan } from '../lib/txguard'
import { chainName, explorerAddress } from '../lib/wallet'
import { toast } from '../lib/toast'
import type { Obligation, TreasuryState, TxRequest } from '../lib/types'

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

export default function Treasury() {
  usePageTitle('Treasury')
  const { api, mode, chainId, tenant } = useAegis()
  const name = useTreasuryName()
  const { role, address, sendTx, isLocal, identity } = useIdentity()
  const qc = useQueryClient()
  const t = useTreasury()
  const obs = useObligations()
  const ledger = useLedger()
  const risk = useRisk()
  const [floorTx, setFloorTx] = useState<TxRequest | null>(null)
  const [plan, setPlan] = useState<FloorPlan | null>(null)
  const [sent, setSent] = useState<string | null>(null)
  const [form, setForm] = useState({ label: '', amount: '', dueDate: '', confirmedInflow: false })
  const [status, setStatus] = useState('')
  const [obOpen, openOb, closeOb] = useHashParam('ob')
  const [posOpen, openPos, closePos] = useHashParam('pos')
  const tr = t.data
  const sessionSafe = tenant?.safe ?? pinnedFor(chainId)?.safe ?? null

  const add = useMutation({
    mutationFn: () => api.addObligation(form),
    onSuccess: (res) => {
      setFloorTx(res.floorUpdate)
      setStatus(`Added ${res.obligation.label}, ${res.obligation.amount.display} due ${day(res.obligation.dueDate)}. The reserve was recomputed; check the floor above.`)
      setForm({ label: '', amount: '', dueDate: '', confirmedInflow: false })
      qc.invalidateQueries({ queryKey: ['obligations'] })
      qc.invalidateQueries({ queryKey: ['treasury'] })
    },
  })
  const settle = useMutation({
    mutationFn: (id: string) => api.settleObligation(id),
    onSuccess: (_res, id) => {
      const ob = obs.data?.find((o) => o.id === id)
      setStatus(`Settled ${ob?.label ?? 'the obligation'}${ob ? `, ${ob.amount.display}` : ''}. It no longer counts toward the reserve. The on-chain floor stays where the owner signed it.`)
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
  const floorNote = !tr ? '' : !tr.reserve.inSync
    ? `Schedule needs ${tr.reserve.required.display}`
    : Math.abs(num(tr.reserve.onchainFloor) - num(tr.reserve.required)) < 0.005
      ? 'Matches the schedule'
      : `Covers the schedule (needs ${tr.reserve.required.display})`

  const history = useMemo(() => {
    const rows = ledger.data ?? []
    const flows = vaultFlows(rows)
    const nowTs = tr?.updatedAt ?? latestTs(rows)
    const series = tr ? balanceSeries(flows, treasuryNow(tr, nowTs)) : []
    const daily = dailyTotals(flows.filter((f) => f.delta > 0).map((f) => ({ t: f.t, v: f.delta })), 7, nowTs, 0)
    return { flows, series, daily }
  }, [ledger.data, tr])
  const vaultsNow = tr ? tr.balances.vaults.reduce((a, v) => a + num(v.assets), 0) : 0
  const vaultTrend: Trend | undefined = history.series.length ? (() => {
    const d = delta(history.series[0].vaults, vaultsNow)
    return { text: d.pct === null ? signed(d.abs) : `${d.abs >= 0 ? '+' : '−'}${pct(Math.abs(d.pct), 1)}`, dir: d.dir }
  })() : undefined
  const dayTrend: Trend | undefined = history.flows.length && Math.abs(history.daily[6] - today) < 0.005 ? (() => {
    const d = delta(history.daily[5], history.daily[6])
    return { text: signed(d.abs), dir: d.dir }
  })() : undefined

  const obRows = obs.data ?? []
  const obSel = obRows.find((o) => o.id === obOpen) ?? null
  const positions = tr ? positionsOf(tr) : []
  const posSel = positions.find((p) => p.key.toLowerCase() === posOpen?.toLowerCase()) ?? null
  const vaultRisk = posSel ? risk.data?.vaults.find((v) => v.address.toLowerCase() === posSel.address.toLowerCase()) : undefined
  const canSettle = role === 'owner' && !settle.isPending

  const obColumns: Column<Obligation>[] = [
    { key: 'label', header: 'Item', primary: true, cell: (o) => o.label },
    { key: 'due', header: 'Due', cell: (o) => <span className="nums nowrap">{day(o.dueDate)}</span> },
    { key: 'amount', header: 'Amount', align: 'right', cell: (o) => <span className="nums">{o.confirmedInflow ? '+' : ''}{o.amount.display}</span> },
    { key: 'kind', header: 'Status', cell: (o) => <ObChip o={o} /> },
  ]
  const posColumns: Column<Position>[] = [
    { key: 'name', header: 'Holding', primary: true, cell: (p) => p.name },
    { key: 'address', header: 'Address', hideNarrow: true, cell: (p) => <Hash value={p.address} kind="address" label={p.name} /> },
    { key: 'shares', header: 'Shares', align: 'right', hideNarrow: true, cell: (p) => <span className="nums">{p.shares ?? 'n/a'}</span> },
    { key: 'value', header: 'Value, USDC', align: 'right', cell: (p) => <span className="nums">{p.value}</span> },
    { key: 'status', header: 'Status', cell: (p) => <Chip state={p.label} tone={p.tone}>{p.label}</Chip> },
  ]

  return (
    <main id="main" className="page">
      <div className="page-body">
        <PageHeader
          title="Treasury"
          description={<>{name}{mode === 'replay' ? ' (sample client)' : ''}. Cash for what the business owes stays in the Safe; only the surplus goes to work.</>}
          meta={tr ? <>Safe <Hash value={tr.safe} kind="address" label="Safe address" /> on {chainName(chainId)}</> : null}
          actions={tr && !tr.reserve.inSync ? (
            <button type="button" className="button" disabled={role !== 'owner' || signFloor.isPending || prepare.isPending || !!plan} onClick={askFloor}>{signFloor.isPending || prepare.isPending ? 'Preparing…' : 'Sign the new floor'}</button>
          ) : (
            <button type="button" className="button" onClick={() => { const el = document.getElementById('ob-label'); el?.scrollIntoView({ block: 'center' }); el?.focus({ preventScroll: true }) }}>Add an obligation</button>
          )}
        />
        <Kpis label="Treasury figures">
          <Figure label="Total balance" value={tr ? tr.balances.total.display : '…'} note="USDC across the Safe and vaults" />
          <Figure label="Reserve floor, on-chain" value={tr ? tr.reserve.onchainFloor.display : '…'} note={floorNote} tone={tr && !tr.reserve.inSync ? 'alert' : undefined} />
          <Figure label="Free to deploy" value={tr ? tr.deployable.display : '…'} note="Above the higher of floor and schedule, after fees" />
          <Figure label="In vaults" value={tr ? money(vaultsNow) : '…'} spark={history.series.length ? history.series.map((p) => p.vaults) : undefined} trend={vaultTrend}
            note={history.series.length ? `Since ${day(history.series[0].t)}, from executions` : 'No executions yet'} />
          <Figure label="Deposited today" value={tr ? money(today) : '…'} spark={history.flows.length ? history.daily : undefined} trend={dayTrend}
            note={tr ? `${dayTrend ? `vs ${money(history.daily[5])} the day before (UTC). ` : ''}Cap ${tr.policy.dailyCap.display}` : ''} />
        </Kpis>

        {tr && !tr.reserve.inSync ? (
          <section className="alert-block" role="alert" aria-labelledby="sync-title">
            <h2 id="sync-title">The floor is out of date</h2>
            <p>The approved schedule needs a reserve of {tr.reserve.required.display}, but the floor on-chain is {tr.reserve.onchainFloor.display}. The planner holds every action with <code>FloorOutOfSync</code> until the owner signs <code>setReserveFloor</code>.</p>
            <div className="row-actions">
              <button type="button" className="button secondary" disabled={role !== 'owner' || signFloor.isPending || prepare.isPending || !!plan} onClick={askFloor}>
                {signFloor.isPending || prepare.isPending ? 'Preparing…' : `Sign floor of ${tr.reserve.required.display}`}
              </button>
              {role !== 'owner' ? <><span>Only the owner can sign this (role matrix).</span><SwitchSeat to="owner" className="button small quiet" /></> : null}
            </div>
            {floorConfirm}
            <ErrorNote error={floorError} />
          </section>
        ) : null}
        <div role="status">{sent ? <p className="ok-note">Floor update {sent.startsWith('0x') ? <>sent: {mode === 'live' ? <TxStatus hash={sent as Hex} label="floor update" onMined={() => qc.invalidateQueries({ queryKey: ['treasury'] })} /> : <Hash value={sent} />}</> : sent}.</p> : null}</div>

        <div className="cols">
          <section className="block col-wide" aria-labelledby="bal-title">
            <div className="block-head">
              <h2 id="bal-title">Balance over time</h2>
              <p>Rebuilt from executed deposits and redemptions, anchored on today’s balances. Yield is not split out.</p>
            </div>
            {history.series.length ? <BalanceChart points={history.series} /> : ledger.isLoading || !tr ? <Loading what="the balance history" /> : <p className="empty">No executions yet, so there is no history to draw.</p>}
          </section>

          <section className="block col-narrow" aria-labelledby="pol-title">
            <div className="block-head">
              <h2 id="pol-title">Policy on-chain</h2>
              <p>Version {tr?.policy.version ?? '…'}. Every change increments it and voids records signed before.</p>
            </div>
            {tr ? (
              <dl className="facts">
                <div><dt>Auto cap</dt><dd className="nums">{tr.policy.autoCap.display}</dd></div>
                <div><dt>Daily cap</dt><dd className="nums">{tr.policy.dailyCap.display}</dd></div>
                <div><dt>Bank limit</dt><dd className="nums">{tr.policy.bankLimit.display}</dd></div>
                <div><dt>Reserve floor</dt><dd className="nums">{tr.reserve.onchainFloor.display}</dd></div>
                <div><dt>Price band width</dt><dd className="nums">{tr.policy.maxBandWidth ? fromUnits(tr.policy.maxBandWidth, 8).toFixed(4) : '0.0200'}</dd></div>
                <div><dt>Oracle age limit</dt><dd className="nums">{tr.policy.maxOracleAge ?? 180} s</dd></div>
                <div><dt>Owner freeze</dt><dd>{tr.policy.frozen.owner ? <Chip state="POLICY_CHANGED" tone="frozen">Frozen</Chip> : 'Off'}</dd></div>
                <div><dt>Bank freeze</dt><dd>{tr.policy.frozen.bank ? <Chip state="POLICY_CHANGED" tone="frozen">Frozen</Chip> : 'Off'}</dd></div>
                <div><dt>Authorizer</dt><dd>{tr.policy.authorizerRevoked ? <Chip state="REVERTED">Revoked</Chip> : 'Active'}</dd></div>
              </dl>
            ) : <Loading what="policy" />}
          </section>
        </div>

        <section className="block" aria-labelledby="split-title">
          <div className="block-head">
            <h2 id="split-title">Reserve and deployable capital</h2>
            <p>The reserve is the largest shortfall the calendar can produce over 30 days plus a buffer (10% of outflows or 500, whichever is larger). Everything to its right may earn.</p>
          </div>
          {tr ? <ReserveBar t={tr} /> : <Loading what="the treasury" />}
        </section>

        <section className="block" aria-labelledby="cal-title">
          <div className="block-head">
            <h2 id="cal-title">Obligation calendar</h2>
            <p>Entered and approved by the owner. The agent never infers obligations. Unconfirmed inflows count as zero.</p>
          </div>
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

          <form className="form" onSubmit={submit} aria-labelledby="add-title">
            <h3 id="add-title">Add an obligation</h3>
            <div className="form-grid">
              <label>Label<input id="ob-label" className="field" required value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} placeholder="Supplier invoice" /></label>
              <label>Amount, USDC<input className="field nums" required inputMode="decimal" pattern="[0-9]+(\.[0-9]{1,6})?" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} placeholder="1200.00" /></label>
              <label>Due date<input className="field" required type="date" value={form.dueDate} onChange={(e) => setForm({ ...form, dueDate: e.target.value })} /></label>
              <label className="check"><input type="checkbox" checked={form.confirmedInflow} onChange={(e) => setForm({ ...form, confirmedInflow: e.target.checked })} /> <span>Confirmed inflow, not a payment</span></label>
            </div>
            <div className="row-actions">
              <button type="submit" className="button" disabled={role !== 'owner' || add.isPending}>{add.isPending ? 'Adding…' : 'Add and recompute'}</button>
              {role !== 'owner' ? <><span className="muted">Owner only.</span><SwitchSeat to="owner" className="button small quiet" /></> : null}
            </div>
            <ErrorNote error={add.error} />
            {floorTx && mode === 'live' ? (
              <div className="ok-note">
                <p>The service proposed a new floor. Porthmos checks it and encodes the transaction itself, to the pinned PolicyRegistry, before the owner signs.</p>
                {plan ? floorConfirm : <button type="button" className="button small secondary" disabled={signFloor.isPending || prepare.isPending || role !== 'owner'} onClick={askFloor}>Check and sign</button>}
                <ErrorNote error={floorError} />
              </div>
            ) : null}
          </form>
        </section>

        <section className="block" aria-labelledby="pos-title">
          <div className="block-head">
            <h2 id="pos-title">Positions</h2>
            <p>Two <Term def={GLOSSARY_DEF.erc4626}>ERC-4626</Term> vaults the owner added. A quarantined vault refuses deposits; redemptions to the Safe always run.</p>
          </div>
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
        </section>
      </div>

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
