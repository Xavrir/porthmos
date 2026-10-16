import { EVIDENCE_META, EVIDENCE_SCENARIOS, EVIDENCE_SLOTS } from '../replay/evidence'
import { REPLAY_DEPLOY } from '../lib/deployment'

export const BASESCAN = 'https://sepolia.basescan.org'
export const txUrl = (hash: string) => `${BASESCAN}/tx/${hash}`
export const addressUrl = (address: string) => `${BASESCAN}/address/${address}`

export function shortHash(hash: string, head = 6, tail = 4): string {
  return hash.length > head + tail + 1 ? `${hash.slice(0, head)}...${hash.slice(-tail)}` : hash
}

export const blockText = (n: number) => n.toLocaleString('en-US')

export type TickerItem = { scenario: string; label: string; hash: string; block: number; reverted: boolean; error?: string }

export const TICKER: TickerItem[] = EVIDENCE_SCENARIOS
  .filter((s) => s.status === 'recorded')
  .flatMap((s) => s.txs.map((t) => ({ scenario: s.id, label: t.label.replace(/^E\d[a-z]?: /, ''), hash: t.hash, block: t.block, reverted: t.reverted, error: t.error })))

export const RECORDED_COUNT = EVIDENCE_SCENARIOS.filter((s) => s.status === 'recorded').length
export const TX_COUNT = TICKER.length
export const REVERTED = TICKER.filter((t) => t.reverted)
export const RECORDED_DAY = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(new Date(EVIDENCE_META.generatedAt))

export type Refused = { id: string; title: string; error: string; tried: string[]; hash: string; block: number }

const REFUSED_SPEC: { slot: string; title: string; tried: string[] }[] = [
  { slot: 'e4a', title: 'Amount edited after signing', tried: ['The Authorizer signed a deposit for one amount', 'The attacker raised the amount in the calldata', 'The signature recovered to a stranger'] },
  { slot: 'e4b', title: 'A signed action sent twice', tried: ['A deposit executed once, as approved', 'The attacker resent the exact same calldata', 'The contract had already used its nonce'] },
  { slot: 'e4d', title: 'Price moved after signing', tried: ['The action was signed at a price of 1.00', 'The price fell to 0.97 before it was sent', 'The contract re-checked the signed price band'] },
  { slot: 'e5-deposit', title: 'Deposit while the bank froze the agent', tried: ['The bank froze the treasury in one transaction', 'The agent then sent a deposit anyway', 'Its exit back to the Safe still went through'] },
]

export const REFUSED: Refused[] = REFUSED_SPEC.flatMap((r) => {
  const s = EVIDENCE_SLOTS[r.slot]
  return s && s.reverted && s.error ? [{ id: s.scenario, title: r.title, error: s.error, tried: r.tried, hash: s.hash, block: s.block }] : []
})

const slot = (key: string) => EVIDENCE_SLOTS[key]
export const E1_DEPOSIT = slot('e1-deposit')
export const E3_FLOOR = slot('e3-floor')
export const E5_FREEZE = slot('e5-freeze')
export const E5_EXIT = slot('e5-exit')

export const REFERENCE = { safe: REPLAY_DEPLOY.safe, module: REPLAY_DEPLOY.module, registry: REPLAY_DEPLOY.registry }

export const RECORDED_FLOOR = E3_FLOOR?.amount ?? null

export const SHIELD_HASHES = TICKER.map((t) => t.hash.slice(2, 8))
