import { canvasLoop, rng, type Loop } from './canvas'

const PALETTE: { color: string; weight: number; alpha: number }[] = [
  { color: '#137452', weight: 30, alpha: 0.95 },
  { color: '#0C4A35', weight: 14, alpha: 1 },
  { color: '#4EC397', weight: 16, alpha: 0.9 },
  { color: '#2E9C74', weight: 12, alpha: 0.9 },
  { color: '#A9E4CC', weight: 6, alpha: 0.85 },
  { color: '#FFFFFF', weight: 14, alpha: 0.2 },
  { color: '#59625E', weight: 8, alpha: 0.6 },
]
const ORANGE = { color: '#F99510', alpha: 1 }

const Z_FAR = 1.7
const Z_NEAR = 0.08
const TAIL = 0.3
const SPEED = 0.5

function sprite(color: string): HTMLCanvasElement {
  const c = document.createElement('canvas')
  c.width = 128
  c.height = 8
  const g = c.getContext('2d')!
  const grad = g.createLinearGradient(0, 0, 128, 0)
  grad.addColorStop(0, 'rgba(0,0,0,0)')
  grad.addColorStop(0.5, color)
  grad.addColorStop(1, color)
  g.fillStyle = grad
  g.globalAlpha = 0.35
  g.fillRect(0, 0, 128, 8)
  g.globalAlpha = 1
  g.fillRect(0, 1, 128, 6)
  return c
}

type Streak = { a: number; c: number; s: number; z: number; v: number; w: number; k: number }

export function startBurst(canvas: HTMLCanvasElement, opts: { still: boolean; observe?: Element }): Loop {
  const sprites = [...PALETTE.map((p) => sprite(p.color)), sprite(ORANGE.color)]
  const alphas = [...PALETTE.map((p) => p.alpha), ORANGE.alpha]
  const total = PALETTE.reduce((a, p) => a + p.weight, 0)
  const rand = rng(20261017)
  const pick = () => {
    if (rand() < 1 / 40) return sprites.length - 1
    let r = rand() * total
    for (let i = 0; i < PALETTE.length; i++) { r -= PALETTE[i].weight; if (r <= 0) return i }
    return 0
  }
  const spawn = (st: Streak, z: number) => {
    st.a = rand() * Math.PI * 2
    st.c = Math.cos(st.a)
    st.s = Math.sin(st.a)
    st.z = z
    st.v = SPEED * (0.75 + rand() * 0.5)
    st.w = 0.6 + rand() * 1.6
    st.k = pick()
  }
  let streaks: Streak[] = []
  const ensure = (w: number, h: number) => {
    const want = Math.round(Math.min(520, Math.max(220, (w * h) / (1440 * 900) * 520)))
    if (streaks.length === want) return
    streaks = Array.from({ length: want }, () => {
      const st = { a: 0, c: 1, s: 0, z: 1, v: SPEED, w: 1, k: 0 }
      spawn(st, Z_NEAR + rand() * (Z_FAR - Z_NEAR))
      return st
    })
  }

  return canvasLoop(canvas, ({ ctx, w, h, dpr }, _t, dt) => {
    ensure(w, h)
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.globalAlpha = 1
    ctx.fillStyle = '#000'
    ctx.fillRect(0, 0, w * dpr, h * dpr)
    const cx = w / 2
    const cy = h / 2
    const unit = Math.min(w, h)
    const focal = unit * 0.24
    const reach = Math.hypot(cx, cy) + 40
    const width = unit * 0.0058
    for (const st of streaks) {
      st.z -= st.v * dt
      if (st.z <= Z_NEAR) spawn(st, Z_FAR)
      const head = focal / st.z
      const tail = focal / (st.z + TAIL)
      if (tail > reach) continue
      const fadeIn = Math.min(1, (Z_FAR - st.z) / 0.35)
      ctx.globalAlpha = alphas[st.k] * fadeIn
      const sw = (width * st.w) / st.z
      ctx.setTransform(st.c * dpr, st.s * dpr, -st.s * dpr, st.c * dpr, cx * dpr, cy * dpr)
      ctx.drawImage(sprites[st.k], tail, -sw / 2, head - tail, sw)
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.globalAlpha = 1
  }, opts)
}
