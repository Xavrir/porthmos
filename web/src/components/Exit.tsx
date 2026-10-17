import { useLayoutEffect, useRef, type ReactNode, type RefObject } from 'react'
import { exitDialog, exitPopover, snapshotDialog, type ExitKind } from '../lib/ghost'

// A layout-effect cleanup runs while the unmounting DOM is still attached and painted, so it can be copied for the exit;
// the copy only plays if the node really left (StrictMode's rehearsal unmount keeps it attached).
function useExit(ref: RefObject<HTMLElement | null>, kind: ExitKind | 'popover') {
  useLayoutEffect(() => {
    const el = ref.current
    return () => {
      if (!el) return
      if (kind === 'popover') { exitPopover(el); return }
      const snap = snapshotDialog(el.closest('dialog'), kind)
      if (snap) queueMicrotask(() => { if (!el.isConnected) exitDialog(snap) })
    }
  }, [ref, kind])
}

export function ExitPanel({ kind, className, children }: { kind: ExitKind; className: string; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)
  useExit(ref, kind)
  return <div ref={ref} className={className}>{children}</div>
}

export function usePopoverExit(ref: RefObject<HTMLElement | null>) {
  useExit(ref, 'popover')
}
