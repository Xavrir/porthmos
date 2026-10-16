import { useId, useMemo, useState, type MouseEvent, type ReactNode, type Ref } from 'react'
import { countByStatus, filterRows, paginate } from '../lib/table'
import { Icon } from './icons'
import { MenuButton, type MenuItem } from './Menu'

export type Column<T> = {
  key: string
  header: ReactNode
  cell: (row: T) => ReactNode
  align?: 'right'
  className?: string
  primary?: boolean
  label?: string
  hideNarrow?: boolean
}

export type StatusFilter<T> = { label: string; get: (row: T) => string; options: { value: string; label: string }[] }

export type DataTableProps<T> = {
  label: string
  rows: readonly T[]
  columns: Column<T>[]
  rowKey: (row: T) => string
  rowName?: (row: T) => string
  onOpen?: (row: T) => void
  selectedKey?: string | null
  status?: StatusFilter<T>
  statusValue?: string | null
  onStatusChange?: (v: string | null) => void
  searchText?: (row: T) => string
  searchLabel?: string
  chips?: ReactNode
  onClearAll?: () => void
  rowMenu?: (row: T) => MenuItem[]
  pageSize?: number
  empty?: ReactNode
  tall?: boolean
  className?: string
  rowAttrs?: (row: T) => Record<string, string | number | undefined>
  bodyRef?: Ref<HTMLTableSectionElement>
  caption?: ReactNode
}

const INTERACTIVE = 'a, button, input, select, textarea, summary, [role="menu"], [role="note"]'

