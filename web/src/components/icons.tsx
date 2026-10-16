const PATHS = {
  treasury: 'M3.5 4.5h17v14h-17z M12 8.25a3.25 3.25 0 1 0 0 6.5a3.25 3.25 0 1 0 0-6.5z M6.5 18.5v2 M17.5 18.5v2',
  copilot: 'M4 4.5h16v11.5H10l-4 3.5v-3.5H4z M8 9h8 M8 12h5',
  risk: 'M12 3.5l9 16H3z M12 9.5v4.5 M12 16.5v0.5',
  audit: 'M5 3.5h14v17H5z M8.5 8h7 M8.5 12h7 M8.5 16h4',
  bank: 'M3 9.5L12 4l9 5.5 M3.5 20h17 M6 11.5v6 M10 11.5v6 M14 11.5v6 M18 11.5v6',
  overview: 'M10 6l-6 6l6 6 M4.5 12H20',
  terms: 'M3.5 5.5H10l2 2v12.5l-2-2H3.5z M20.5 5.5H14l-2 2v12.5l2-2h6.5z',
  menu: 'M4 7h16 M4 12h16 M4 17h16',
  close: 'M6 6l12 12 M18 6L6 18',
  start: 'M12 5v14 M5 12h14',
  chevrons: 'M8 9.5l4-4l4 4 M8 14.5l4 4l4-4',
  sun: 'M12 8.5a3.5 3.5 0 1 0 0 7a3.5 3.5 0 1 0 0-7z M12 2.5v2.5 M12 19v2.5 M2.5 12H5 M19 12h2.5 M5.3 5.3l1.8 1.8 M16.9 16.9l1.8 1.8 M5.3 18.7l1.8-1.8 M16.9 7.1l1.8-1.8',
  moon: 'M19.5 14.5A8 8 0 0 1 9.5 4.5a8 8 0 1 0 10 10z',
  system: 'M3.5 5h17v11h-17z M9 20h6 M12 16v4',
  external: 'M14 4.5h5.5V10 M19.5 4.5L11 13 M17 13.5v6H4.5V7h6',
  info: 'M12 3.5a8.5 8.5 0 1 0 0 17a8.5 8.5 0 1 0 0-17z M12 11v5.5 M12 7.5v1',
  check: 'M5 12.5l4.5 4.5L19 7.5',
  alert: 'M12 3.5l9 16H3z M12 9.5v4.5 M12 16.5v0.5',
  search: 'M10.5 4.5a6 6 0 1 0 0 12a6 6 0 1 0 0-12z M15 15l5 5',
  copy: 'M8.5 8.5h11v11h-11z M15.5 8.5V4.5h-11v11h4',
  more: 'M5 12h0.01 M12 12h0.01 M19 12h0.01',
  plus: 'M12 5v14 M5 12h14',
  clear: 'M12 3.5a8.5 8.5 0 1 0 0 17a8.5 8.5 0 1 0 0-17z M9 9l6 6 M15 9l-6 6',
  add: 'M12 3.5a8.5 8.5 0 1 0 0 17a8.5 8.5 0 1 0 0-17z M12 8.5v7 M8.5 12h7',
  left: 'M14.5 6l-6 6l6 6',
  right: 'M9.5 6l6 6l-6 6',
  keyboard: 'M3 6.5h18v11H3z M7 10h0.01 M10.5 10h0.01 M14 10h0.01 M17 10h0.01 M7.5 14h9',
  help: 'M12 3.5a8.5 8.5 0 1 0 0 17a8.5 8.5 0 1 0 0-17z M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-0.7 0.3-1 0.9-1 1.7v0.5 M12 16.5v0.5',
  orders: 'M4.5 4.5h15v15h-15z M4.5 9.5h15 M9 13.5h6 M9 16.5h4',
  up: 'M12 19V5 M6 11l6-6l6 6',
  down: 'M12 5v14 M6 13l6 6l6-6',
  page: 'M6 3.5h8l4 4v13H6z M14 3.5v4h4',
  ledger: 'M4 6.5h16 M4 12h16 M4 17.5h10',
  tx: 'M4 8.5h14l-3.5-3.5 M20 15.5H6l3.5 3.5',
  safe: 'M4 5.5h16v13H4z M8 9.5h3v5H8z M15 12h2',
  clock: 'M12 3.5a8.5 8.5 0 1 0 0 17a8.5 8.5 0 1 0 0-17z M12 7.5V12l3 2',
  lock: 'M6 10.5h12v9H6z M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5',
  stop: 'M12 3.5a8.5 8.5 0 1 0 0 17a8.5 8.5 0 1 0 0-17z M8 8l8 8',
} as const

export type IconName = keyof typeof PATHS

export function Icon({ name, className }: { name: IconName; className?: string }) {
  return (
    <svg className={`icon${className ? ` ${className}` : ''}`} viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap={name === 'more' ? 'round' : 'square'} strokeLinejoin="miter" aria-hidden="true" focusable="false">
      <path d={PATHS[name]} strokeWidth={name === 'more' ? 2.75 : undefined} />
    </svg>
  )
}
