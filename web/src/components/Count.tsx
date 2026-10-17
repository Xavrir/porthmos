import { useLayoutEffect, useRef } from 'react'
import { gsap } from 'gsap'
import { countStart, DUR, figureAt, parseFigure, reducedMotion, tween } from '../lib/motion'

export { reducedMotion }

// Hidden or rewritten states must start inside a GSAP tick: if frames never run, the content stays as rendered.
export function onTick(fn: () => void): () => void {
  const call = gsap.delayedCall(0, fn)
  return () => { call.kill() }
}

/**
 * A money figure that counts up the first time it is seen and tweens when its value changes.
 * The text node always holds the final value (for screen readers, tests and copy); the moving digits are a
 * CSS overlay (`data-roll`) over the same box, so the layout never shifts.
 */
export function CountText({ text, id, fromZero = true, className }: { text: string; id?: string; fromZero?: boolean; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null)
  const shown = useRef<number | null>(null)
  const firstStart = useRef<number | null | undefined>(undefined)

  useLayoutEffect(() => {
    const el = ref.current
    const f = parseFigure(text)
    const from = shown.current
    if (!el || !f || reducedMotion()) { shown.current = f ? f.value : null; return }
    let at: number | null = from
    let stop: (() => void) | null = null
    let io: IntersectionObserver | null = null
    const settle = () => { el.classList.remove('is-rolling'); el.removeAttribute('data-roll') }
    const run = (start: number, duration: number) => {
      el.classList.add('is-rolling')
      stop = tween({ duration, onFrame: (p) => { at = start + (f.value - start) * p; el.dataset.roll = figureAt(start, text, p) }, onDone: settle })
    }
    if (from !== null) {
      if (from !== f.value) run(from, DUR.change)
    } else {
      // computed once per instance, so StrictMode's second effect pass does not lose the count-up
      if (firstStart.current === undefined) firstStart.current = fromZero ? countStart(id, f.value) : null
      const start = firstStart.current
      if (start === null) at = f.value
      else {
        io = new IntersectionObserver((entries) => {
          if (!entries.some((e) => e.isIntersecting)) return
          io?.disconnect()
          run(start, DUR.count)
        }, { threshold: 0.2 })
        io.observe(el)
      }
    }
    return () => { io?.disconnect(); stop?.(); settle(); shown.current = at }
  }, [text, id, fromZero])

  return <span ref={ref} className={`tw${className ? ` ${className}` : ''}`}>{text}</span>
}
