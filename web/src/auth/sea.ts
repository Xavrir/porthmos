import { canvasLoop, type Loop } from '../landing/canvas'

const RAMP = ' .:-=+*#%@'
const FPS = 30
const SHIP_PERIOD = 46
const CYCLE = 56
const FONT = 'ui-monospace, "SF Mono", "Cascadia Mono", Menlo, Consolas, "DejaVu Sans Mono", monospace'

const LEVEL_BUCKET = [0, 0, 0, 1, 1, 2, 2, 2, 3, 3]
const BUCKETS = ['rgba(78, 195, 151, 0.34)', 'rgba(78, 195, 151, 0.62)', '#4EC397', '#B9F3DA']
const SHIP_COLOR = '#E4FBF1'
const BEACON = '#F99510'

const SHIP = [
  '      |>',
  '    __|__   [=][#][=]',
  '   | :: |[#][=][#][=][#]',
  '___|____|[=][#][=][#][=]__',
  '\\    P O R T H M O S     /',
  ' \\______________________/',
]
const SHIP_W = Math.max(...SHIP.map((l) => l.length))
const SHIP_SPANS = SHIP.map((l) => [l.search(/\S/), l.length - 1 - [...l].reverse().join('').search(/\S/)] as const)

const LIGHTHOUSE = [
  '   *   ',
  '  [#]  ',
  '  |=|  ',
  '  | |  ',
  '  |=|  ',
  ' _|_|_ ',
]
const LAMP = { row: 0, col: 3 }

type Grid = { cols: number; rows: number; cw: number; lh: number; fs: number; horizon: number; land: Uint8Array; shield: Uint8Array; landText: string[] }

function hash(x: number, y: number) {
  let h = (x * 374761393 + y * 668265263) | 0
  h = Math.imul(h ^ (h >>> 13), 1274126177)
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296
}

function noise(x: number, y: number) {
  const xi = Math.floor(x)
  const yi = Math.floor(y)
  const xf = x - xi
  const yf = y - yi
  const u = xf * xf * (3 - 2 * xf)
  const v = yf * yf * (3 - 2 * yf)
  const a = hash(xi, yi)
  const b = hash(xi + 1, yi)
  const c = hash(xi, yi + 1)
  const d = hash(xi + 1, yi + 1)
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v
}

const SWELL = 10
const depth = (d: number) => 1 / (Math.max(0, d) + 0.22)

// Box-filters a cosine over one row's phase span, so the crowded crests near the horizon fade instead of aliasing.
function blur(span: number) {
  const h = Math.abs(span) / 2
  return h < 1e-3 ? 1 : Math.abs(Math.sin(h) / h)
}

function pulse(t: number, from: number, to: number) {
  const p = ((t % CYCLE) + CYCLE) % CYCLE
  if (p < from || p > to) return 0
  const edge = 2.5
  return Math.min(1, (p - from) / edge, (to - p) / edge)
}

function shieldMask(cols: number, horizon: number, cw: number, lh: number): Uint8Array {
  const mask = new Uint8Array(cols * horizon)
  const h = Math.floor(horizon * 0.64)
  if (h < 9) return mask
  const w = Math.round((h * lh * 0.86) / cw)
  const x0 = Math.round(cols * 0.42 - w / 2)
  const y0 = Math.max(1, Math.floor((horizon - h) / 2) - 1)
  const c = document.createElement('canvas')
  c.width = cols
  c.height = horizon
  const m = c.getContext('2d', { willReadFrequently: true })
  if (!m) return mask
  const shape = (x: number, y: number, sw: number, sh: number) => {
    const p = (u: number, v: number): [number, number] => [x + u * sw, y + v * sh]
    m.beginPath()
    m.moveTo(...p(0.16, 0))
    m.lineTo(...p(0.84, 0))
    m.lineTo(...p(1, 0.12))
    m.lineTo(...p(1, 0.56))
    m.bezierCurveTo(...p(1, 0.8), ...p(0.74, 0.93), ...p(0.5, 1))
    m.bezierCurveTo(...p(0.26, 0.93), ...p(0, 0.8), ...p(0, 0.56))
    m.lineTo(...p(0, 0.12))
    m.closePath()
  }
  m.fillStyle = '#000'
  shape(x0, y0, w, h)
  m.fill()
  m.globalCompositeOperation = 'destination-out'
  const inset = Math.max(1.6, w * 0.09)
  shape(x0 + inset, y0 + inset * (cw / lh) * 1.2, w - inset * 2, h - inset * (cw / lh) * 2.6)
  m.fill()
  const data = m.getImageData(0, 0, cols, horizon).data
  for (let i = 0; i < mask.length; i++) mask[i] = data[i * 4 + 3] > 110 ? 1 : 0
  return mask
}

