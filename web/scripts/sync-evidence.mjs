import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const source = resolve(process.env.EVIDENCE_SOURCE ?? resolve(here, '../../deployments/evidence-84532.json'))
const target = resolve(process.env.EVIDENCE_TARGET ?? resolve(here, '../src/replay/evidence.ts'))

if (!existsSync(source)) {
  console.error(`[evidence] ${source} not found`)
  process.exit(1)
}
const ev = JSON.parse(readFileSync(source, 'utf8'))

const PENDING = {
  E4a: ['A decision record with its amount changed after signing, expected to revert BadSignature', 'BadSignature'],
  E4b: ['An executed decision record sent a second time, expected to revert NonceUsed', 'NonceUsed'],
  E4d: ['The price moved out of the signed band before execution, expected to revert PriceOutOfBand', 'PriceOutOfBand'],
  E5: ['Bank freeze: a deposit expected to revert Frozen while an exit still executes', 'Frozen'],
}

// Slot rules: which replay row a recorded transaction may stand behind. Order matters for repeated labels.
const RULES = [
  { scenario: 'E1', slot: 'e1-deposit', test: /deposit/i },
  { scenario: 'E2', slot: 'e2-price', test: /sets price/i },
  { scenario: 'E2', slot: 'e2-quarantine-1', test: /quarantin/i },
  { scenario: 'E2', slot: 'e2-quarantine-2', test: /quarantin/i },
  { scenario: 'E2', slot: 'e2-exit-1', test: /exit redeem/i },
  { scenario: 'E2', slot: 'e2-exit-2', test: /exit redeem/i },
  { scenario: 'E2', slot: 'e2-price-restore', test: /cleanup|price 1/i },
  { scenario: 'E3', slot: 'e3-floor', test: /floor/i },
  { scenario: 'E3', slot: 'e3-redeem-b', test: /redeem/i },
  { scenario: 'E4a', slot: 'e4a', test: /./, revert: true },
  { scenario: 'E4b', slot: 'e4b', test: /./, revert: true },
  { scenario: 'E4d', slot: 'e4d', test: /./, revert: true },
  { scenario: 'E5', slot: 'e5-freeze', test: /(?<!un)freeze/i },
  { scenario: 'E5', slot: 'e5-deposit', test: /deposit/i, revert: true },
  { scenario: 'E5', slot: 'e5-exit', test: /exit|redeem/i },
  { scenario: 'E5', slot: 'e5-unfreeze', test: /unfreeze/i },
]

const isRevert = (t) => !!t.expected && t.expected !== 'success'
const errorName = (t) => (t.decodedError ?? (isRevert(t) ? t.expected : '') ?? '').replace(/\(\)$/, '') || undefined

const amountIn = (label) => {
  const m = label.match(/([\d,]+\.\d{2})\s*USDC/i) ?? label.match(/([\d,]+(?:\.\d+)?)\s*USDC/i)
  return m ? Number(m[1].replace(/,/g, '')) : undefined
}

const scenarios = ev.scenarios.filter((s) => /^E\d/.test(s.id))
const slots = {}
const used = new Set()
for (const rule of RULES) {
  const s = scenarios.find((x) => x.id === rule.scenario && x.status === 'recorded')
  if (!s) continue
  const tx = (s.transactions ?? []).find((t) => !used.has(t.hash) && t.verified === true && rule.test.test(t.label) && isRevert(t) === !!rule.revert && (!rule.revert || t.receiptStatus === 0))
  if (!tx) continue
  used.add(tx.hash)
  slots[rule.slot] = { scenario: s.id, note: tx.label, hash: tx.hash, block: tx.block, amount: amountIn(tx.label), darHash: rule.slot === 'e1-deposit' ? s.darHash : undefined, reverted: isRevert(tx) || undefined, error: isRevert(tx) ? errorName(tx) : undefined }
}
const e3 = scenarios.find((s) => s.id === 'E3' && s.status === 'recorded')
if (e3?.floorUpdate?.floor && slots['e3-floor']) slots['e3-floor'].amount = Number(e3.floorUpdate.floor.raw) / 1e6

const list = [...scenarios.map((s) => ({
  id: s.id,
  status: s.status === 'recorded' ? 'recorded' : 'pending',
  description: s.description,
  requestId: s.requestId ?? undefined,
  reply: s.reply ?? undefined,
  expectedError: s.expectedError ? s.expectedError.replace(/\(\)$/, '') : undefined,
  txs: (s.transactions ?? []).map((t) => ({ label: t.label, hash: t.hash, block: t.block, role: t.role, expected: t.expected, verified: t.verified === true, reverted: t.receiptStatus === 0, error: errorName(t) })),
  ledgerRows: (s.ledgerRef ?? []).length,
})), ...Object.entries(PENDING).filter(([id]) => !scenarios.some((s) => s.id === id)).map(([id, [description, expectedError]]) => ({ id, status: 'pending', description, expectedError, txs: [], ledgerRows: 0 }))]
const order = ['E1', 'E2', 'E3', 'E4a', 'E4b', 'E4c', 'E4d', 'E5']
const cooldown = (ev.failures ?? []).map((f) => String(f).match(/cooldown ends at (\S+?);/)?.[1]).find(Boolean)
const scheduledAfter = list.some((s) => s.status === 'pending') && cooldown ? new Date(cooldown).toISOString() : undefined
list.sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id))

