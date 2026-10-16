import { createPortal } from 'react-dom'
import { useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from 'react'

export type MenuItem = { key: string; label: ReactNode; onSelect: () => void; checked?: boolean; danger?: boolean; disabled?: boolean; meta?: ReactNode }

export function MenuButton({ items, buttonClass, buttonLabel, children, align = 'end', radio = false }: {
  items: MenuItem[]
  buttonClass: string
  buttonLabel?: string
  children: ReactNode
  align?: 'start' | 'end'
  radio?: boolean
}) {
  const [open, setOpen] = useState(false)
  const [style, setStyle] = useState<CSSProperties>({ position: 'fixed', top: 0, left: 0, visibility: 'hidden' })
  const btn = useRef<HTMLButtonElement>(null)
  const menu = useRef<HTMLDivElement>(null)
  const id = useId()

  const close = (refocus: boolean) => {
    setOpen(false)
    if (refocus) btn.current?.focus()
  }

  useLayoutEffect(() => {
    if (!open || !btn.current) return
    const r = btn.current.getBoundingClientRect()
    const below = window.innerHeight - r.bottom
    const vertical: CSSProperties = below < 240 && r.top > below ? { bottom: window.innerHeight - r.top + 4 } : { top: r.bottom + 4 }
    const horizontal: CSSProperties = align === 'end' ? { right: Math.max(8, window.innerWidth - r.right) } : { left: Math.max(8, r.left) }
    setStyle({ position: 'fixed', ...vertical, ...horizontal })
    const first = menu.current?.querySelector<HTMLElement>('[role^="menuitem"]:not([aria-disabled="true"])')
    first?.focus({ preventScroll: true })
  }, [open, align])

  useEffect(() => {
    if (!open) return
    const onDoc = (e: PointerEvent) => {
      const t = e.target as Node
      if (!menu.current?.contains(t) && !btn.current?.contains(t)) close(false)
    }
    const onMove = (e: Event) => { if (!menu.current?.contains(e.target as Node)) close(false) }
    document.addEventListener('pointerdown', onDoc)
    window.addEventListener('scroll', onMove, true)
    window.addEventListener('resize', onMove)
    return () => {
      document.removeEventListener('pointerdown', onDoc)
      window.removeEventListener('scroll', onMove, true)
      window.removeEventListener('resize', onMove)
    }
  }, [open])

  const onKey = (e: KeyboardEvent) => {
    const list = Array.from(menu.current?.querySelectorAll<HTMLElement>('[role^="menuitem"]:not([aria-disabled="true"])') ?? [])
    const i = list.indexOf(document.activeElement as HTMLElement)
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(true) }
    else if (e.key === 'Tab') close(false)
    else if (e.key === 'ArrowDown') { e.preventDefault(); list[(i + 1) % list.length]?.focus({ preventScroll: true }) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); list[(i - 1 + list.length) % list.length]?.focus({ preventScroll: true }) }
    else if (e.key === 'Home') { e.preventDefault(); list[0]?.focus({ preventScroll: true }) }
    else if (e.key === 'End') { e.preventDefault(); list[list.length - 1]?.focus({ preventScroll: true }) }
  }

  return (
    <>
      <button ref={btn} type="button" className={buttonClass} aria-label={buttonLabel} aria-haspopup="menu" aria-expanded={open} aria-controls={open ? id : undefined}
        onClick={(e) => { e.stopPropagation(); setOpen((o) => !o) }}
        onKeyDown={(e) => { if (e.key === 'ArrowDown' && !open) { e.preventDefault(); setOpen(true) } }}>
        {children}
      </button>
      {open ? createPortal(
        <div ref={menu} id={id} role="menu" className="menu" style={style} onKeyDown={onKey} onClick={(e) => e.stopPropagation()}>
          {items.map((it) => (
            <button key={it.key} type="button" role={radio ? 'menuitemradio' : 'menuitem'} aria-checked={radio ? !!it.checked : undefined}
              aria-disabled={it.disabled || undefined} tabIndex={-1}
              className={`menu-item${it.danger ? ' is-danger' : ''}${it.checked ? ' is-checked' : ''}`}
              onClick={() => { if (it.disabled) return; close(true); it.onSelect() }}>
              <span className="menu-label">{it.label}</span>
              {it.meta !== undefined ? <span className="menu-meta nums">{it.meta}</span> : null}
            </button>
          ))}
        </div>,
        document.body,
      ) : null}
    </>
  )
}
