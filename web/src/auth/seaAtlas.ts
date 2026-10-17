export type Palette = { colors: string[]; glow: number[] }

const SLOT_COLS = 64
const SLOT_ROWS = 10

// Glyphs are rasterised once per (character, colour) into a padded cell, so a frame is only drawImage calls on an integer
// device-pixel grid: the cell aspect is exact for any font, runs never form ligatures, and glow costs nothing per frame.
export class GlyphAtlas {
  readonly cw: number
  readonly lh: number
  private readonly pad: number
  private readonly sw: number
  private readonly sh: number
  private readonly canvas: HTMLCanvasElement
  private readonly ctx: CanvasRenderingContext2D | null
  private readonly slots: Int16Array
  private next = 0

  constructor(private readonly palette: Palette, private readonly font: string, fontPx: number, cw: number, lh: number, dpr: number) {
    this.cw = cw
    this.lh = lh
    this.pad = Math.ceil(5 * dpr)
    this.sw = cw + this.pad * 2
    this.sh = lh + this.pad * 2
    this.slots = new Int16Array(palette.colors.length * 128).fill(-1)
    this.canvas = document.createElement('canvas')
    this.canvas.width = this.sw * SLOT_COLS
    this.canvas.height = this.sh * SLOT_ROWS
    this.ctx = this.canvas.getContext('2d')
    if (this.ctx) {
      this.ctx.font = `${fontPx}px ${this.font}`
      this.ctx.textAlign = 'center'
      this.ctx.textBaseline = 'middle'
    }
  }

  private slot(code: number, color: number): number {
    const key = color * 128 + code
    const s = this.slots[key]
    if (s >= 0 || !this.ctx) return s
    if (this.next >= SLOT_COLS * SLOT_ROWS) return -1
    const n = this.next++
    const x = (n % SLOT_COLS) * this.sw
    const y = Math.floor(n / SLOT_COLS) * this.sh
    const c = this.ctx
    const fill = this.palette.colors[color]
    c.fillStyle = fill
    c.shadowColor = fill
    c.shadowBlur = this.palette.glow[color] * (this.pad / 5)
    c.fillText(String.fromCharCode(code), x + this.pad + this.cw / 2, y + this.pad + this.lh / 2)
    if (c.shadowBlur > 0) {
      c.shadowBlur = 0
      c.fillText(String.fromCharCode(code), x + this.pad + this.cw / 2, y + this.pad + this.lh / 2)
    }
    this.slots[key] = n
    return n
  }

  draw(target: CanvasRenderingContext2D, code: number, color: number, x: number, y: number) {
    const n = this.slot(code, color)
    if (n < 0) return
    const sx = (n % SLOT_COLS) * this.sw
    const sy = Math.floor(n / SLOT_COLS) * this.sh
    // Only glowing colours need the padded rect; blitting the bare cell keeps the raster cost of the plain glyphs low.
    if (this.palette.glow[color] > 0) target.drawImage(this.canvas, sx, sy, this.sw, this.sh, x - this.pad, y - this.pad, this.sw, this.sh)
    else target.drawImage(this.canvas, sx + this.pad, sy + this.pad, this.cw, this.lh, x, y, this.cw, this.lh)
  }
}

type RGB = [number, number, number]

const hex = (h: string): RGB => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)]

export function sample(stops: string[], t: number): RGB {
  const x = Math.max(0, Math.min(1, t)) * (stops.length - 1)
  const i = Math.min(stops.length - 2, Math.floor(x))
  const a = hex(stops[i])
  const b = hex(stops[i + 1])
  const f = x - i
  return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f]
}

export const lerpRGB = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]

export const css = (c: RGB) => `rgb(${Math.round(c[0])}, ${Math.round(c[1])}, ${Math.round(c[2])})`
