import { EVIDENCE_SCENARIOS, EVIDENCE_SLOTS } from '../replay/evidence'
import { REPLAY_DEPLOY } from '../lib/deployment'

const BASESCAN = 'https://sepolia.basescan.org'
export const txUrl = (hash: string) => `${BASESCAN}/tx/${hash}`
export const addressUrl = (address: string) => `${BASESCAN}/address/${address}`

export const REPO_URL = 'https://github.com/Xavrir/aegis-treasury'
export const DOCS_URL = `${REPO_URL}/blob/main/docs/TECHNICAL-DOCUMENT.md`
export const CONTRACTS_URL = `${REPO_URL}/tree/main/contracts`
const API_BASE = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, '') || 'https://aegis-api.150-109-23-187.sslip.io'
export const STATUS_URL = `${API_BASE}/api/health`

// Counted from the committed suites: `forge test`, `pytest -m "not integration"` / `-m integration`, `vitest run`.
export const TESTS = { contracts: 106, contractInvariants: 6, serviceUnit: 161, serviceIntegration: 15, web: 61 }
export const TEST_TOTAL = TESTS.contracts + TESTS.serviceUnit + TESTS.serviceIntegration + TESTS.web

export function shortHash(hash: string, head = 6, tail = 4): string {
  return hash.length > head + tail + 1 ? `${hash.slice(0, head)}...${hash.slice(-tail)}` : hash
}

export const blockText = (n: number) => n.toLocaleString('en-US')

export type TickerItem = { scenario: string; hash: string; block: number; reverted: boolean; error?: string }

export const TICKER: TickerItem[] = EVIDENCE_SCENARIOS
  .filter((s) => s.status === 'recorded')
  .flatMap((s) => s.txs.map((t) => ({ scenario: s.id, hash: t.hash, block: t.block, reverted: t.reverted, error: t.error })))

export const TX_COUNT = TICKER.length
export const REVERTED = TICKER.filter((t) => t.reverted)
export const REFUSED_IDS = REVERTED.map((t) => t.scenario).join(', ')

type Refused = { id: string; title: string; error: string; tried: string[]; hash: string; block: number }

const REFUSED_SPEC: { slot: string; title: string; tried: string[] }[] = [
  { slot: 'e4a', title: 'Amount edited after signing', tried: ['The Authorizer signed a deposit for one amount', 'The attacker raised the amount in the calldata', 'The signature recovered to a stranger'] },
  { slot: 'e4b', title: 'A signed action sent twice', tried: ['A deposit executed once, as approved', 'The attacker resent the exact same calldata', 'The contract had already used its nonce'] },
  { slot: 'e4d', title: 'Price moved after signing', tried: ['The action was signed at a price of 1.00', 'The price fell to 0.97 before it was sent', 'The contract re-checked the signed price band'] },
  { slot: 'e5-deposit', title: 'Deposit while the bank froze the agent', tried: ['The bank froze the treasury in one transaction', 'The agent then sent a deposit anyway'] },
]

export const REFUSED: Refused[] = REFUSED_SPEC.flatMap((r) => {
  const s = EVIDENCE_SLOTS[r.slot]
  return s && s.reverted && s.error ? [{ id: s.scenario, title: r.title, error: s.error, tried: r.tried, hash: s.hash, block: s.block }] : []
})

export const E5_EXIT = EVIDENCE_SLOTS['e5-exit']

export const REFERENCE = { safe: REPLAY_DEPLOY.safe, module: REPLAY_DEPLOY.module, registry: REPLAY_DEPLOY.registry }

export const SHIELD_HASHES = TICKER.map((t) => t.hash.slice(2, 8))