export function DataTable<T>(p: DataTableProps<T>) {
  const [ownStatus, setOwnStatus] = useState<string | null>(null)
  const status = p.statusValue !== undefined ? p.statusValue : ownStatus
  const setStatus = (v: string | null) => { setPage(0); if (p.onStatusChange) p.onStatusChange(v); else setOwnStatus(v) }
  const [text, setText] = useState('')
  const [page, setPage] = useState(0)
  const searchId = useId()
  const size = p.pageSize ?? 20

  const counts = useMemo(() => (p.status ? countByStatus(p.rows, p.status.get) : {}), [p.rows, p.status])
  const filtered = useMemo(
    () => filterRows(p.rows, { text, status }, { text: p.searchText ?? (() => ''), status: p.status?.get }),
    [p.rows, text, status, p.searchText, p.status],
  )
  const pg = paginate(filtered, page, size)
  const active = !!status || !!text.trim() || !!p.chips
  const statusLabel = p.status?.options.find((o) => o.value === status)?.label

  const onRow = (e: MouseEvent<HTMLTableRowElement>, row: T) => {
    if (!p.onOpen) return
    if ((e.target as HTMLElement).closest(INTERACTIVE)) return
    if (window.getSelection()?.toString()) return
    p.onOpen(row)
  }

  return (
    <div className={`dt${p.className ? ` ${p.className}` : ''}`}>
      {p.status || p.searchText ? (
        <div className="dt-toolbar">
          <div className="dt-chips" role="group" aria-label={`Filter ${p.label.toLowerCase()}`}>
            {p.status ? (
              status ? (
                <span className="fchip is-on">
                  <button type="button" className="fchip-x" onClick={() => setStatus(null)} aria-label={`Clear ${p.status.label.toLowerCase()} filter`}><Icon name="clear" /></button>
                  <MenuButton buttonClass="fchip-main" align="start" radio
                    items={p.status.options.map((o) => ({ key: o.value, label: o.label, checked: o.value === status, meta: counts[o.value] ?? 0, onSelect: () => setStatus(o.value) }))}>
                    {p.status.label}<span className="fchip-sep" aria-hidden="true" /><span className="fchip-value">{statusLabel}</span>
                  </MenuButton>
                </span>
              ) : (
                <span className="fchip">
                  <MenuButton buttonClass="fchip-main" align="start" radio
                    items={p.status.options.map((o) => ({ key: o.value, label: o.label, meta: counts[o.value] ?? 0, onSelect: () => setStatus(o.value) }))}>
                    <Icon name="add" />{p.status.label}
                  </MenuButton>
                </span>
              )
            ) : null}
            {p.chips}
            {active ? <button type="button" className="dt-clear" onClick={() => { setStatus(null); setText(''); p.onClearAll?.() }}>Clear filters</button> : null}
          </div>
          {p.searchText ? (
            <div className="dt-search">
              <Icon name="search" />
              <label htmlFor={searchId} className="sr-only">Search {p.label.toLowerCase()}</label>
              <input id={searchId} type="search" className="dt-search-input" placeholder={p.searchLabel ?? 'Search'} value={text} onChange={(e) => { setText(e.target.value); setPage(0) }} />
            </div>
          ) : null}
        </div>
      ) : null}
      {filtered.length ? (
        <>
          <div className={`dt-scroll${p.tall ? ' is-tall' : ''}`}>
            <table className="dt-table">
              {p.caption ? <caption className="sr-only">{p.caption}</caption> : <caption className="sr-only">{p.label}</caption>}
              <thead>
                <tr>
                  {p.columns.map((c) => (
                    <th key={c.key} scope="col" className={`${c.align === 'right' ? 'r' : ''}${c.hideNarrow ? ' hide-narrow' : ''}`}>{c.header}</th>
                  ))}
                  {p.rowMenu ? <th scope="col" className="dt-menu-col"><span className="sr-only">Actions</span></th> : null}
                </tr>
              </thead>
              <tbody ref={p.bodyRef}>
                {pg.rows.map((row) => {
                  const key = p.rowKey(row)
                  const name = p.rowName?.(row) ?? key
                  return (
                    <tr key={key} {...(p.rowAttrs?.(row) ?? {})} className={`${p.onOpen ? 'is-clickable' : ''}${p.selectedKey === key ? ' is-selected' : ''}`} onClick={(e) => onRow(e, row)}>
                      {p.columns.map((c) => (
                        <td key={c.key} data-label={c.label ?? (typeof c.header === 'string' ? c.header : undefined)}
                          className={`${c.align === 'right' ? 'r' : ''}${c.primary ? ' dt-primary' : ''}${c.hideNarrow ? ' hide-narrow' : ''}${c.className ? ` ${c.className}` : ''}`}>
                          {c.primary && p.onOpen ? (
                            <button type="button" className="dt-open" onClick={(e) => { e.stopPropagation(); p.onOpen!(row) }} aria-haspopup="dialog">
                              {c.cell(row)}
                            </button>
                          ) : c.cell(row)}
                        </td>
                      ))}
                      {p.rowMenu ? (
                        <td className="dt-menu-col">
                          <MenuButton buttonClass="icon-button dt-more" buttonLabel={`Actions for ${name}`} items={p.rowMenu(row)}><Icon name="more" /></MenuButton>
                        </td>
                      ) : null}
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <div className="dt-foot">
            <p className="dt-count nums" aria-live="polite">{pg.total === p.rows.length && !active ? `${pg.total} result${pg.total === 1 ? '' : 's'}` : `${pg.total} of ${p.rows.length} match`}{pg.pages > 1 ? `. Viewing ${pg.from} to ${pg.to}` : ''}</p>
            {pg.pages > 1 ? (
              <div className="dt-pager">
                <button type="button" className="button small quiet" disabled={pg.page === 0} onClick={() => setPage(pg.page - 1)}>Previous</button>
                <button type="button" className="button small quiet" disabled={pg.page >= pg.pages - 1} onClick={() => setPage(pg.page + 1)}>Next</button>
              </div>
            ) : null}
          </div>
        </>
      ) : (
        <div className="dt-empty">
          <p>{active ? 'No rows match these filters.' : p.empty ?? 'Nothing here yet.'}</p>
          {active ? <button type="button" className="dt-clear" onClick={() => { setStatus(null); setText(''); p.onClearAll?.() }}>Clear filters</button> : null}
        </div>
      )}
    </div>
  )
}
