import { rng, type Loop } from './canvas'

const GLYPHS = '0123456789abcdef/\\|+-=x'
const STEPS = 12
const DURATION = 1600

function shield(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number) {
  const p = (u: number, v: number): [number, number] => [x + u * w, y + v * h]
  ctx.beginPath()
  ctx.moveTo(...p(0.16, 0))
  ctx.lineTo(...p(0.84, 0))
  ctx.lineTo(...p(1, 0.12))
  ctx.lineTo(...p(1, 0.56))
  ctx.bezierCurveTo(...p(1, 0.8), ...p(0.74, 0.93), ...p(0.5, 1))
  ctx.bezierCurveTo(...p(0.26, 0.93), ...p(0, 0.8), ...p(0, 0.56))
  ctx.lineTo(...p(0, 0.12))
  ctx.closePath()
}

type Cell = { x: number; y: number; ch: string; at: number }

export function startAscii(canvas: HTMLCanvasElement, words: string[], opts: { still: boolean }): Loop {
  const ctx = canvas.getContext('2d')
  if (!ctx) return { stop: () => undefined }
  const rand = rng(84532)
  let cells: Cell[] = []
  let size = { w: 0, h: 0, dpr: 1, cw: 8, lh: 16 }
  let progress = STEPS
  let raf = 0
  let started = 0
  let played = opts.still

  const layout = () => {
    const r = canvas.getBoundingClientRect()
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    const w = Math.max(1, Math.round(r.width))
    const h = Math.max(1, Math.round(r.height))
    const font = w < 500 ? 11 : 13
    const cw = font * 0.6
    const lh = font * 1.25
    size = { w, h, dpr, cw, lh }
    canvas.width = Math.round(w * dpr)
    canvas.height = Math.round(h * dpr)

    const cols = Math.floor(w / cw)
    const rows = Math.floor(h / lh)
    const mask = document.createElement('canvas')
    mask.width = cols
    mask.height = rows
    const m = mask.getContext('2d', { willReadFrequently: true })!
    const sw = Math.min(cols, rows * (lh / cw) * 0.86)
    const sx = (cols - sw) / 2
    m.fillStyle = '#000'
    shield(m, sx, 0, sw, rows)
    m.fill()
    m.globalCompositeOperation = 'destination-out'
    const inset = Math.max(4, sw * 0.13)
    shield(m, sx + inset, inset * (cw / lh) * 1.1, sw - inset * 2, rows - inset * (cw / lh) * 2.6)
    m.fill()
    const data = m.getImageData(0, 0, cols, rows).data
    const stream = words.join(' ') + ' '
    let k = 0
    cells = []
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        if (data[(row * cols + col) * 4 + 3] < 128) continue
        const ch = stream[k % stream.length]
        k++
        if (ch === ' ') continue
        cells.push({ x: col * cw, y: row * lh, ch, at: Math.floor(rand() * STEPS) })
      }
    }
    draw()
  }

  const draw = () => {
    const { w, h, dpr, cw, lh } = size
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, w, h)
    ctx.font = `${Math.round(cw / 0.6)}px "Geist Mono", "JetBrains Mono", ui-monospace, monospace`
    ctx.textBaseline = 'top'
    for (const c of cells) {
      const done = progress >= STEPS || c.at < progress
      const fresh = done && progress < STEPS && c.at >= progress - 2
      ctx.fillStyle = fresh ? '#4EC397' : done ? 'rgba(140, 150, 145, 0.62)' : 'rgba(78, 195, 151, 0.4)'
      ctx.fillText(done ? c.ch : GLYPHS[Math.floor(rand() * GLYPHS.length)], c.x, c.y + (lh - cw / 0.6) / 2)
    }
  }

  const tick = (now: number) => {
    raf = 0
    started ||= now
    const next = Math.min(STEPS, Math.floor(((now - started) / DURATION) * STEPS) + 1)
    if (next !== progress) { progress = next; draw() }
    if (progress < STEPS) raf = requestAnimationFrame(tick)
  }

  const ro = new ResizeObserver(() => layout())
  ro.observe(canvas)
  const io = new IntersectionObserver((entries) => {
    if (played || !entries.some((e) => e.isIntersecting)) return
    played = true
    progress = 0
    raf = requestAnimationFrame(tick)
    io.disconnect()
  }, { threshold: 0.3 })
  if (!opts.still) io.observe(canvas)
  const fonts = document.fonts
  fonts?.ready.then(() => layout()).catch(() => undefined)

  return {
    stop: () => {
      if (raf) cancelAnimationFrame(raf)
      ro.disconnect()
      io.disconnect()
    },
  }
}
