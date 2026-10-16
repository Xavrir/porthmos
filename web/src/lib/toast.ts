import { useSyncExternalStore } from 'react'

export type ToastTone = 'ok' | 'refused' | 'info'

export type Toast = { id: number; tone: ToastTone; title: string; text?: string; href?: string; linkLabel?: string }

let toasts: Toast[] = []
let next = 1
const listeners = new Set<() => void>()

function emit() {
  for (const l of listeners) l()
}

export function dismissToast(id: number) {
  toasts = toasts.filter((t) => t.id !== id)
  emit()
}

export function toast(t: Omit<Toast, 'id'>, ttl = 9000) {
  const id = next++
  toasts = [{ ...t, id }, ...toasts].slice(0, 4)
  emit()
  if (ttl > 0) setTimeout(() => dismissToast(id), ttl)
  return id
}

function subscribe(cb: () => void) {
  listeners.add(cb)
  return () => { listeners.delete(cb) }
}

export function useToasts(): Toast[] {
  return useSyncExternalStore(subscribe, () => toasts, () => toasts)
}
