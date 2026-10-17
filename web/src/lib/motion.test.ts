import { afterEach, describe, expect, it, vi } from 'vitest'
import { countStart, cubicBezier, easeEnter, figureAt, forgetFigures, formatFigure, lerpSeries, parseFigure, reducedMotion, resampleTo, sameSeries, tween } from './motion'

function fakeFrames() {
  const queue = new Map<number, (now: number) => void>()
  let id = 0
  let now = 0
  return {
    raf: (cb: (now: number) => void) => { id += 1; queue.set(id, cb); return id },
    caf: (n: number) => { queue.delete(n) },
    advance(ms: number) {
      now += ms
      const due = [...queue.entries()]
      queue.clear()
      for (const [, cb] of due) cb(now)
    },
    get pending() { return queue.size },
  }
}

describe('cubicBezier', () => {
  it('pins the ends and stays monotonic', () => {
    const e = cubicBezier(0.2, 0, 0, 1)
    expect(e(0)).toBe(0)
    expect(e(1)).toBe(1)
    let prev = 0
    for (let i = 1; i <= 100; i++) {
      const v = e(i / 100)
      expect(v).toBeGreaterThanOrEqual(prev - 1e-9)
      prev = v
    }
  })

  it('is front-loaded for the enter curve and linear for (0,0,1,1)', () => {
    expect(easeEnter(0.5)).toBeGreaterThan(0.75)
    expect(cubicBezier(0, 0, 1, 1)(0.3)).toBeCloseTo(0.3, 4)
  })
})

describe('number tween formatting', () => {
  it('parses a money figure with prefix, grouping, decimals and suffix', () => {
    expect(parseFigure('$12,345.67 USDC')).toEqual({ before: '$', after: ' USDC', value: 12345.67, decimals: 2, grouped: true })
    expect(parseFigure('No value')).toBeNull()
  })

  it('keeps the shape of the target while counting', () => {
    expect(figureAt(0, '12,345.67', 0.5)).toBe('6,172.84')
    expect(figureAt(1000, '2,000.00', 0)).toBe('1,000.00')
    expect(figureAt(0, '42', 0.5)).toBe('21')
    expect(figureAt(-10, '−5', 1)).toBe('−5')
  })

  it('ends on the exact target text, never a rounded copy', () => {
    expect(figureAt(0, '1,234.565 USDC', 1)).toBe('1,234.565 USDC')
    expect(figureAt(999, 'Pending', 0.4)).toBe('Pending')
  })

  it('formats with the same digits as the source', () => {
    const f = parseFigure('9,999.00')!
    expect(formatFigure(f, 10000)).toBe('10,000.00')
    expect(formatFigure(parseFigure('0.5')!, 0.25)).toBe('0.3')
  })
})

describe('series morphing', () => {
  it('resamples to a new length by relative position', () => {
    expect(resampleTo([0, 10], 3)).toEqual([0, 5, 10])
    expect(resampleTo([4], 3)).toEqual([4, 4, 4])
    expect(resampleTo([], 2)).toEqual([0, 0])
  })

  it('interpolates between series of different lengths and lands on the target', () => {
    expect(lerpSeries([0, 0], [10, 20, 30], 0)).toEqual([0, 0, 0])
    expect(lerpSeries([0, 0], [10, 20, 30], 1)).toEqual([10, 20, 30])
    expect(lerpSeries([0, 10], [10, 10], 0.5)).toEqual([5, 10])
  })

  it('treats sub-pixel noise as the same series', () => {
    expect(sameSeries([[1, 2]], [[1.01, 2]])).toBe(true)
    expect(sameSeries([[1, 2]], [[1, 3]])).toBe(false)
    expect(sameSeries([[1, 2]], [[1, 2, 3]])).toBe(false)
  })
})

describe('tween', () => {
  it('runs on frames and finishes at exactly 1', () => {
    const f = fakeFrames()
    const seen: number[] = []
    const done = vi.fn()
    tween({ duration: 100, reduced: false, raf: f.raf, caf: f.caf, onFrame: (p) => seen.push(p), onDone: done })
    expect(seen).toEqual([])
    f.advance(16)
    f.advance(50)
    expect(seen[seen.length - 1]).toBeGreaterThan(0)
    expect(seen[seen.length - 1]).toBeLessThan(1)
    f.advance(100)
    expect(seen[seen.length - 1]).toBe(1)
    expect(done).toHaveBeenCalledOnce()
    expect(f.pending).toBe(0)
  })

  it('can be cancelled before it ends', () => {
    const f = fakeFrames()
    const onFrame = vi.fn()
    const stop = tween({ duration: 100, reduced: false, raf: f.raf, caf: f.caf, onFrame })
    f.advance(16)
    stop()
    f.advance(200)
    expect(onFrame).toHaveBeenCalledTimes(1)
  })
})

describe('reduced motion', () => {
  afterEach(() => { vi.unstubAllGlobals(); forgetFigures() })

  it('reads the user preference', () => {
    vi.stubGlobal('window', { matchMedia: (q: string) => ({ matches: q.includes('reduce') }) })
    expect(reducedMotion()).toBe(true)
    vi.stubGlobal('window', { matchMedia: () => ({ matches: false }) })
    expect(reducedMotion()).toBe(false)
  })

  it('applies the final state at once and never asks for a frame', () => {
    const raf = vi.fn()
    const seen: number[] = []
    const done = vi.fn()
    tween({ duration: 400, reduced: true, raf, onFrame: (p) => seen.push(p), onDone: done })
    expect(seen).toEqual([1])
    expect(done).toHaveBeenCalledOnce()
    expect(raf).not.toHaveBeenCalled()
  })

  it('follows the media query when no preference is passed', () => {
    vi.stubGlobal('window', { matchMedia: () => ({ matches: true }) })
    const raf = vi.fn()
    const seen: number[] = []
    tween({ duration: 400, raf, onFrame: (p) => seen.push(p) })
    expect(seen).toEqual([1])
    expect(raf).not.toHaveBeenCalled()
  })
})

describe('countStart', () => {
  afterEach(() => forgetFigures())

  it('counts from zero once, then from the last value seen, and not at all when unchanged', () => {
    expect(countStart('kpi:a', 100)).toBe(0)
    expect(countStart('kpi:a', 100)).toBeNull()
    expect(countStart('kpi:a', 140)).toBe(100)
    expect(countStart(undefined, 5)).toBe(0)
  })
})