// The recorded E6 TradeFlow order, for the Orders page in replay. Only recorded fields; nothing is derived or invented.
const tf = ev.tradeflow
const e6 = Object.fromEntries(scenarios.filter((s) => /^E6/.test(s.id)).map((s) => [s.id, s]))
const recordedOrder = tf?.purchaseOrder && e6.E6a?.status === 'recorded' ? {
  orderId: String(tf.orderId ?? e6.E6a.orderId),
  buyer: tf.purchaseOrder.buyer, supplier: tf.purchaseOrder.supplier, token: tf.purchaseOrder.token,
  escrow: tf.escrow, multiSendCallOnly: tf.multiSendCallOnly, total: tf.purchaseOrder.total, termsHash: tf.termsHash,
  terms: tf.purchaseOrder.terms, milestones: tf.purchaseOrder.milestones, orderStatus: e6.E6e?.orderStatus ?? null,
  steps: Object.values(e6).filter((s) => s.status === 'recorded').map((s) => ({
    id: s.id, description: s.description, requestId: s.requestId ?? null, proofHash: s.proofHash ?? null, proof: s.proof ?? null,
    workflow: s.workflow ?? [], explanation: s.explanation ?? null,
    ledger: (s.ledgerRef ?? []).map((r) => ({ ledgerId: r.ledgerId, kind: r.kind, reason: r.reason ?? null, txHash: r.txHash ?? null, requestId: r.requestId ?? null, rowHash: r.rowHash, prevHash: r.prevHash })),
    txs: (s.transactions ?? []).map((t) => ({ label: t.label, hash: t.hash, block: t.block, role: t.role, reverted: t.receiptStatus === 0, error: errorName(t) ?? null, scriptSigned: t.scriptSigned === true })),
  })),
} : null

const out = `// Generated by \`npm run evidence:sync\` from deployments/evidence-84532.json. Do not edit by hand.
import type { Hex } from 'viem'

export type EvidenceSlot = { scenario: string; note: string; hash: Hex; block: number; amount?: number; darHash?: Hex; reverted?: boolean; error?: string }
export type EvidenceTx = { label: string; hash: Hex; block: number; role: string; expected: string; verified: boolean; reverted: boolean; error?: string }
export type EvidenceScenario = { id: string; status: 'recorded' | 'pending'; description: string; requestId?: string; reply?: string; expectedError?: string; txs: EvidenceTx[]; ledgerRows: number }
export type EvidenceMeta = { network: string; chainId: number; generatedAt: string; deployBlock: number; scheduledAfter?: string }

export const EVIDENCE_META: EvidenceMeta = ${JSON.stringify({ network: ev.network, chainId: ev.chainId, generatedAt: ev.generatedAt, deployBlock: ev.deployBlock, scheduledAfter }, null, 2)}

export const EVIDENCE_SLOTS: Partial<Record<string, EvidenceSlot>> = ${JSON.stringify(slots, null, 2)}

export const EVIDENCE_SCENARIOS: EvidenceScenario[] = ${JSON.stringify(list, null, 2)}

export type EvidenceOrderTx = { label: string; hash: Hex; block: number; role: string; reverted: boolean; error: string | null; scriptSigned: boolean }
export type EvidenceOrderStep = {
  id: string
  description: string
  requestId: string | null
  proofHash: Hex | null
  proof: { orderId: string; index: number; kind: number; docHash: Hex; minTempCenti: number; maxTempCenti: number; samples: number; issuedAt: string } | null
  workflow: string[]
  explanation: { text: string; proposal: string; source: string } | null
  ledger: { ledgerId: number; kind: string; reason: string | null; txHash: Hex | null; requestId: string | null; rowHash: string; prevHash: string }[]
  txs: EvidenceOrderTx[]
}
export type EvidenceOrder = {
  orderId: string
  buyer: Hex
  supplier: Hex
  token: Hex
  escrow: Hex
  multiSendCallOnly: Hex
  total: string
  termsHash: Hex
  terms: string
  milestones: { amount: string; issuer: Hex; kind: number; kindName: string; requireDoc: boolean; checkTemp: boolean; minTempCenti: number; maxTempCenti: number; deadline: number }[]
  orderStatus: string | null
  steps: EvidenceOrderStep[]
}

export const EVIDENCE_ORDER: EvidenceOrder | null = ${JSON.stringify(recordedOrder, null, 2)}
`
writeFileSync(target, out)
console.log(`[evidence] ${Object.keys(slots).length} recorded slots: ${Object.keys(slots).join(', ')}`)
console.log(`[evidence] scenarios: ${list.map((s) => `${s.id}=${s.status}`).join(' ')}`)
