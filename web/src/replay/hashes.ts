import type { Hex } from 'viem'
import { EVIDENCE_SCENARIOS, EVIDENCE_SLOTS, type EvidenceSlot } from './evidence'

const recordedHashes = new Set(EVIDENCE_SCENARIOS.flatMap((s) => s.txs.filter((t) => t.verified).map((t) => t.hash.toLowerCase())))

export function recordedSlot(slot: string): EvidenceSlot | undefined {
  return EVIDENCE_SLOTS[slot]
}

export function txForSlot(slot: string): Hex | undefined {
  return EVIDENCE_SLOTS[slot]?.hash
}

export function isRecordedTx(hash: string | undefined | null): boolean {
  return !!hash && recordedHashes.has(hash.toLowerCase())
}

export function recordedScenarioIds(): string[] {
  return EVIDENCE_SCENARIOS.filter((s) => s.status === 'recorded').map((s) => s.id)
}
