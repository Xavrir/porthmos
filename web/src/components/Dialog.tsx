import { useLayoutEffect, useRef, type ReactNode } from 'react'
import { ExitPanel } from './Exit'

export function Dialog({ open, onClose, labelledBy, className, children }: { open: boolean; onClose: () => void; labelledBy: string; className?: string; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null)

  useLayoutEffect(() => {
    const d = ref.current
    if (!d) return
    if (open && !d.open) d.showModal()
    if (!open && d.open) d.close()
  }, [open])

  return (
    <dialog
      ref={ref}
      className={`dialog${className ? ` ${className}` : ''}`}
      aria-labelledby={labelledBy}
      onCancel={(e) => { e.preventDefault(); onClose() }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      {open ? <ExitPanel kind="dialog" className="motion-contents">{children}</ExitPanel> : null}
    </dialog>
  )
}
