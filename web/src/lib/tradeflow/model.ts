import { getAddress, keccak256, stringToHex, type Address, type Hex } from 'viem'

export type IssuerRole = 'carrier' | 'sensor' | 'surveyor'
export type Issuers = Record<IssuerRole, Address>

export type MilestoneSpec = {
  index: 0 | 1 | 2
  kind: 0 | 1 | 2
  kindName: 'HANDOVER' | 'ARRIVAL' | 'QUALITY'
  label: string
  short: string
  role: IssuerRole
  issuerLabel: string
  standIn: string
  document: string
  shareBps: bigint
  requireDoc: boolean
  checkTemp: boolean
  minTempCenti: number
  maxTempCenti: number
  days: number
}

// TECHNICAL-DOCUMENT 02, TradeFlow scope table. Bundled with the build, never read from the API (C1).
export const MILESTONES: readonly MilestoneSpec[] = [
  { index: 0, kind: 0, kindName: 'HANDOVER', label: 'Handed to carrier', short: 'Handover', role: 'carrier', issuerLabel: 'Demo carrier', standIn: 'Stand-in for an eBL or TradeTrust document', document: 'Bill of lading', shareBps: 2000n, requireDoc: true, checkTemp: false, minTempCenti: 0, maxTempCenti: 0, days: 7 },
  { index: 1, kind: 1, kindName: 'ARRIVAL', label: 'Arrived', short: 'Arrival', role: 'sensor', issuerLabel: 'Demo reefer sensor', standIn: 'Stand-in for an IoT gateway', document: 'Sensor log export', shareBps: 4000n, requireDoc: true, checkTemp: true, minTempCenti: 200, maxTempCenti: 800, days: 21 },
  { index: 2, kind: 2, kindName: 'QUALITY', label: 'Quality accepted', short: 'Quality', role: 'surveyor', issuerLabel: 'Demo surveyor', standIn: 'Stand-in for an independent survey report', document: 'Survey report', shareBps: 4000n, requireDoc: true, checkTemp: false, minTempCenti: 0, maxTempCenti: 0, days: 30 },
]

export const USDC_UNIT = 1_000_000n

export class InputError extends Error {}

export function parseUsdc(text: string): bigint {
  const t = text.trim().replace(/,/g, '')
  const m = /^(\d{1,12})(?:\.(\d{1,6}))?$/.exec(t)
  if (!m) throw new InputError('Enter an amount like 1000 or 1250.50, with at most 6 decimals.')
  const raw = BigInt(m[1]) * USDC_UNIT + BigInt((m[2] ?? '').padEnd(6, '0') || '0')
  if (raw <= 0n) throw new InputError('The total must be more than zero.')
  return raw
}

// Integer split in raw token units; the remainder goes to the last milestone, so the parts always sum to the total.
export function splitTotal(total: bigint, shares: readonly bigint[] = MILESTONES.map((m) => m.shareBps)): bigint[] {
  if (total <= 0n) throw new InputError('The total must be more than zero.')
  const sum = shares.reduce((a, b) => a + b, 0n)
  if (sum !== 10_000n) throw new InputError('Milestone shares must add up to 100%.')
  const parts = shares.slice(0, -1).map((s) => (total * s) / 10_000n)
  parts.push(total - parts.reduce((a, b) => a + b, 0n))
  if (parts.some((p) => p <= 0n)) throw new InputError('The total is too small to split into three milestones.')
  return parts
}

export type Terms = {
  amount: bigint
  issuer: Address
  kind: number
  requireDoc: boolean
  checkTemp: boolean
  minTempCenti: number
  maxTempCenti: number
  deadline: bigint
}

export function buildTerms(total: bigint, issuers: Issuers, now: bigint, days: readonly number[] = MILESTONES.map((m) => m.days)): Terms[] {
  const amounts = splitTotal(total)
  return MILESTONES.map((m, i) => ({
    amount: amounts[i], issuer: getAddress(issuers[m.role]), kind: m.kind, requireDoc: m.requireDoc, checkTemp: m.checkTemp,
    minTempCenti: m.minTempCenti, maxTempCenti: m.maxTempCenti, deadline: now + BigInt(Math.round(days[i] * 86400)),
  }))
}

// Python json.dumps(sort_keys=True, separators=(",", ":")) with ensure_ascii, the form the service and E6 evidence hash.
export function canonicalJson(v: unknown): string {
  if (v === null || typeof v !== 'object') {
    return JSON.stringify(v).replace(/[^ -\x7f]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`)
  }
  if (Array.isArray(v)) return `[${v.map(canonicalJson).join(',')}]`
  const o = v as Record<string, unknown>
  return `{${Object.keys(o).sort().map((k) => `${canonicalJson(k)}:${canonicalJson(o[k])}`).join(',')}}`
}

export type PurchaseOrder = {
  buyer: Address
  supplier: Address
  token: Address
  total: string
  terms: string
  milestones: { amount: string; issuer: Address; kind: number; kindName: string; requireDoc: boolean; checkTemp: boolean; minTempCenti: number; maxTempCenti: number; deadline: number }[]
}

export function purchaseOrder(p: { buyer: Address; supplier: Address; token: Address; total: bigint; terms: string; ms: Terms[] }): PurchaseOrder {
  return {
    buyer: getAddress(p.buyer), supplier: getAddress(p.supplier), token: getAddress(p.token), total: p.total.toString(), terms: p.terms,
    milestones: p.ms.map((t, i) => ({
      amount: t.amount.toString(), issuer: getAddress(t.issuer), kind: t.kind, kindName: MILESTONES[i].kindName, requireDoc: t.requireDoc,
      checkTemp: t.checkTemp, minTempCenti: t.minTempCenti, maxTempCenti: t.maxTempCenti, deadline: Number(t.deadline),
    })),
  }
}

export function termsHash(po: PurchaseOrder): Hex {
  return keccak256(stringToHex(canonicalJson(po)))
}

export function tempRange(minCenti: number, maxCenti: number): string {
  return `${(minCenti / 100).toFixed(2)} to ${(maxCenti / 100).toFixed(2)} °C`
}

export function conditionText(m: Pick<Terms, 'requireDoc' | 'checkTemp' | 'minTempCenti' | 'maxTempCenti'>, doc?: string): string {
  const parts = []
  if (m.requireDoc) parts.push(`${doc ?? 'Document'} hash required`)
  if (m.checkTemp) parts.push(`temperature ${tempRange(m.minTempCenti, m.maxTempCenti)}`)
  return parts.join('; ') || 'No condition'
}
