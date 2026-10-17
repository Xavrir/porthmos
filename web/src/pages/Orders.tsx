import { useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { DataTable, type Column } from '../components/DataTable'
import { ErrorNote, Figure, Hash, Kpis, Loading, PageHeader, Section } from '../components/bits'
import { SwitchSeat, usePageTitle } from '../components/chrome'
import { useHashParam } from '../components/Drawer'
import { CreateOrderDrawer } from '../components/CreateOrder'
import { HeldFlag, OrderPill } from '../components/orders'
import { Icon } from '../components/icons'
import { useAegis } from '../lib/source'
import { useIdentity } from '../lib/identity'
import { fromUnits, money, shortHex, stamp } from '../lib/format'
import { useOrders, useTradeFlow } from '../lib/tradeflow/queries'
import { committedRaw, heldCount, MILESTONE_LABEL, milestoneDisplay, milestoneSpec, nextMilestone, ORDER_LABEL, orderDisplay, type OrderDisplay } from '../lib/tradeflow/state'
import type { OrderView } from '../lib/tradeflow/types'

const STATUS_OPTIONS = (['active', 'completed', 'refunded'] as OrderDisplay[]).map((v) => ({ value: v, label: ORDER_LABEL[v] }))
const usdc = (raw: bigint) => money(fromUnits(raw))

export default function Orders() {
  usePageTitle('Orders')
  const navigate = useNavigate()
  const { mode } = useAegis()
  const { role } = useIdentity()
  const tf = useTradeFlow()
  const orders = useOrders()
  const [newOpen, openNew, closeNew] = useHashParam('new')
  const rows = useMemo(() => orders.data ?? [], [orders.data])
  const owner = role === 'owner' && mode === 'live'

  const totals = useMemo(() => ({
    active: rows.filter((o) => o.order.status === 'ACTIVE').length,
    committed: rows.reduce((a, o) => a + committedRaw(o), 0n),
    released: rows.reduce((a, o) => a + BigInt(o.order.released.raw), 0n),
    held: rows.reduce((a, o) => a + heldCount(o), 0),
  }), [rows])

  const columns: Column<OrderView>[] = [
    { key: 'id', header: 'Order', primary: true, cell: (o) => <span className="nums">Order {o.order.orderId}</span> },
    { key: 'status', header: 'Status', cell: (o) => <span className="pill-row"><OrderPill state={orderDisplay(o.order.status)} />{heldCount(o) ? <HeldFlag /> : null}</span> },
    { key: 'supplier', header: 'Supplier', cell: (o) => <Hash value={o.order.supplier} kind="address" label="supplier" /> },
    { key: 'total', header: 'Total, USDC', align: 'right', cell: (o) => <span className="nums">{o.order.total.display}</span> },
    { key: 'released', header: 'Released', align: 'right', cell: (o) => <span className="nums">{o.order.released.display}</span> },
    { key: 'committed', header: 'Committed', align: 'right', hideNarrow: true, cell: (o) => <span className="nums">{usdc(committedRaw(o))}</span> },
    {
      key: 'next', header: 'Next milestone', cell: (o) => {
        const m = nextMilestone(o)
        if (!m) return <span className="muted">None</span>
        const d = milestoneDisplay(m)
        return <span className="next-ms">{m.index + 1}. {milestoneSpec(m.index).label}{d !== 'pending' ? <span className="muted">, {MILESTONE_LABEL[d].toLowerCase()}</span> : null}</span>
      },
    },
  ]

  const create = owner && tf.available ? <button type="button" className="button" onClick={() => openNew('order')}><Icon name="plus" />Create order</button> : null

  return (
    <main id="main" className="page">
      <div className="page-body">
        <PageHeader title="Orders" info="Trade orders paid from escrow in three milestones. Each milestone releases only on a proof signed by its issuer and checked against the order's conditions."
          subtitle={tf.replay ? 'Recorded reference run on Base Sepolia (E6). Real transactions; nothing here sends one.' : undefined}
          actions={create ?? (mode === 'live' && role !== 'owner' && tf.available ? <SwitchSeat to="owner" className="button small quiet" /> : null)} />

        {mode === 'live' && !tf.loading && !tf.available ? (
          <section className="gate-block"><h2>TradeFlow is off</h2><p>This service has no TradeEscrow configured, so there are no orders.</p></section>
        ) : null}
        {tf.blocked && !tf.replay && tf.available ? <p className="error-note" role="alert">{tf.blocked}</p> : null}

        {mode === 'live' && !role ? (
          <section className="gate-block"><h2>Sign in to see orders</h2><p>Orders belong to a treasury. Sign in as its owner or bank officer.</p><SwitchSeat to="owner" /></section>
        ) : (
          <>
            <Kpis label="Order figures">
              <Figure label="Active orders" value={orders.data ? String(totals.active) : '…'} />
              <Figure label="Committed" value={orders.data ? usdc(totals.committed) : '…'} note="Held in escrow, not in the Safe" info="Unreleased funds of active orders. They sit in TradeEscrow and can never be invested." />
              <Figure label="Released to suppliers" value={orders.data ? usdc(totals.released) : '…'} />
              <Figure label="Held milestones" value={orders.data ? String(totals.held) : '…'} tone={totals.held ? 'alert' : undefined} note={totals.held ? 'Need your decision' : 'None'} />
            </Kpis>
            <Section title="All orders">
              {orders.isLoading ? <Loading what="orders" /> : (
                <DataTable label="Orders" rows={rows} columns={columns} rowKey={(o) => o.order.orderId} rowName={(o) => `Order ${o.order.orderId}`}
                  onOpen={(o) => navigate(`/orders/${o.order.orderId}`)}
                  status={{ label: 'Status', get: (o) => orderDisplay(o.order.status), options: STATUS_OPTIONS }}
                  searchText={(o) => `order ${o.order.orderId} ${o.order.supplier} ${o.order.total.display} ${heldCount(o) ? 'held' : ''}`} searchLabel="Search orders"
                  rowMenu={(o) => [
                    { key: 'open', label: 'Open', onSelect: () => navigate(`/orders/${o.order.orderId}`) },
                    { key: 'supplier', label: 'Supplier view', onSelect: () => navigate(`/o/${o.order.orderId}`) },
                  ]}
                  empty={
                    <span className="dt-empty-cta">
                      <span>No orders yet. {owner ? 'Fund one to pay a supplier in milestones.' : ''}</span>
                      {create}
                    </span>
                  } />
              )}
              <ErrorNote error={orders.error} />
              {tf.replay && rows[0]?.recorded ? <p className="muted small-print">Recorded {rows[0].recorded.network}. Order {rows[0].order.orderId}, supplier <code>{shortHex(rows[0].order.supplier, 6, 4)}</code>. {rows[0].recorded.terms}.</p> : null}
              {mode === 'live' && orders.dataUpdatedAt ? <p className="muted small-print nums">Updated {stamp(Math.floor(orders.dataUpdatedAt / 1000))}</p> : null}
            </Section>
          </>
        )}
      </div>
      <CreateOrderDrawer open={newOpen === 'order'} onClose={closeNew} tf={tf} />
    </main>
  )
}
