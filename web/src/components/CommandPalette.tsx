import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { zeroAddress } from 'viem'
import { useAegis } from '../lib/source'
import { useChainEvents, useLedger } from '../lib/queries'
import { flatten, moveActive, searchPalette, type PaletteItem } from '../lib/palette'
import { closeOverlay, openOverlay, useOverlay } from '../lib/ui'
import { shortHex, stamp } from '../lib/format'
import { explorerAddress, explorerTx } from '../lib/wallet'
import { isRecordedTx } from '../replay/hashes'
import { sentenceCase } from '../lib/vocabulary'
import { GLOSSARY } from './Glossary'
import { Icon, type IconName } from './icons'
import { useVisiblePages } from './chrome'
import { ExitPanel } from './Exit'
import { useOrders } from '../lib/tradeflow/queries'
import { heldCount, ORDER_LABEL, orderDisplay } from '../lib/tradeflow/state'
import { toast } from '../lib/toast'
import type { WorkflowState } from '../lib/types'

const PAGE_HINT: Record<string, string> = {
  '/treasury': 'Balances, reserve, obligations and positions',
  '/copilot': 'Ask the agent, approve or deny deposits',
  '/risk': 'Oracle, vault risk and exit triggers',
  '/audit': 'Decision ledger, on-chain events, evidence',
  '/bank': 'Clients, freezes and escalations',
  '/orders': 'Trade orders, milestones, proofs and holds',
}

const GROUP_ICON: Record<PaletteItem['group'], IconName> = {
  Pages: 'page', Actions: 'keyboard', Treasury: 'safe', Orders: 'orders', Ledger: 'ledger', Transactions: 'tx', Terms: 'terms',
}

function usePaletteItems(enabled: boolean): PaletteItem[] {
  const { deployment, chainId, mode } = useAegis()
  const ledger = useLedger()
  const events = useChainEvents()
  const pages = useVisiblePages()
  const orders = useOrders()
  return useMemo(() => {
    if (!enabled) return []
    const items: PaletteItem[] = pages.map((p) => ({ id: `page-${p.to}`, group: 'Pages', title: p.label, hint: PAGE_HINT[p.to], target: { kind: 'route', to: p.to } }))
    items.push(
      { id: 'act-shortcuts', group: 'Actions', title: 'Keyboard shortcuts', hint: 'Press ? anywhere', keywords: 'keys help', target: { kind: 'action', action: 'shortcuts' } },
      { id: 'act-terms', group: 'Actions', title: 'What the terms mean', hint: 'Glossary', keywords: 'glossary definitions', target: { kind: 'action', action: 'terms' } },
    )
    const safe = deployment.safe
    if (safe && safe !== zeroAddress) {
      items.push({ id: 'safe-copy', group: 'Treasury', title: 'Copy the treasury Safe address', hint: shortHex(safe, 6, 4), keywords: `${safe} safe wallet address`, target: { kind: 'action', action: 'copy-safe' } })
      const href = explorerAddress(chainId, safe)
      if (href) items.push({ id: 'safe-explorer', group: 'Treasury', title: 'Open the treasury Safe on the block explorer', hint: shortHex(safe, 6, 4), keywords: `${safe} basescan`, target: { kind: 'external', href } })
    }
    for (const [name, addr] of [['Vault A', deployment.vaultA], ['Vault B', deployment.vaultB]] as const) {
      if (addr && addr !== zeroAddress) items.push({ id: `pos-${addr}`, group: 'Treasury', title: `${name} position`, hint: shortHex(addr, 6, 4), keywords: `${addr} vault erc4626 shares`, target: { kind: 'route', to: `/treasury#pos-${addr}` } })
    }
    for (const o of orders.data ?? []) {
      const held = heldCount(o)
      items.push({
        id: `order-${o.order.orderId}`, group: 'Orders', title: `Order ${o.order.orderId}: ${o.order.total.display} USDC`,
        hint: `${ORDER_LABEL[orderDisplay(o.order.status)]}${held ? ', held' : ''}, supplier ${shortHex(o.order.supplier, 6, 4)}`,
        keywords: `${o.order.supplier} trade escrow milestone ${held ? 'held' : ''}`, target: { kind: 'route', to: `/orders/${o.order.orderId}` },
      })
    }
    const rows = [...(ledger.data ?? [])].sort((a, b) => b.seq - a.seq)
    for (const r of rows) {
      items.push({
        id: `row-${r.seq}`, group: 'Ledger', title: `Row ${r.seq}: ${r.summary}`,
        hint: `${sentenceCase(r.state as WorkflowState)}, ${stamp(r.ts)}`,
        keywords: [r.revertReason, r.txHash, r.amount?.display, r.vault, r.kind].filter(Boolean).join(' '),
        target: { kind: 'route', to: `/audit#row-${r.seq}` },
      })
    }
    for (const e of [...(events.data ?? [])].sort((a, b) => b.blockNumber - a.blockNumber)) {
      if (mode === 'replay' && !isRecordedTx(e.txHash)) continue
      const href = explorerTx(chainId, e.txHash)
      items.push({
        id: `tx-${e.txHash}-${e.logIndex}`, group: 'Transactions', title: `${e.name} ${shortHex(e.txHash, 8, 6)}`,
        hint: `Block ${e.blockNumber}`, keywords: e.txHash,
        target: href ? { kind: 'external', href } : { kind: 'route', to: '/audit' },
      })
    }
    for (const g of GLOSSARY) items.push({ id: `term-${g.term}`, group: 'Terms', title: g.term, hint: g.def, target: { kind: 'term', term: g.term } })
    return items
  }, [enabled, pages, orders.data, deployment.safe, deployment.vaultA, deployment.vaultB, chainId, mode, ledger.data, events.data])
}

