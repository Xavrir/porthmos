import { useState, type FormEvent } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { encodeFunctionData, parseAbi } from 'viem'
import { ReserveBar } from '../components/ReserveBar'
import { Chip, Empty, ErrorNote, Figure, Hash, Loading } from '../components/bits'
import { SwitchSeat, usePageTitle } from '../components/chrome'
import { GLOSSARY_DEF, Term } from '../components/Glossary'
import { useAegis } from '../lib/source'
import { useIdentity } from '../lib/identity'
import { useObligations, useTreasury } from '../lib/queries'
import { day, fromUnits, money, num } from '../lib/format'
import { chainName } from '../lib/wallet'
import type { TxRequest } from '../lib/types'

const FLOOR_ABI = parseAbi(['function setReserveFloor(address safe, uint256 floor, bytes32 scheduleHash)'])

export default function Treasury() {
  usePageTitle('Treasury')
  const { api, mode, chainId, deployment } = useAegis()
  const { role, address, sendTx } = useIdentity()
  const qc = useQueryClient()
  const t = useTreasury()
  const obs = useObligations()
  const [floorTx, setFloorTx] = useState<TxRequest | null>(null)
  const [sent, setSent] = useState<string | null>(null)
  const [form, setForm] = useState({ label: '', amount: '', dueDate: '', confirmedInflow: false })
  const [status, setStatus] = useState('')

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
      qc.invalidateQueries({ queryKey: ['obligations'] }); qc.invalidateQueries({ queryKey: ['treasury'] })
    },
  })
  const signFloor = useMutation({
    mutationFn: async () => {
      if (!address) throw new Error('Choose the owner identity first.')
      if (mode === 'replay') { await api.simulateFloorUpdate!(address); return 'recorded in replay' }
      const tr = t.data!
      const tx = floorTx ?? {
        to: deployment.registry,
        data: encodeFunctionData({ abi: FLOOR_ABI, functionName: 'setReserveFloor', args: [tr.safe, BigInt(tr.reserve.required.raw), tr.reserve.scheduleHash ?? ('0x' + '0'.repeat(64)) as `0x${string}`] }),
        value: '0',
      }
      return sendTx(tx)
    },
    onSuccess: (h) => { setSent(h); setFloorTx(null); qc.invalidateQueries({ queryKey: ['treasury'] }) },
  })

  const submit = (e: FormEvent) => { e.preventDefault(); add.mutate() }
  const tr = t.data
  const today = tr ? num(tr.depositedToday) : 0
  const floorNote = !tr ? '' : !tr.reserve.inSync
    ? `Schedule needs ${tr.reserve.required.display}`
    : Math.abs(num(tr.reserve.onchainFloor) - num(tr.reserve.required)) < 0.005
      ? 'Matches the schedule'
      : `Covers the schedule (needs ${tr.reserve.required.display})`

  return (
    <main id="main" className="page">
      <section className="page-band c-surface">
        <div className="wrap band-grid">
          <div className="band-head">
            <h1>Treasury</h1>
            <p className="band-lede">Harbour Lane Imports{mode === 'replay' ? ' (sample client)' : ''}. Cash for what the business owes stays in the Safe; only the surplus goes to work.</p>
            {tr ? <p className="band-meta">Safe <Hash value={tr.safe} kind="address" label="Safe address" /> on {chainName(chainId)}</p> : null}
          </div>
          <div className="band-figures">
            <Figure label="Total" value={tr ? `${tr.balances.total.display}` : '…'} note="USDC across the Safe and vaults" />
            <Figure label="Reserve floor, on-chain" value={tr ? tr.reserve.onchainFloor.display : '…'} note={floorNote} tone={tr && !tr.reserve.inSync ? 'alert' : undefined} />
            <Figure label="Deployable" value={tr ? tr.deployable.display : '…'} note="Above the higher of floor and schedule, after fees" />
            <Figure label="Deposited today" value={tr ? money(today) : '…'} note={tr ? `of ${tr.policy.dailyCap.display} daily cap` : ''} />
          </div>
        </div>
      </section>

      <div className="page-body wrap">
        <section className="block" aria-labelledby="split-title">
          <div className="block-head">
            <h2 id="split-title">Reserve and deployable capital</h2>
            <p>The reserve is the largest shortfall the calendar can produce over 30 days plus a buffer (10% of outflows or 500, whichever is larger). Everything to its right may earn.</p>
          </div>
          {tr ? <ReserveBar t={tr} /> : <Loading what="the treasury" />}
        </section>

        {tr && !tr.reserve.inSync ? (
          <section className="alert-block" role="alert" aria-labelledby="sync-title">
            <h2 id="sync-title">The floor is out of date</h2>
            <p>The approved schedule needs a reserve of {tr.reserve.required.display}, but the floor on-chain is {tr.reserve.onchainFloor.display}. The planner holds every action with <code>FloorOutOfSync</code> until the owner signs <code>setReserveFloor</code>.</p>
            <div className="row-actions">
              <button type="button" className="button secondary" disabled={role !== 'owner' || signFloor.isPending} onClick={() => signFloor.mutate()}>
                {signFloor.isPending ? 'Signing…' : `Sign floor of ${tr.reserve.required.display}`}
              </button>
              {role !== 'owner' ? <><span>Only the owner can sign this (role matrix).</span><SwitchSeat to="owner" className="button small quiet" /></> : null}
            </div>
            <ErrorNote error={signFloor.error} />
          </section>
        ) : null}
        <div role="status">{sent ? <p className="ok-note">Floor update {sent.startsWith('0x') ? <>sent: <Hash value={sent} /></> : sent}.</p> : null}</div>

        <div className="cols">
          <section className="block col-wide" aria-labelledby="cal-title">
            <div className="block-head">
              <h2 id="cal-title">Obligation calendar</h2>
              <p>Entered and approved by the owner. The agent never infers obligations. Unconfirmed inflows count as zero.</p>
            </div>
            {obs.isLoading ? <Loading what="obligations" /> : obs.data?.length ? (
              <div className="table-wrap">
                <table className="table">
                  <thead><tr><th scope="col">Item</th><th scope="col">Due</th><th scope="col" className="r">Amount</th><th scope="col">Kind</th><th scope="col"><span className="sr-only">Action</span></th></tr></thead>
                  <tbody>
                    {obs.data.map((o) => (
                      <tr key={o.id} className={o.settled ? 'is-dim' : undefined}>
                        <td>{o.label}</td>
                        <td className="nums">{day(o.dueDate)}</td>
                        <td className="r nums">{o.confirmedInflow ? '+' : ''}{o.amount.display}</td>
                        <td>{o.settled ? <Chip state="EXPLAINED">Settled</Chip> : o.confirmedInflow ? <Chip state="CONFIRMED">Confirmed inflow</Chip> : <Chip state="HELD">Obligation</Chip>}</td>
                        <td className="r">{!o.settled ? <button type="button" className="button small quiet" disabled={role !== 'owner' || settle.isPending} onClick={() => settle.mutate(o.id)}>Settle</button> : null}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : <Empty>No obligations yet.</Empty>}
            <ErrorNote error={obs.error ?? settle.error} />
            <p className="ok-line" role="status">{status}</p>

            <form className="form" onSubmit={submit} aria-labelledby="add-title">
              <h3 id="add-title">Add an obligation</h3>
              <div className="form-grid">
                <label>Label<input className="field" required value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} placeholder="Supplier invoice" /></label>
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
                  <p>The service returned a floor update for the owner wallet to sign: <code>{floorTx.data.slice(0, 18)}…</code> to <Hash value={floorTx.to} kind="address" label="registry" />.</p>
                  <button type="button" className="button small secondary" disabled={signFloor.isPending} onClick={() => signFloor.mutate()}>Sign and send</button>
                </div>
              ) : null}
            </form>
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
                <div><dt>Owner freeze</dt><dd>{tr.policy.frozen.owner ? <Chip state="REVERTED">On</Chip> : 'Off'}</dd></div>
                <div><dt>Bank freeze</dt><dd>{tr.policy.frozen.bank ? <Chip state="POLICY_CHANGED">On</Chip> : 'Off'}</dd></div>
                <div><dt>Authorizer</dt><dd>{tr.policy.authorizerRevoked ? <Chip state="REVERTED">Revoked</Chip> : 'Active'}</dd></div>
              </dl>
            ) : <Loading what="policy" />}
          </section>
        </div>

        <section className="block" aria-labelledby="pos-title">
          <div className="block-head">
            <h2 id="pos-title">Positions</h2>
            <p>Two <Term def={GLOSSARY_DEF.erc4626}>ERC-4626</Term> vaults the owner added. A quarantined vault refuses deposits; redemptions to the Safe always run.</p>
          </div>
          {tr ? (
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th scope="col">Vault</th><th scope="col">Address</th><th scope="col" className="r">Shares</th><th scope="col" className="r">Value, USDC</th><th scope="col">Status</th></tr></thead>
                <tbody>
                  <tr>
                    <td>Safe (cash)</td><td><Hash value={tr.safe} kind="address" label="Safe" /></td><td className="r nums">n/a</td><td className="r nums">{tr.balances.safeUsdc.display}</td><td>{num(tr.balances.safeUsdc) >= num(tr.reserve.onchainFloor) ? <Chip state="CONFIRMED">Above floor</Chip> : <Chip state="REVERTED">Below floor</Chip>}</td>
                  </tr>
                  {tr.balances.vaults.map((v) => (
                    <tr key={v.address}>
                      <td>{v.name}</td>
                      <td><Hash value={v.address} kind="address" label={v.name} /></td>
                      <td className="r nums">{v.shares.display}</td>
                      <td className="r nums">{v.assets.display}</td>
                      <td>{v.quarantined ? <Chip state="QUARANTINED">Quarantined</Chip> : num(v.assets) > 0 ? <Chip state="CONFIRMED">Earning</Chip> : <Chip state="EXPLAINED">Empty</Chip>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : <Loading what="positions" />}
          <ErrorNote error={t.error} />
        </section>
      </div>
    </main>
  )
}
