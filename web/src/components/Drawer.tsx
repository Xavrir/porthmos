import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { Icon } from './icons'
import { ExitPanel } from './Exit'

export function useHashParam(prefix: string): [string | null, (id: string) => void, () => void] {
  const location = useLocation()
  const navigate = useNavigate()
  const tag = `#${prefix}-`
  const value = location.hash.startsWith(tag) ? decodeURIComponent(location.hash.slice(tag.length)) : null
  const fromDrawer = (location.state as { drawer?: boolean } | null)?.drawer === true
  const open = useCallback((id: string) => {
    navigate({ pathname: location.pathname, search: location.search, hash: `${prefix}-${encodeURIComponent(id)}` }, { state: { drawer: true }, replace: value !== null && fromDrawer })
  }, [navigate, location.pathname, location.search, prefix, value, fromDrawer])
  const close = useCallback(() => {
    if (fromDrawer) navigate(-1)
    else navigate({ pathname: location.pathname, search: location.search, hash: '' }, { replace: true })
  }, [navigate, fromDrawer, location.pathname, location.search])
  return [value, open, close]
}

export function DetailDrawer({ open, onClose, eyebrow, title, badge, amount, actions, children }: {
  open: boolean
  onClose: () => void
  eyebrow?: ReactNode
  title: ReactNode
  badge?: ReactNode
  amount?: ReactNode
  actions?: ReactNode
  children: ReactNode
}) {
  const ref = useRef<HTMLDialogElement>(null)
  const headRef = useRef<HTMLHeadingElement>(null)
  const back = useRef<HTMLElement | null>(null)
  const id = useId()

  // layout effect: the dialog must close before paint, while its exit copy (ExitPanel) is already on screen
  useLayoutEffect(() => {
    const d = ref.current
    if (!d) return
    if (open && !d.open) {
      back.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
      d.showModal()
      headRef.current?.focus({ preventScroll: true })
    }
    if (!open && d.open) {
      d.close()
      const el = back.current
      back.current = null
      if (el?.isConnected) el.focus({ preventScroll: true })
    }
  }, [open])

  useEffect(() => () => { if (ref.current?.open) ref.current.close() }, [])

  return (
    <dialog
      ref={ref}
      className="drawer"
      aria-labelledby={id}
      onCancel={(e) => { e.preventDefault(); onClose() }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      {open ? (
        <ExitPanel kind="drawer" className="drawer-panel">
          <header className="drawer-head">
            <div className="drawer-top">
              {eyebrow ? <p className="drawer-eyebrow">{eyebrow}</p> : <span />}
              <button type="button" className="icon-button" onClick={onClose} aria-label="Close details"><Icon name="close" /></button>
            </div>
            <div className="drawer-title-row">
              <h2 id={id} ref={headRef} tabIndex={-1}>{title}</h2>
              {badge}
            </div>
            {amount ? <p className="drawer-amount nums">{amount}</p> : null}
            {actions ? <div className="drawer-actions">{actions}</div> : null}
          </header>
          <div className="drawer-body">{children}</div>
        </ExitPanel>
      ) : null}
    </dialog>
  )
}

export function DrawerSection({ title, children, aside }: { title: string; children: ReactNode; aside?: ReactNode }) {
  const id = useId()
  return (
    <section className="drawer-section" aria-labelledby={id}>
      <div className="drawer-section-head"><h3 id={id}>{title}</h3>{aside}</div>
      {children}
    </section>
  )
}

export type KeyValue = { label: string; value: ReactNode }

export function KeyValues({ items }: { items: (KeyValue | null | false | undefined)[] }) {
  return (
    <dl className="kv">
      {items.filter((x): x is KeyValue => !!x).map((x) => (
        <div key={x.label}><dt>{x.label}</dt><dd>{x.value}</dd></div>
      ))}
    </dl>
  )
}

export type TimelineItem = { key: string; title: ReactNode; time?: ReactNode; note?: ReactNode; tone?: 'ok' | 'held' | 'refused' | 'info' | 'neutral' }

export function Timeline({ items }: { items: TimelineItem[] }) {
  return (
    <ol className="timeline">
      {items.map((it) => (
        <li key={it.key} className={`tl-item tl-${it.tone ?? 'neutral'}`}>
          <span className="tl-dot" aria-hidden="true" />
          <div className="tl-body">
            <p className="tl-title">{it.title}</p>
            {it.note ? <p className="tl-note">{it.note}</p> : null}
            {it.time ? <p className="tl-time nums">{it.time}</p> : null}
          </div>
        </li>
      ))}
    </ol>
  )
}

export function CopyButton({ value, label, className = 'copy' }: { value: string; label: string; className?: string }) {
  const [copied, setCopied] = useState(false)
  useEffect(() => {
    if (!copied) return
    const t = setTimeout(() => setCopied(false), 1400)
    return () => clearTimeout(t)
  }, [copied])
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value)
      setCopied(true)
    } catch {
      setCopied(false)
    }
  }
  return (
    <button type="button" className={`${className}${copied ? ' is-copied' : ''}`} onClick={copy} aria-label={`Copy ${label}`} title={copied ? 'Copied' : `Copy ${label}`}>
      <Icon name={copied ? 'check' : 'copy'} />
      <span className="copy-tip" aria-live="polite">{copied ? 'Copied' : ''}</span>
    </button>
  )
}
