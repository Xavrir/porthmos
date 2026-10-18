import { reducedMotion } from './motion'

// Panels that light their edge where the cursor is; web3.css reads --mx and --my.
const PANELS = '.card, .kpi, .sec:has(> .dt, > .table-wrap), .ms-card, .decision, .limit, .attack'

/** Tracks the pointer and writes its position, relative to the panel under it, as --mx and --my. One write per frame. */
export function installSpotlight(): () => void {
  if (typeof window === 'undefined' || reducedMotion() || !window.matchMedia('(hover: hover) and (pointer: fine)').matches) return () => {}
  let frame = 0
  let last: PointerEvent | null = null
  const paint = () => {
    frame = 0
    const target = last?.target
    if (!last || !(target instanceof Element)) return
    const panel = target.closest<HTMLElement>(PANELS)
    if (!panel) return
    const r = panel.getBoundingClientRect()
    panel.style.setProperty('--mx', `${Math.round(last.clientX - r.left)}px`)
    panel.style.setProperty('--my', `${Math.round(last.clientY - r.top)}px`)
  }
  const onMove = (e: PointerEvent) => {
    last = e
    if (!frame) frame = requestAnimationFrame(paint)
  }
  document.addEventListener('pointermove', onMove, { passive: true })
  return () => {
    document.removeEventListener('pointermove', onMove)
    cancelAnimationFrame(frame)
  }
}
