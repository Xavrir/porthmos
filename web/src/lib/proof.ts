import { EVIDENCE_META, EVIDENCE_SCENARIOS, EVIDENCE_SLOTS } from '../replay/evidence'

export const BASESCAN_TX = 'https://sepolia.basescan.org/tx/'

export const CONTRACT_SUITE = { count: 47, ids: 'C1 to C26 and R1 to R4', path: 'contracts/test' }

export type Refusal = {
  name: string
  parts: string[]
  what: string
  test: string
  scenario?: string
  slot?: string
}

export const REFUSALS: Refusal[] = [
  { name: 'BadSignature', parts: ['Bad', 'Signature'], what: 'A record’s amount edited after it was signed.', test: 'C3', scenario: 'E4a', slot: 'e4a' },
  { name: 'NonceUsed', parts: ['Nonce', 'Used'], what: 'An executed record sent a second time.', test: 'C5', scenario: 'E4b', slot: 'e4b' },
  { name: 'PriceOutOfBand', parts: ['PriceOut', 'OfBand'], what: 'The price left the signed band before execution.', test: 'C16', scenario: 'E4d', slot: 'e4d' },
  { name: 'Frozen', parts: ['Frozen'], what: 'A deposit sent while the bank froze the agent.', test: 'C19', scenario: 'E5', slot: 'e5-deposit' },
  { name: 'StaleOracle', parts: ['Stale', 'Oracle'], what: 'A price older than 180 seconds.', test: 'C18' },
  { name: 'ReserveFloorBreached', parts: ['ReserveFloor', 'Breached'], what: 'The Safe would drop below the reserve.', test: 'C8' },
  { name: 'VaultQuarantined', parts: ['Vault', 'Quarantined'], what: 'A deposit into a vault after a risk trigger.', test: 'C24' },
  { name: 'MissingApproval', parts: ['Missing', 'Approval'], what: 'Above the auto cap with no owner signature.', test: 'C12' },
  { name: 'DailyCapExceeded', parts: ['DailyCap', 'Exceeded'], what: 'More than 5,000.00 in one UTC day.', test: 'C9' },
]

export type Proof =
  | { kind: 'onchain'; hash: string; block: number; href: string }
  | { kind: 'scheduled'; scenario: string; test: string }
  | { kind: 'test'; test: string }

export function refusalFor(error: string | null | undefined): Refusal | undefined {
  return error ? REFUSALS.find((r) => r.name === error) : undefined
}

export function proofFor(r: Refusal): Proof {
  const slot = r.slot ? EVIDENCE_SLOTS[r.slot] : undefined
  if (slot?.reverted) return { kind: 'onchain', hash: slot.hash, block: slot.block, href: BASESCAN_TX + slot.hash }
  if (r.scenario) return { kind: 'scheduled', scenario: r.scenario, test: r.test }
  return { kind: 'test', test: r.test }
}

const utc = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'UTC' })

export function scheduledAfter(): string | null {
  const iso = EVIDENCE_META.scheduledAfter
  return iso ? `${utc.format(new Date(iso)).replace(',', '')} UTC` : null
}

export function proofSentence(p: Proof): string {
  if (p.kind === 'onchain') return `Reverted on Base Sepolia, block ${p.block.toLocaleString('en-US')}.`
  if (p.kind === 'scheduled') {
    const after = scheduledAfter()
    return `Not on Base Sepolia yet: ${p.scenario} is scheduled${after ? ` after ${after}` : ''}. Proven now by contract test ${p.test}.`
  }
  return `Proven by contract test ${p.test}.`
}

export const RECORDED_SCENARIOS = EVIDENCE_SCENARIOS.filter((s) => s.status === 'recorded').map((s) => s.id)
export const SCHEDULED_SCENARIOS = EVIDENCE_SCENARIOS.filter((s) => s.status === 'pending').map((s) => s.id)

export function onchainRefusalCount(): number {
  return REFUSALS.filter((r) => proofFor(r).kind === 'onchain').length
}

export type ChainFact = { label: string; href: string; block: number }

export function chainFacts(): ChainFact[] {
  const pick = (slot: string, label: string): ChainFact | null => {
    const s = EVIDENCE_SLOTS[slot]
    return s ? { label, href: BASESCAN_TX + s.hash, block: s.block } : null
  }
  const refusal = REFUSALS.map((r) => ({ r, p: proofFor(r) })).find((x) => x.p.kind === 'onchain')
  return [
    pick('e1-deposit', 'Deposit executed with the owner’s approval (E1)'),
    pick('e2-exit-1', 'Exit Agent left a depegged vault (E2)'),
    pick('e3-floor', 'Owner raised the reserve floor (E3)'),
    refusal && refusal.p.kind === 'onchain' ? { label: `Attack reverted ${refusal.r.name} (${refusal.r.scenario})`, href: refusal.p.href, block: refusal.p.block } : null,
  ].filter((x): x is ChainFact => !!x)
}
