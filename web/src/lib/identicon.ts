// The ethereum-blockies algorithm (8x8, mirrored, three HSL colours seeded from the lowercase address), drawn as SVG
// so it renders without a canvas and the same address gives the same picture as in other Ethereum apps.

function seeded(seed: string) {
  const s = [0, 0, 0, 0]
  for (let i = 0; i < seed.length; i++) s[i % 4] = (s[i % 4] << 5) - s[i % 4] + seed.charCodeAt(i)
  return () => {
    const t = s[0] ^ (s[0] << 11)
    s[0] = s[1]
    s[1] = s[2]
    s[2] = s[3]
    s[3] = s[3] ^ (s[3] >> 19) ^ t ^ (t >> 8)
    return (s[3] >>> 0) / ((1 << 31) >>> 0)
  }
}

function colour(rand: () => number): string {
  const h = Math.floor(rand() * 360)
  const sat = rand() * 60 + 40
  const l = (rand() + rand() + rand() + rand()) * 25
  return `hsl(${h} ${sat.toFixed(1)}% ${l.toFixed(1)}%)`
}

export function blockie(address: string, size = 8): { cells: number[]; color: string; bg: string; spot: string } {
  const rand = seeded(address.toLowerCase())
  const color = colour(rand)
  const bg = colour(rand)
  const spot = colour(rand)
  const half = Math.ceil(size / 2)
  const cells: number[] = []
  for (let y = 0; y < size; y++) {
    const row: number[] = []
    for (let x = 0; x < half; x++) row.push(Math.floor(rand() * 2.3))
    const mirror = row.slice(0, size - half).reverse()
    cells.push(...row, ...mirror)
  }
  return { cells, color, bg, spot }
}

export function blockieSvg(address: string, px = 32): string {
  const size = 8
  const { cells, color, bg, spot } = blockie(address, size)
  const rects = cells.map((v, i) => (v ? `<rect x="${i % size}" y="${Math.floor(i / size)}" width="1" height="1" fill="${v === 1 ? color : spot}"/>` : '')).join('')
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${px}" height="${px}" viewBox="0 0 ${size} ${size}" shape-rendering="crispEdges"><rect width="${size}" height="${size}" fill="${bg}"/>${rects}</svg>`
}

export function blockieDataUri(address: string, px = 32): string {
  return `data:image/svg+xml;utf8,${encodeURIComponent(blockieSvg(address, px))}`
}
