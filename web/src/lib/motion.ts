export const ENTER = [0.2, 0, 0, 1] as const
export const EXIT = [0.4, 0, 1, 1] as const
export const CSS_ENTER = `cubic-bezier(${ENTER.join(', ')})`
export const CSS_EXIT = `cubic-bezier(${EXIT.join(', ')})`

export const DUR = { exit: 150, fast: 150, enter: 240, change: 360, count: 520, draw: 520 } as const

export function cubicBezier(x1: number, y1: number, x2: number, y2: number): (t: number) => number {
  const cx = 3 * x1
  const bx = 3 * (x2 - x1) - cx
  const ax = 1 - cx - bx
  const cy = 3 * y1
  const by = 3 * (y2 - y1) - cy
  const ay = 1 - cy - by
  const sx = (t: number) => ((ax * t + bx) * t + cx) * t
  const sy = (t: number) => ((ay * t + by) * t + cy) * t
  const dx = (t: number) => (3 * ax * t + 2 * bx) * t + cx
  return (x: number) => {
    if (x <= 0) return 0
    if (x >= 1) return 1
    let t = x
    for (let i = 0; i < 8; i++) {
      const err = sx(t) - x
      if (Math.abs(err) < 1e-6) return sy(t)
      const d = dx(t)
      if (Math.abs(d) < 1e-6) break
      t -= err / d
    }
    let lo = 0
    let hi = 1
    t = x
    for (let i = 0; i < 40; i++) {
      const v = sx(t)
      if (Math.abs(v - x) < 1e-6) break
      if (v < x) lo = t
      else hi = t
      t = (lo + hi) / 2
    }
    return sy(t)
  }
}

export const easeEnter = cubicBezier(...ENTER)
export const easeExit = cubicBezier(...EXIT)

export function reducedMotion(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

export type Figure = { before: string; after: string; value: number; decimals: number; grouped: boolean }

const NUMBER = /-?\d[\d,]*(?:\.\d+)?/

export function parseFigure(text: string): Figure | null {
  const m = text.match(NUMBER)
  if (!m || m.index === undefined) return null
  const raw = m[0]
  const value = Number(raw.replace(/,/g, ''))
  if (!Number.isFinite(value)) return null
  return {
    before: text.slice(0, m.index),
    after: text.slice(m.index + raw.length),
    value,
    decimals: raw.includes('.') ? raw.split('.')[1].length : 0,
    grouped: raw.includes(',') || Math.abs(value) >= 10000,
  }
}

export function formatFigure(f: Figure, v: number): string {
  const n = f.grouped
    ? v.toLocaleString('en-US', { minimumFractionDigits: f.decimals, maximumFractionDigits: f.decimals })
    : v.toFixed(f.decimals)
  return `${f.before}${n}${f.after}`
}

/** The text a figure shows `progress` (0 to 1, already eased) of the way from `from` to `to`; at 1 it is exactly `to`. */
export function figureAt(from: number, to: string, progress: number): string {
  const f = parseFigure(to)
  if (!f || progress >= 1) return to
  return formatFigure(f, from + (f.value - from) * Math.max(0, progress))
}

/** Reads `a` at the same relative positions as `b`'s points, so series of different lengths can morph. */
export function resampleTo(a: readonly number[], n: number): number[] {
  if (a.length === n) return [...a]
  if (!a.length) return new Array(n).fill(0)
  if (a.length === 1 || n === 1) return new Array(n).fill(a[a.length - 1])
  return Array.from({ length: n }, (_, i) => {
    const p = (i / (n - 1)) * (a.length - 1)
    const k = Math.floor(p)
    const f = p - k
    return k + 1 < a.length ? a[k] + (a[k + 1] - a[k]) * f : a[k]
  })
}

export function lerpSeries(a: readonly number[], b: readonly number[], t: number): number[] {
  const from = resampleTo(a, b.length)
  return b.map((v, i) => from[i] + (v - from[i]) * t)
}

export function sameSeries(a: readonly (readonly number[])[], b: readonly (readonly number[])[]): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    if (a[i].length !== b[i].length) return false
    for (let j = 0; j < a[i].length; j++) if (Math.abs(a[i][j] - b[i][j]) > 0.05) return false
  }
  return true
}

type Frame = (cb: (now: number) => void) => number

export type TweenOptions = {
  duration: number
  ease?: (t: number) => number
  onFrame: (eased: number) => void
  onDone?: () => void
  reduced?: boolean
  raf?: Frame
  caf?: (id: number) => void
}

/** Drives one tween. With reduced motion (or no frames) it applies the final state at once, synchronously. */
export function tween({ duration, ease = easeEnter, onFrame, onDone, reduced = reducedMotion(), raf, caf }: TweenOptions): () => void {
  const request = raf ?? (typeof requestAnimationFrame === 'function' ? requestAnimationFrame : undefined)
  if (reduced || duration <= 0 || !request) {
    onFrame(1)
    onDone?.()
    return () => {}
  }
  const cancel = caf ?? (typeof cancelAnimationFrame === 'function' ? cancelAnimationFrame : () => {})
  let start: number | null = null
  let id = 0
  let live = true
  const step = (now: number) => {
    if (!live) return
    if (start === null) start = now
    const p = Math.min(1, (now - start) / duration)
    onFrame(p >= 1 ? 1 : ease(p))
    if (p >= 1) { live = false; onDone?.(); return }
    id = request(step)
  }
  id = request(step)
  return () => { if (live) { live = false; cancel(id) } }
}

const lastShown = new Map<string, number>()

/** Where a remembered figure should start counting from: zero the first time, the last value seen on a later visit. */
export function countStart(id: string | undefined, to: number): number | null {
  if (!id) return 0
  const prev = lastShown.get(id)
  lastShown.set(id, to)
  if (prev === undefined) return 0
  return prev === to ? null : prev
}

export function forgetFigures() {
  lastShown.clear()
}
