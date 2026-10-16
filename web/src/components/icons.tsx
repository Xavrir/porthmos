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
} as const

export type IconName = keyof typeof PATHS

export function Icon({ name, className }: { name: IconName; className?: string }) {
  return (
    <svg className={`icon${className ? ` ${className}` : ''}`} viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="square" strokeLinejoin="miter" aria-hidden="true" focusable="false">
      <path d={PATHS[name]} />
    </svg>
  )
}
