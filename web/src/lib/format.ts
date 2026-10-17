import type { Amount } from './types'

export const USDC_DECIMALS = 6
export const PRICE_DECIMALS = 8

const usd = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

export function toUnits(value: number, decimals = USDC_DECIMALS): bigint {
  return BigInt(Math.round(value * 10 ** decimals))
}

export function fromUnits(raw: string | bigint, decimals = USDC_DECIMALS): number {
  const v = typeof raw === 'bigint' ? raw : BigInt(raw || '0')
  const neg = v < 0n
  const abs = neg ? -v : v
  const base = 10n ** BigInt(decimals)
  const n = Number(abs / base) + Number(abs % base) / Number(base)
  return neg ? -n : n
}

export function amount(value: number | bigint): Amount {
  const raw = typeof value === 'bigint' ? value : toUnits(value)
  return { raw: raw.toString(), display: usd.format(fromUnits(raw)) }
}

export function num(a: Amount | undefined): number {
  return a ? fromUnits(a.raw) : 0
}

export function money(value: number): string {
  return usd.format(value)
}

export function compact(value: number): string {
  if (Math.abs(value) >= 1000) return `${usd.format(value / 1000).replace(/\.?0+$/, '')}k`
  return usd.format(value)
}

export function price(raw: string | number | bigint): string {
  const n = typeof raw === 'number' ? raw : fromUnits(BigInt(raw), PRICE_DECIMALS)
  return n.toFixed(4)
}

export function shortHex(hex: string | undefined | null, head = 6, tail = 4): string {
  if (!hex) return ''
  return hex.length <= head + tail + 2 ? hex : `${hex.slice(0, head)}…${hex.slice(-tail)}`
}

export const TIME_ZONE_LABEL = 'UTC+8'
const TZ = 'Asia/Shanghai'
const timeFmt = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false, timeZone: TZ })
const dayFmt = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', timeZone: TZ })

export function clock(ts: number): string {
  return timeFmt.format(new Date(ts * 1000))
}

export function day(ts: number | string): string {
  const d = typeof ts === 'string' ? new Date(`${ts}T12:00:00Z`) : new Date(ts * 1000)
  return dayFmt.format(d)
}

export function stamp(ts: number): string {
  return `${day(ts)}, ${clock(ts)}`
}

export function seconds(s: number): string {
  if (s < 90) return `${Math.round(s)} s`
  if (s < 5400) return `${Math.round(s / 60)} min`
  return `${Math.round(s / 3600)} h`
}

export function pct(v: number, digits = 0): string {
  return `${(v * 100).toFixed(digits)}%`
}

// Exact token amount from raw units: at least 2 decimals, more only when the units need them.
export function exactUnits(raw: bigint, decimals = USDC_DECIMALS): string {
  const neg = raw < 0n
  const abs = neg ? -raw : raw
  const base = 10n ** BigInt(decimals)
  const frac = (abs % base).toString().padStart(decimals, '0').replace(/0+$/, '').padEnd(2, '0')
  return `${neg ? '-' : ''}${(abs / base).toLocaleString('en-US')}.${frac}`
}