export function SearchField() {
  const mac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform)
  return (
    <button type="button" className="search-field" aria-haspopup="dialog" onClick={() => openOverlay({ kind: 'palette' })}>
      <Icon name="search" />
      <span className="search-placeholder">Search</span>
      <kbd className="search-kbd" aria-hidden="true">{mac ? '⌘K' : 'Ctrl K'}</kbd>
      <span className="sr-only">, shortcut / or {mac ? 'Command' : 'Control'} K</span>
    </button>
  )
}

export function CommandPalette() {
  const overlay = useOverlay()
  const open = overlay?.kind === 'palette'
  const ref = useRef<HTMLDialogElement>(null)
  const input = useRef<HTMLInputElement>(null)
  const list = useRef<HTMLDivElement>(null)
  const [q, setQ] = useState('')
  const [active, setActive] = useState(0)
  const navigate = useNavigate()
  const { deployment } = useAegis()
  const id = useId()
  const items = usePaletteItems(open)
  const sections = useMemo(() => searchPalette(items, q), [items, q])
  const flat = useMemo(() => flatten(sections), [sections])

  useLayoutEffect(() => {
    const d = ref.current
    if (!d) return
    if (open && !d.open) { setQ(''); setActive(0); d.showModal(); input.current?.focus() }
    if (!open && d.open) d.close()
  }, [open])

  useEffect(() => { setActive(0) }, [q])

  useEffect(() => {
    list.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' })
  }, [active])

  const run = (item: PaletteItem) => {
    const t = item.target
    if (t.kind === 'term') { openOverlay({ kind: 'glossary', term: t.term }); return }
    if (t.kind === 'action' && t.action === 'shortcuts') { openOverlay({ kind: 'shortcuts' }); return }
    if (t.kind === 'action' && t.action === 'terms') { openOverlay({ kind: 'glossary' }); return }
    closeOverlay()
    if (t.kind === 'route') {
      const [pathname, hash] = t.to.split('#')
      navigate({ pathname, hash: hash ? `#${hash}` : '' }, { state: hash ? { drawer: true } : undefined })
    } else if (t.kind === 'external') {
      window.open(t.href, '_blank', 'noopener,noreferrer')
    } else if (t.action === 'copy-safe') {
      navigator.clipboard.writeText(deployment.safe).then(
        () => toast({ tone: 'ok', title: 'Safe address copied', text: deployment.safe }, 4000),
        () => toast({ tone: 'refused', title: 'Could not copy', text: 'The browser blocked the clipboard.' }, 4000),
      )
    }
  }

  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => moveActive(a, 1, flat.length)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => moveActive(a, -1, flat.length)) }
    else if (e.key === 'Home' && e.ctrlKey) { e.preventDefault(); setActive(0) }
    else if (e.key === 'End' && e.ctrlKey) { e.preventDefault(); setActive(flat.length - 1) }
    else if (e.key === 'Enter') { e.preventDefault(); const it = flat[active]; if (it) run(it) }
  }

  const optId = (i: number) => `${id}-opt-${i}`
  let n = -1
  return (
    <dialog ref={ref} className="palette" aria-label="Search" onCancel={(e) => { e.preventDefault(); closeOverlay() }}
      onClick={(e) => { if (e.target === e.currentTarget) closeOverlay() }}>
      {open ? (
        <ExitPanel kind="palette" className="palette-panel">
          <div className="palette-input">
            <Icon name="search" />
            <input ref={input} type="text" role="combobox" aria-expanded="true" aria-controls={`${id}-list`} aria-autocomplete="list"
              aria-activedescendant={flat.length ? optId(active) : undefined} aria-label="Search Porthmos"
              placeholder="Search pages, ledger rows, transactions, terms" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={onKey}
              autoComplete="off" spellCheck={false} />
            <kbd className="palette-esc" aria-hidden="true">Esc</kbd>
          </div>
          <div className="palette-list" id={`${id}-list`} role="listbox" aria-label="Results" ref={list}>
            {sections.length ? sections.map((s) => (
              <div key={s.group} role="group" aria-labelledby={`${id}-${s.group}`} className="palette-group">
                <p className="palette-group-label" id={`${id}-${s.group}`} role="presentation">{s.group === 'Ledger' && !q ? 'Recent ledger rows' : s.group}</p>
                {s.items.map((it) => {
                  n += 1
                  const i = n
                  return (
                    <div key={it.id} id={optId(i)} role="option" aria-selected={i === active} className="palette-option"
                      onPointerMove={() => { if (active !== i) setActive(i) }} onClick={() => run(it)}>
                      <Icon name={GROUP_ICON[it.group]} />
                      <span className="palette-text">
                        <span className="palette-title">{it.title}</span>
                        {it.hint ? <span className="palette-hint">{it.hint}</span> : null}
                      </span>
                      {it.target.kind === 'external' ? <Icon name="external" className="palette-go" /> : <span className="palette-enter" aria-hidden="true">Enter</span>}
                    </div>
                  )
                })}
              </div>
            )) : <p className="palette-empty">No results for “{q}”. Try a row number, an amount, an error such as BadSignature, or a term.</p>}
          </div>
          <p className="palette-foot" aria-hidden="true"><kbd>↑</kbd><kbd>↓</kbd> to move <kbd>Enter</kbd> to open <kbd>Esc</kbd> to close</p>
        </ExitPanel>
      ) : null}
    </dialog>
  )
}