function layout(w: number, h: number, ctx: CanvasRenderingContext2D): Grid {
  const band = h < 220
  const fs = band ? 10 : w < 560 ? 12 : 13
  ctx.font = `${fs}px ${FONT}`
  const cw = ctx.measureText('M').width || fs * 0.6
  const lh = Math.round(fs * 1.25)
  const cols = Math.ceil(w / cw) + 1
  const rows = Math.ceil(h / lh) + 1
  const horizon = Math.max(2, Math.floor(rows * (band ? 0.22 : 0.42)))
  const land = new Uint8Array(cols * rows)
  const landText = Array.from({ length: rows }, () => ' '.repeat(cols).split(''))
  const put = (row: number, col: number, ch: string) => {
    if (row < 0 || row >= rows || col < 0 || col >= cols || ch === ' ') return
    land[row * cols + col] = 1
    landText[row][col] = ch
  }
  const shore = Math.min(Math.floor(cols * 0.28), 30)
  for (let c = 0; c < shore; c++) {
    const top = Math.round(1.6 * Math.sin(c * 0.33) + 1.2 * Math.sin(c * 0.11 + 1) + 2.2 - (c / shore) * 2.4)
    const height = Math.max(0, Math.min(band ? 1 : 3, top))
    for (let k = 0; k < height; k++) put(horizon - 1 - k, c, k === height - 1 ? (c % 5 === 2 ? '^' : '_') : ':')
  }
  if (horizon >= LIGHTHOUSE.length + 1) {
    const col0 = cols - LIGHTHOUSE[0].length - Math.max(3, Math.floor(cols * 0.08))
    const row0 = horizon - LIGHTHOUSE.length
    LIGHTHOUSE.forEach((line, i) => [...line].forEach((ch, j) => { if (!(i === LAMP.row && j === LAMP.col)) put(row0 + i, col0 + j, ch) }))
    for (let c = col0 - 3; c < cols; c++) put(horizon - 1, c, c < col0 ? '_' : c > col0 + 6 ? (c % 3 ? '_' : '.') : landText[horizon - 1][c] === ' ' ? '_' : landText[horizon - 1][c])
  }
  return { cols, rows, cw, lh, fs, horizon, land, shield: band ? new Uint8Array(cols * horizon) : shieldMask(cols, horizon, cw, lh), landText: landText.map((r) => r.join('')) }
}

function lampCell(g: Grid): { row: number; col: number } {
  if (g.horizon >= LIGHTHOUSE.length + 1) {
    const col0 = g.cols - LIGHTHOUSE[0].length - Math.max(3, Math.floor(g.cols * 0.08))
    return { row: g.horizon - LIGHTHOUSE.length + LAMP.row, col: col0 + LAMP.col }
  }
  return { row: g.horizon - 1, col: g.cols - Math.max(4, Math.floor(g.cols * 0.1)) }
}

