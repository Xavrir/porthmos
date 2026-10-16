import { useSyncExternalStore } from 'react'

export type Overlay = { kind: 'palette' } | { kind: 'shortcuts' } | { kind: 'glossary'; term?: string } | null

let overlay: Overlay = null
let opener: HTMLElement | null = null
const listeners = new Set<() => void>()

function emit() {
  for (const l of listeners) l()
}

export function openOverlay(next: Exclude<Overlay, null>) {
  if (!overlay) opener = document.activeElement instanceof HTMLElement ? document.activeElement : null
  overlay = next
  emit()
}

export function closeOverlay() {
  if (!overlay) return
  overlay = null
  emit()
  const back = opener
  opener = null
  if (back && back.isConnected) requestAnimationFrame(() => back.focus({ preventScroll: true }))
}

function subscribe(cb: () => void) {
  listeners.add(cb)
  return () => { listeners.delete(cb) }
}

export function useOverlay(): Overlay {
  return useSyncExternalStore(subscribe, () => overlay, () => null)
}
