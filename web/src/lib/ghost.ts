import { CSS_EXIT, DUR, reducedMotion } from './motion'

// Exit animations play on an inert copy, so the real element (a dialog, a menu, the old page) is gone at once:
// focus, the top layer and anything waiting for it to close never wait for the animation.

function inertCopy<T extends Element>(el: T): T {
  const c = el.cloneNode(true) as T
  c.removeAttribute('id')
  for (const n of c.querySelectorAll('[id]')) n.removeAttribute('id')
  for (const n of c.querySelectorAll('dialog')) n.remove()
  c.setAttribute('aria-hidden', 'true')
  if (c instanceof HTMLElement) c.inert = true
  c.classList.add('motion-ghost')
  return c
}

function play(el: HTMLElement, keyframes: Keyframe[], duration: number, easing = CSS_EXIT) {
  const done = () => el.remove()
  if (typeof el.animate !== 'function') { done(); return }
  const a = el.animate(keyframes, { duration, easing, fill: 'forwards' })
  a.finished.then(done, done)
  setTimeout(done, duration + 200)
}

export type ExitKind = 'drawer' | 'dialog' | 'palette'

const EXIT_FRAMES: Record<ExitKind, Keyframe[]> = {
  drawer: [{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'translateX(24px)' }],
  dialog: [{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'scale(0.98)' }],
  palette: [{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'scale(0.98)' }],
}

type Snapshot = { kind: ExitKind; rect: DOMRect; className: string; body: Node[] }

/** Taken while the dialog is still open and painted; `exitDialog` animates it after the real dialog closed. */
export function snapshotDialog(dialog: HTMLDialogElement | null, kind: ExitKind): Snapshot | null {
  if (!dialog || !dialog.open || reducedMotion() || !dialog.closest('.app')) return null
  const rect = dialog.getBoundingClientRect()
  if (!rect.width || !rect.height) return null
  return { kind, rect, className: dialog.className, body: Array.from(dialog.childNodes, (n) => (n instanceof Element ? inertCopy(n) : n.cloneNode(true))) }
}

export function exitDialog(s: Snapshot | null) {
  if (!s) return
  const scrim = document.createElement('div')
  scrim.className = 'motion-ghost motion-scrim'
  scrim.setAttribute('aria-hidden', 'true')
  const panel = document.createElement('div')
  panel.className = `${s.className} motion-ghost motion-panel`
  panel.setAttribute('aria-hidden', 'true')
  panel.inert = true
  const r = s.rect
  panel.style.cssText = `position:fixed;inset:auto;left:${r.left}px;top:${r.top}px;width:${r.width}px;height:${r.height}px;max-width:none;max-height:none;margin:0;z-index:1001;pointer-events:none;overflow:hidden;`
  panel.append(...s.body)
  document.body.append(scrim, panel)
  play(scrim, [{ opacity: 1 }, { opacity: 0 }], DUR.exit)
  play(panel, EXIT_FRAMES[s.kind], DUR.exit)
}

/** For portalled popovers such as menus: copies the element where it stands and fades it out. */
export function exitPopover(el: HTMLElement | null) {
  if (!el || !el.isConnected || reducedMotion()) return
  const copy = inertCopy(el)
  copy.style.pointerEvents = 'none'
  queueMicrotask(() => {
    if (el.isConnected) return
    document.body.append(copy)
    play(copy, [{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'translateY(-2px)' }], 100)
  })
}

/** Cross-fades the page: a copy of the current main content fades out over the next page as it enters. */
export function exitPage() {
  const main = document.querySelector<HTMLElement>('main#main')
  const host = main?.closest<HTMLElement>('.app-main')
  if (!main || !host || reducedMotion()) return
  const top = host.querySelector<HTMLElement>('.top-bar')?.getBoundingClientRect().bottom ?? 0
  const r = main.getBoundingClientRect()
  const viewTop = Math.max(r.top, top)
  const visible = Math.max(0, Math.min(r.bottom, window.innerHeight) - viewTop)
  if (!visible || !r.width) return
  const copy = inertCopy(main)
  copy.style.cssText = `position:absolute;left:0;top:${r.top - viewTop}px;width:${r.width}px;margin:0;`
  const ghost = document.createElement('div')
  ghost.className = 'motion-ghost motion-page'
  ghost.setAttribute('aria-hidden', 'true')
  ghost.inert = true
  ghost.style.cssText = `position:absolute;left:0;top:0;width:${r.width}px;height:${visible}px;overflow:hidden;pointer-events:none;z-index:10;`
  ghost.append(copy)
  host.append(ghost)
  // placed against whatever its containing block turns out to be, and re-pinned every frame: the next route
  // scrolls the window to the top, and the copy must stay where it was on screen until it has faded
  const base = () => (ghost.offsetParent ?? document.documentElement).getBoundingClientRect()
  let frame = 0
  const pin = () => {
    if (!ghost.isConnected) return
    const b = base()
    ghost.style.left = `${r.left - b.left}px`
    ghost.style.top = `${viewTop - b.top}px`
    frame = requestAnimationFrame(pin)
  }
  pin()
  play(ghost, [{ opacity: 1 }, { opacity: 0 }], DUR.exit)
  setTimeout(() => cancelAnimationFrame(frame), DUR.exit + 250)
}

function pathOf(url: string | URL | null | undefined): string | null {
  if (url === null || url === undefined) return null
  try { return new URL(String(url), window.location.href).pathname } catch { return null }
}

/** Watches history so every route change (links, navigate(), back and forward) cross-fades; hash-only changes do not. */
export function installRouteFade(): () => void {
  if (typeof window === 'undefined') return () => {}
  const h = window.history
  const push = h.pushState
  const replace = h.replaceState
  let shown = window.location.pathname
  const wrap = (fn: History['pushState']): History['pushState'] => function (this: History, data, unused, url) {
    const next = pathOf(url)
    if (next !== null && next !== shown) exitPage()
    fn.call(this, data, unused, url)
    shown = window.location.pathname
  }
  // popstate fires after the URL changed but before React renders the new route, so the old page is still on screen
  const onPop = () => {
    if (window.location.pathname !== shown) exitPage()
    shown = window.location.pathname
  }
  h.pushState = wrap(push)
  h.replaceState = wrap(replace)
  window.addEventListener('popstate', onPop, true)
  return () => {
    h.pushState = push
    h.replaceState = replace
    window.removeEventListener('popstate', onPop, true)
  }
}
