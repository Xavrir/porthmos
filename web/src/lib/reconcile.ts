import type { ChainEvent, LedgerRow, ReconciliationRow } from './types'
import { amount } from './format'

const ZERO = '0x' + '0'.repeat(64)

export function verifyLinks(rows: LedgerRow[]): Map<number, boolean> {
  const ok = new Map<number, boolean>()
  let prev = ZERO
  for (const r of [...rows].sort((a, b) => a.seq - b.seq)) {
    ok.set(r.seq, !r.prevHash || r.prevHash.toLowerCase() === prev.toLowerCase())
    prev = r.rowHash ?? prev
  }
  return ok
}

export function reconcile(rows: LedgerRow[], events: ChainEvent[]): ReconciliationRow[] {
  const links = verifyLinks(rows)
  const execs = rows.filter((r) => r.kind === 'execution' && r.txHash)
  const executed = events.filter((e) => e.name === 'AegisExecuted')
  const out: ReconciliationRow[] = execs.map((l) => {
    const ev = executed.find((e) => e.txHash.toLowerCase() === l.txHash!.toLowerCase())
    const chainAmount = ev ? amount(BigInt(String(Number(ev.args.op) === 1 ? ev.args.assets : ev.args.assets))) : undefined
    const hashOk = links.get(l.seq) ?? true
    return {
      key: l.txHash!,
      ledger: { seq: l.seq, summary: l.summary, amount: l.amount, txHash: l.txHash, hashOk },
      chain: ev ? { name: ev.name, txHash: ev.txHash, blockNumber: ev.blockNumber, amount: chainAmount } : undefined,
      status: !ev ? 'missing-on-chain' : !hashOk ? 'hash-broken' : chainAmount && l.amount && chainAmount.raw !== l.amount.raw ? 'amount-mismatch' : 'match',
    }
  })
  for (const e of executed) {
    if (!execs.some((l) => l.txHash!.toLowerCase() === e.txHash.toLowerCase())) {
      out.push({ key: e.txHash, chain: { name: e.name, txHash: e.txHash, blockNumber: e.blockNumber, amount: amount(BigInt(String(e.args.assets ?? 0))) }, status: 'missing-in-ledger' })
    }
  }
  return out
}
