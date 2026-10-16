import { useEffect, useId, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { readShortcut, SHORTCUTS } from '../lib/shortcuts'
import { closeOverlay, openOverlay, useOverlay } from '../lib/ui'
import { Dialog } from './Dialog'
import { GlossaryList } from './Glossary'

function typingIn(el: Element | null): boolean {
  if (!(el instanceof HTMLElement)) return false
  return el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)
}

export function useGlobalShortcuts() {
  const navigate = useNavigate()
  const pending = useRef<number | null>(null)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.isComposing) return
      const modal = document.querySelector('dialog[open]')
      const paletteOpen = modal?.classList.contains('palette')
      const r = readShortcut(e, pending.current, e.timeStamp, typingIn(document.activeElement))
      if (!r) { pending.current = null; return }
      if (r.kind === 'palette') {
        if (modal && !paletteOpen) return
        e.preventDefault()
        if (paletteOpen) closeOverlay()
        else openOverlay({ kind: 'palette' })
        return
      }
      if (modal) return
      if (r.kind === 'pending') { pending.current = e.timeStamp; return }
      pending.current = null
      e.preventDefault()
      if (r.kind === 'help') openOverlay({ kind: 'shortcuts' })
      else navigate(r.to)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [navigate])
}

export function ShortcutsDialog() {
  const overlay = useOverlay()
  const id = useId()
  return (
    <Dialog open={overlay?.kind === 'shortcuts'} onClose={closeOverlay} labelledBy={id} className="dialog-shortcuts">
      <div className="dialog-body">
        <div className="dialog-head">
          <h2 id={id}>Keyboard shortcuts</h2>
          <button type="button" className="button small quiet" onClick={closeOverlay}>Close</button>
        </div>
        <dl className="shortcut-list">
          {SHORTCUTS.map((s) => (
            <div key={s.what}>
              <dt>{s.what}</dt>
              <dd>{s.keys.map((k, i) => <span key={k}>{i ? <span className="kbd-then">{s.keys[0] === 'g' ? 'then' : '+'}</span> : null}<kbd>{k}</kbd></span>)}</dd>
            </div>
          ))}
        </dl>
        <p className="muted small-print">Letter shortcuts pause while you type in a field. Ctrl K (Cmd K on a Mac) works everywhere.</p>
      </div>
    </Dialog>
  )
}

export function GlossaryDialog() {
  const overlay = useOverlay()
  const id = useId()
  const open = overlay?.kind === 'glossary'
  const term = open ? overlay.term : undefined
  return (
    <Dialog open={open} onClose={closeOverlay} labelledBy={id} className="dialog-glossary">
      <div className="dialog-body">
        <div className="dialog-head">
          <h2 id={id}>What the terms mean</h2>
          <button type="button" className="button small quiet" onClick={closeOverlay}>Close</button>
        </div>
        <GlossaryList highlight={term} />
      </div>
    </Dialog>
  )
}
