import type { ReactNode } from 'react'

const C = Math.cos(Math.PI / 6)
const S = 0.5

type P = [number, number, number]

function scene() {
  const xs: number[] = []
  const ys: number[] = []
  const pt = ([x, y, z]: P) => {
    const X = (x - y) * C
    const Y = (x + y) * S - z
    xs.push(X)
    ys.push(Y)
    return `${X.toFixed(1)},${Y.toFixed(1)}`
  }
  const poly = (ps: P[]) => `M${ps.map(pt).join('L')}Z`
  const line = (ps: P[]) => `M${ps.map(pt).join('L')}`
  const box = (x: number, y: number, z: number, w: number, d: number, h: number) => [
    poly([[x, y + d, z], [x + w, y + d, z], [x + w, y + d, z + h], [x, y + d, z + h]]),
    poly([[x + w, y, z], [x + w, y + d, z], [x + w, y + d, z + h], [x + w, y, z + h]]),
    poly([[x, y, z + h], [x + w, y, z + h], [x + w, y + d, z + h], [x, y + d, z + h]]),
  ]
  const floor = (x0: number, y0: number, n: number, step: number) => {
    const d: string[] = []
    for (let i = 0; i <= n; i++) {
      d.push(line([[x0 + i * step, y0, 0], [x0 + i * step, y0 + n * step, 0]]))
      d.push(line([[x0, y0 + i * step, 0], [x0 + n * step, y0 + i * step, 0]]))
    }
    return d.join('')
  }
  const bounds = (pad = 14) => {
    const x = Math.min(...xs) - pad
    const y = Math.min(...ys) - pad
    return { x, y, w: Math.max(...xs) + pad - x, h: Math.max(...ys) + pad - y }
  }
  return { pt, poly, line, box, floor, bounds }
}

type Scene = ReturnType<typeof scene>

function Paths({ d, keyed, className }: { d: string[]; keyed?: boolean; className?: string }) {
  return (
    <g className={className ?? (keyed ? 'pm-iso-key' : 'pm-iso-wire')}>
      {d.map((x, i) => <path key={i} d={x} pathLength={1} className={x.endsWith('Z') ? undefined : 'pm-open'} />)}
    </g>
  )
}

function Frame({ s, label, children, extra }: { s: Scene; label: string; children: ReactNode; extra?: (b: ReturnType<Scene['bounds']>) => ReactNode }) {
  const b = s.bounds()
  return (
    <svg className="pm-iso" viewBox={`${b.x.toFixed(1)} ${b.y.toFixed(1)} ${b.w.toFixed(1)} ${b.h.toFixed(1)}`} role="img" aria-label={label}>
      {extra?.(b)}
      {children}
    </svg>
  )
}

export function ArtLock() {
  const s = scene()
  const floor = s.floor(0, 0, 6, 26)
  const vault = s.box(26, 26, 0, 104, 104, 92)
  const door = s.line([[44, 130, 18], [112, 130, 18], [112, 130, 74], [44, 130, 74]]) + 'Z'
  const lock = s.box(58, 58, 92, 40, 40, 26)
  const shackle = `M${s.pt([66, 78, 118])}C${s.pt([66, 78, 150])} ${s.pt([90, 78, 150])} ${s.pt([90, 78, 118])}`
  return (
    <Frame s={s} label="A contract vault with a lock on top">
      <path className="pm-iso-floor" d={floor} />
      <Paths d={[...vault, door]} />
      <Paths d={[...lock, shackle]} keyed />
    </Frame>
  )
}

export function ArtShip() {
  const s = scene()
  const sea = [0, 1, 2, 3].map((i) => s.line([[-60, 20 + i * 30, 0], [230, 20 + i * 30, 0]])).join('')
  const hull = s.poly([[-20, 40, 0], [150, 40, 0], [190, 65, 10], [150, 90, 0], [-20, 90, 0]])
  const deck = s.poly([[-20, 40, 28], [150, 40, 28], [190, 65, 32], [150, 90, 28], [-20, 90, 28]])
  const posts = s.line([[-20, 90, 0], [-20, 90, 28]]) + s.line([[150, 90, 0], [150, 90, 28]]) + s.line([[190, 65, 10], [190, 65, 32]])
  const bridge = s.box(-10, 48, 28, 36, 34, 50)
  const c1 = s.box(34, 48, 28, 44, 34, 26)
  const c2 = s.box(34, 48, 54, 44, 34, 26)
  const key = s.box(82, 48, 28, 44, 34, 26)
  return (
    <Frame s={s} label="A ship carrying containers">
      <path className="pm-iso-floor" d={sea} />
      <Paths d={[hull, deck, posts, ...bridge, ...c1, ...c2]} />
      <Paths d={key} keyed />
    </Frame>
  )
}

export function ArtProof() {
  const s = scene()
  const floor = s.floor(-10, -10, 7, 26)
  const doc = s.box(30, 20, 0, 110, 140, 4)
  const text = [0, 1, 2, 3, 4].map((i) => s.line([[46, 36 + i * 16, 4], [i === 4 ? 92 : 124, 36 + i * 16, 4]])).join('')
  const seal = s.poly(Array.from({ length: 24 }, (_, i) => {
    const a = (i / 24) * Math.PI * 2
    return [104 + Math.cos(a) * 18, 124 + Math.sin(a) * 18, 4] as P
  }))
  const ribbon = s.line([[96, 140, 4], [90, 168, 4]]) + s.line([[112, 140, 4], [118, 168, 4]])
  return (
    <Frame s={s} label="A signed shipping document with a seal">
      <path className="pm-iso-floor" d={floor} />
      <Paths d={[...doc, text]} />
      <Paths d={[seal, ribbon]} keyed />
    </Frame>
  )
}

