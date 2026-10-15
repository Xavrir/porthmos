import { useLayoutEffect, useRef } from 'react'
import { gsap } from 'gsap'

export function reducedMotion(): boolean {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

const NUMBER = /-?\d[\d,]*(?:\.\d+)?/

function parse(text: string) {
  const m = text.match(NUMBER)
  if (!m || m.index === undefined) return null
  const raw = m[0]
  const decimals = raw.includes('.') ? raw.split('.')[1].length : 0
  return { before: text.slice(0, m.index), after: text.slice(m.index + raw.length), value: Number(raw.replace(/,/g, '')), decimals, grouped: raw.includes(',') || Math.abs(Number(raw.replace(/,/g, ''))) >= 10000 }
}

function render(p: NonNullable<ReturnType<typeof parse>>, v: number) {
  const n = p.grouped
    ? v.toLocaleString('en-US', { minimumFractionDigits: p.decimals, maximumFractionDigits: p.decimals })
    : v.toFixed(p.decimals)
  return `${p.before}${n}${p.after}`
}

// Hidden or rewritten states must start inside a GSAP tick: if frames never run, the content stays as rendered.
export function onTick(fn: () => void): () => void {
  const call = gsap.delayedCall(0, fn)
  return () => { call.kill() }
}

export function CountText({ text, fromZero = false, duration = 0.9, className }: { text: string; fromZero?: boolean; duration?: number; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null)
  const shown = useRef<number | null>(null)

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    el.textContent = text
    const p = parse(text)
    const from = shown.current
    shown.current = p ? p.value : null
    if (!p || reducedMotion() || (from === null && !fromZero) || from === p.value) return
    const run = (start: number) => {
      const o = { v: start }
      return gsap.to(o, { v: p.value, duration, ease: 'power2.out', onUpdate: () => { el.textContent = render(p, o.v) }, onComplete: () => { el.textContent = text } })
    }
    if (from !== null) {
      const t = run(from)
      return () => { t.kill(); el.textContent = text }
    }
    let tween: gsap.core.Tween | null = null
    const io = new IntersectionObserver((entries) => {
      if (!entries.some((e) => e.isIntersecting)) return
      io.disconnect()
      tween = run(0)
    }, { threshold: 0.4 })
    io.observe(el)
    return () => { io.disconnect(); tween?.kill(); el.textContent = text }
  }, [text, fromZero, duration])

  return <span ref={ref} className={className} />
}
