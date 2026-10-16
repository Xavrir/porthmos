import { canvasLoop, type Loop } from './canvas'

const BARS = 120
const BLOCK = 6
const GAP = 2
const PITCH = BLOCK + GAP

export function startBarField(canvas: HTMLCanvasElement, opts: { still: boolean }): Loop {
  const tile = document.createElement('canvas')
  tile.width = 1
  tile.height = PITCH
  const tg = tile.getContext('2d')!
  tg.fillStyle = '#137452'
  tg.fillRect(0, 0, 1, BLOCK)
  let pattern: CanvasPattern | null = null

  return canvasLoop(canvas, ({ ctx, w, h, dpr }, t) => {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.fillStyle = '#000'
    ctx.fillRect(0, 0, w, h)
    pattern ??= ctx.createPattern(tile, 'repeat')
    pattern?.setTransform(new DOMMatrix().translate(0, h % PITCH))
    const n = w < 600 ? 60 : BARS
    const pitch = w / n
    const bw = Math.max(2, pitch - 2)
    const room = h * 0.72
    for (let i = 0; i < n; i++) {
      const u = i / n
      const wave = 0.5
        + 0.22 * Math.sin(u * 9.4 + t * 0.7)
        + 0.16 * Math.sin(u * 23.1 - t * 0.45)
        + 0.1 * Math.sin(u * 51.7 + t * 1.3)
      const stacks = Math.max(1, Math.round((Math.max(0.08, Math.min(1, wave)) * room) / PITCH))
      const x = i * pitch
      if (stacks > 1 && pattern) {
        ctx.fillStyle = pattern
        ctx.fillRect(x, h - (stacks - 1) * PITCH, bw, (stacks - 1) * PITCH)
      }
      ctx.fillStyle = '#4EC397'
      ctx.fillRect(x, h - stacks * PITCH, bw, BLOCK)
    }
    const r = Math.min(w * 0.12, h * 0.9)
    ctx.strokeStyle = '#F99510'
    ctx.lineWidth = 2
    ctx.beginPath()
    ctx.arc(w * 0.78, h * 0.98, r, Math.PI * 1.08, Math.PI * 1.62)
    ctx.stroke()
  }, opts)
}