export function ArtVerify() {
  const s = scene()
  const floor = s.floor(-6, -6, 7, 26)
  const shape = (o: number): P[] => [[40, o, 150], [120, o, 150], [130, o, 136], [130, o, 80], [80, o, 20], [30, o, 80], [30, o, 136]]
  const front = shape(60)
  const back = shape(40)
  const backD = s.poly(back)
  const edges = front.map((p, i) => s.line([p, back[i]])).join('')
  const frontD = s.poly(front)
  const check = s.line([[56, 60, 92], [76, 60, 70], [108, 60, 118]])
  return (
    <Frame s={s} label="A shield with a check mark">
      <path className="pm-iso-floor" d={floor} />
      <Paths d={[backD, edges]} />
      <Paths d={[frontD, check]} keyed />
    </Frame>
  )
}

export function ArtRelease() {
  const s = scene()
  const floor = s.floor(-30, 0, 8, 24)
  const tower = s.box(-20, 20, 0, 16, 16, 150)
  const boom = s.line([[-12, 28, 150], [150, 28, 150]]) + s.line([[-12, 28, 150], [-40, 28, 150]])
  const stays = s.line([[-12, 28, 176], [150, 28, 150]]) + s.line([[-12, 28, 176], [-40, 28, 150]]) + s.line([[-12, 28, 150], [-12, 28, 176]])
  const cable = s.line([[110, 28, 150], [110, 28, 92]])
  const box = s.box(86, 10, 62, 50, 36, 30)
  const bed = s.box(70, 70, 0, 100, 40, 16)
  const cab = s.box(170, 70, 0, 34, 40, 40)
  return (
    <Frame s={s} label="A crane lowering a container onto a truck" extra={(b) => {
      const r = b.h * 0.42
      const cx = b.x + b.w - 10
      const cy = b.y + b.h * 0.62
      return <path className="pm-iso-arc" d={`M${(cx - r).toFixed(1)} ${cy.toFixed(1)}A${r.toFixed(1)} ${r.toFixed(1)} 0 0 1 ${cx.toFixed(1)} ${(cy - r).toFixed(1)}`} pathLength={1} />
    }}>
      <path className="pm-iso-floor" d={floor} />
      <Paths d={[...tower, boom, stays, cable, ...bed, ...cab]} />
      <Paths d={box} keyed />
    </Frame>
  )
}

const stroke = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'square' as const, strokeLinejoin: 'miter' as const }

function Icon({ children, size = 24 }: { children: ReactNode; size?: number }) {
  return <svg className="pm-icon" viewBox="0 0 24 24" width={size} height={size} aria-hidden="true" {...stroke}>{children}</svg>
}

export const IconLock = () => <Icon><rect x="5" y="11" width="14" height="9" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /><path d="M12 14.5v2" /></Icon>
export const IconFreeze = () => <Icon><path d="M12 3v18M4.2 7.5l15.6 9M4.2 16.5l15.6-9" /><path d="M9.5 4.5 12 7l2.5-2.5M9.5 19.5 12 17l2.5 2.5" /></Icon>
export const IconArrow = () => <Icon size={18}><path d="M4 12h15M13 6l6 6-6 6" /></Icon>
export const IconOut = () => <Icon size={18}><path d="M7 17 17 7M9 7h8v8" /></Icon>
export const IconPlus = () => <Icon size={14}><path d="M12 5v14M5 12h14" /></Icon>
export const IconBlock = () => <Icon><circle cx="12" cy="12" r="8" /><path d="M6.5 17.5l11-11" /></Icon>
export const IconContract = () => <Icon><path d="M6 3h9l3 3v15H6z" /><path d="M9 9h6M9 13h6M9 17h3" /></Icon>
export const IconCheck = () => <Icon><path d="M4 12.5 9.5 18 20 6" /></Icon>
export const IconGitHub = () => (
  <svg className="pm-icon" viewBox="0 0 16 16" width={20} height={20} aria-hidden="true" fill="currentColor">
    <path d="M8 0c4.42 0 8 3.58 8 8a8.01 8.01 0 0 1-5.45 7.59c-.4.08-.55-.17-.55-.38 0-.27.01-1.13.01-2.2 0-.75-.25-1.23-.54-1.48 1.78-.2 3.65-.88 3.65-3.95 0-.88-.31-1.59-.82-2.15.08-.2.36-1.02-.08-2.12 0 0-.67-.22-2.2.82-.64-.18-1.32-.27-2-.27-.68 0-1.36.09-2 .27-1.53-1.03-2.2-.82-2.2-.82-.44 1.1-.16 1.92-.08 2.12-.51.56-.82 1.28-.82 2.15 0 3.06 1.86 3.75 3.64 3.95-.23.2-.44.55-.51 1.07-.46.21-1.61.55-2.33-.66-.15-.24-.6-.83-1.23-.82-.67.01-.27.38.01.53.34.19.73.9.82 1.13.16.45.68 1.31 2.69.94 0 .67.01 1.3.01 1.49 0 .21-.15.45-.55.38A7.995 7.995 0 0 1 0 8c0-4.42 3.58-8 8-8Z" />
  </svg>
)