export function startSea(canvas: HTMLCanvasElement, opts: { still: boolean }): Loop {
  let grid: Grid | null = null
  let gridKey = ''
  let lastDraw = -1
  let buckets: Uint16Array[] = []
  let overlay = new Uint16Array(0)
  const t0 = opts.still ? SHIP_PERIOD * 0.42 : SHIP_PERIOD * 0.12

  return canvasLoop(canvas, ({ ctx, w, h, dpr }, time, dt) => {
    const key = `${w}x${h}@${dpr}`
    // Resizing clears the canvas, so a resized frame is always drawn even inside the frame budget.
    if (dt > 0 && key === gridKey && time - lastDraw < 1 / FPS - 0.004) return
    lastDraw = time
    const t = time + t0
    if (!grid || key !== gridKey) {
      grid = layout(w, h, ctx)
      gridKey = key
      buckets = BUCKETS.map(() => new Uint16Array(grid!.cols))
      overlay = new Uint16Array(grid.cols)
    }
    const g = grid
    const { cols, rows, cw, lh, horizon } = g
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.fillStyle = '#000'
    ctx.fillRect(0, 0, w, h)
    ctx.font = `${g.fs}px ${FONT}`
    ctx.textBaseline = 'top'
    // Some monospace fonts join runs such as "==" or "->"; the grid needs one glyph per cell.
    ;(ctx as CanvasRenderingContext2D & { textRendering?: string }).textRendering = 'optimizeSpeed'

    const travel = w + SHIP_W * cw * 2
    const shipX = (((t / SHIP_PERIOD) % 1) * travel) - SHIP_W * cw * 1.4
    const seaRows = rows - horizon
    const shipBase = Math.min(rows - 1, horizon + Math.max(SHIP.length - 1, Math.floor(seaRows * 0.46)))
    const shipTop = shipBase - SHIP.length + 1
    const shipCol = Math.floor(shipX / cw)
    const bob = Math.sin(t * 1.15) * lh * 0.28
    const sternCol = shipCol + SHIP_SPANS[3][0]

    const space = 32
    const gridA = opts.still ? 0 : pulse(t, 6, 18)
    const shieldA = opts.still ? 1 : pulse(t, 30, 44)

    for (let r = 0; r < rows; r++) {
      for (const b of buckets) b.fill(space)
      overlay.fill(space)
      let any = false
      let overlayAny = false
      const y = r * lh
      if (r >= horizon) {
        const d = (r - horizon + 1) / seaRows
        const z = depth(d)
        const zPrev = depth(d - 1 / seaRows)
        const aa1 = blur(SWELL * (zPrev - z))
        const aa2 = blur(SWELL * 0.6 * (zPrev - z))
        const fade = 0.42 + 0.58 * d
        const shipRow = r - shipTop
        const masked = shipRow >= 0 && shipRow < SHIP.length
        const m0 = masked ? shipCol + SHIP_SPANS[shipRow][0] : 0
        const m1 = masked ? shipCol + SHIP_SPANS[shipRow][1] : -1
        for (let c = 0; c < cols; c++) {
          if (c >= m0 && c <= m1) continue
          const x = c / cols
          const p1 = SWELL * z - t * 1.05 + 1.5 * Math.sin(x * 5.6 + z * 0.8 + t * 0.25) + 0.7 * Math.sin(x * 14.4 - z * 1.7 - t * 0.4)
          const group = 0.35 + 0.65 * noise(x * 5 + z * 0.6 - t * 0.12, z * 0.9 + 7)
          const p2 = SWELL * 0.6 * z + x * 18.8 - t * 0.8
          const s1 = (Math.cos(p1) + 1) / 2
          const s2 = (Math.cos(p2) + 1) / 2
          const crest = s1 * s1 * s1
          const glint = Math.max(0, noise(c * 0.35, r * 0.9 - t * 0.6) - 0.72) * 3
          let lit = (0.7 * crest * group * aa1 + 0.2 * s2 * aa2 + 0.14 * s1 * aa1 + 0.05) * fade + glint * 0.45 * fade
          if (r >= shipBase - 1 && r <= shipBase + 1 && c < sternCol && c > sternCol - 18) {
            const behind = (sternCol - c) / 18
            lit = Math.max(lit, (1 - behind) * (0.55 + 0.4 * noise(c * 0.8 - t * 3, r * 2)))
          }
          const level = Math.floor(Math.max(0, Math.min(0.999, lit)) * RAMP.length)
          if (level === 0) continue
          buckets[LEVEL_BUCKET[level]][c] = RAMP.charCodeAt(level)
          any = true
        }
      } else {
        const landRow = g.landText[r]
        for (let c = 0; c < cols; c++) {
          if (g.land[r * cols + c]) { buckets[1][c] = landRow.charCodeAt(c); any = true; continue }
          if (gridA > 0 && (c % 12 === 0 || r % 5 === 0) && (c + r) % 2 === 0) { overlay[c] = c % 12 === 0 && r % 5 === 0 ? 43 : 46; overlayAny = true }
          if (shieldA > 0 && g.shield[r * cols + c]) { overlay[c] = (c + r) % 3 ? 35 : 61; overlayAny = true }
        }
      }
      if (any) {
        for (let b = 0; b < buckets.length; b++) {
          const line = buckets[b]
          if (!line.some((ch) => ch !== space)) continue
          ctx.fillStyle = BUCKETS[b]
          ctx.fillText(String.fromCharCode(...line), 0, y)
        }
      }
      if (overlayAny) {
        ctx.globalAlpha = Math.max(gridA * 0.3, shieldA * 0.4)
        ctx.fillStyle = BUCKETS[2]
        ctx.fillText(String.fromCharCode(...overlay), 0, y)
        ctx.globalAlpha = 1
      }
    }

    if (shipX < w && shipX + SHIP_W * cw > 0) {
      ctx.fillStyle = SHIP_COLOR
      SHIP.forEach((line, i) => ctx.fillText(line, shipX, (shipTop + i) * lh + bob))
    }

    const lamp = lampCell(g)
    const beat = t % 4.2
    const on = opts.still || beat < 0.35 || (beat > 0.7 && beat < 1.05)
    ctx.fillStyle = on ? BEACON : BUCKETS[1]
    ctx.fillText('*', lamp.col * cw, lamp.row * lh)
    if (on && !opts.still && beat < 0.35) {
      ctx.globalAlpha = 0.45
      ctx.fillStyle = BEACON
      ctx.fillText('- -', (lamp.col - 4) * cw, lamp.row * lh)
      ctx.globalAlpha = 1
    }
  }, { still: opts.still, alpha: false })
}
