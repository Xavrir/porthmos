export type Loop = { stop: () => void }

export function rng(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export const prefersStill = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches

type Surface = { ctx: CanvasRenderingContext2D; w: number; h: number; dpr: number }

export function canvasLoop(
  canvas: HTMLCanvasElement,
  draw: (s: Surface, t: number, dt: number) => void,
  opts: { still: boolean; observe?: Element; alpha?: boolean; onVisible?: (visible: boolean) => void },
): Loop {
  const ctx = canvas.getContext('2d', { alpha: opts.alpha ?? false })
  if (!ctx) return { stop: () => undefined }
  const surface: Surface = { ctx, w: 0, h: 0, dpr: 1 }
  let raf = 0
  let last = 0
  let t = 0
  let onScreen = false
  let stopped = false

  const frame = (now: number) => {
    raf = 0
    if (stopped) return
    const dt = last ? Math.min(0.05, (now - last) / 1000) : 0
    last = now
    t += dt
    draw(surface, t, dt)
    if (!opts.still && onScreen && !document.hidden) raf = requestAnimationFrame(frame)
  }
  const kick = () => {
    if (stopped || raf) return
    last = 0
    raf = requestAnimationFrame(frame)
  }
  const resize = () => {
    const r = canvas.getBoundingClientRect()
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    const w = Math.max(1, Math.round(r.width))
    const h = Math.max(1, Math.round(r.height))
    if (w === surface.w && h === surface.h && dpr === surface.dpr) return
    surface.w = w
    surface.h = h
    surface.dpr = dpr
    canvas.width = Math.round(w * dpr)
    canvas.height = Math.round(h * dpr)
    if (opts.still || !onScreen) draw(surface, t, 0)
  }

  const ro = new ResizeObserver(resize)
  ro.observe(canvas)
  resize()

  const io = new IntersectionObserver((entries) => {
    for (const e of entries) {
      onScreen = e.isIntersecting
      opts.onVisible?.(onScreen)
      if (onScreen) kick()
    }
  })
  io.observe(opts.observe ?? canvas)
  const onVis = () => { if (!document.hidden && onScreen) kick() }
  document.addEventListener('visibilitychange', onVis)
  draw(surface, t, 0)

  return {
    stop: () => {
      stopped = true
      if (raf) cancelAnimationFrame(raf)
      ro.disconnect()
      io.disconnect()
      document.removeEventListener('visibilitychange', onVis)
    },
  }
}
