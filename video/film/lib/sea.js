(function () {
  // Port of web/src/auth/sea.ts + seaAtlas.ts. Frames are a pure function of the time passed to draw(), never of a clock.
var __defProp = Object.defineProperty;
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __publicField = (obj, key, value) => __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);
const SLOT_COLS = 64;
const SLOT_ROWS = 10;
class GlyphAtlas {
  constructor(palette, font, fontPx, cw, lh, dpr) {
    this.palette = palette;
    this.font = font;
    __publicField(this, "cw");
    __publicField(this, "lh");
    __publicField(this, "pad");
    __publicField(this, "sw");
    __publicField(this, "sh");
    __publicField(this, "canvas");
    __publicField(this, "ctx");
    __publicField(this, "slots");
    __publicField(this, "next", 0);
    this.cw = cw;
    this.lh = lh;
    this.pad = Math.ceil(5 * dpr);
    this.sw = cw + this.pad * 2;
    this.sh = lh + this.pad * 2;
    this.slots = new Int16Array(palette.colors.length * 128).fill(-1);
    this.canvas = document.createElement("canvas");
    this.canvas.width = this.sw * SLOT_COLS;
    this.canvas.height = this.sh * SLOT_ROWS;
    this.ctx = this.canvas.getContext("2d");
    if (this.ctx) {
      this.ctx.font = `${fontPx}px ${this.font}`;
      this.ctx.textAlign = "center";
      this.ctx.textBaseline = "middle";
    }
  }
  slot(code2, color) {
    const key = color * 128 + code2;
    const s = this.slots[key];
    if (s >= 0 || !this.ctx) return s;
    if (this.next >= SLOT_COLS * SLOT_ROWS) return -1;
    const n = this.next++;
    const x = n % SLOT_COLS * this.sw;
    const y = Math.floor(n / SLOT_COLS) * this.sh;
    const c = this.ctx;
    const fill = this.palette.colors[color];
    c.fillStyle = fill;
    c.shadowColor = fill;
    c.shadowBlur = this.palette.glow[color] * (this.pad / 5);
    c.fillText(String.fromCharCode(code2), x + this.pad + this.cw / 2, y + this.pad + this.lh / 2);
    if (c.shadowBlur > 0) {
      c.shadowBlur = 0;
      c.fillText(String.fromCharCode(code2), x + this.pad + this.cw / 2, y + this.pad + this.lh / 2);
    }
    this.slots[key] = n;
    return n;
  }
  draw(target, code2, color, x, y) {
    const n = this.slot(code2, color);
    if (n < 0) return;
    const sx = n % SLOT_COLS * this.sw;
    const sy = Math.floor(n / SLOT_COLS) * this.sh;
    if (this.palette.glow[color] > 0) target.drawImage(this.canvas, sx, sy, this.sw, this.sh, x - this.pad, y - this.pad, this.sw, this.sh);
    else target.drawImage(this.canvas, sx + this.pad, sy + this.pad, this.cw, this.lh, x, y, this.cw, this.lh);
  }
}
const hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
function sample(stops, t) {
  const x = Math.max(0, Math.min(1, t)) * (stops.length - 1);
  const i = Math.min(stops.length - 2, Math.floor(x));
  const a = hex(stops[i]);
  const b = hex(stops[i + 1]);
  const f = x - i;
  return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f];
}
const lerpRGB = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const css = (c) => `rgb(${Math.round(c[0])}, ${Math.round(c[1])}, ${Math.round(c[2])})`;
const FONT = '"JetBrains Mono", monospace';
const FPS = 30;
const SHIP_PERIOD = 80;
const BEAM_PERIOD = 16;
const W_DEPTHS = 6;
const W_LEVELS = 12;
const FAMILY = { water: 0, moon: 72, beam: 86, sky: 100, mist: 110, land: 115, ship: 121 };
const LEVELS = { moon: 14, beam: 14, sky: 10, mist: 5, land: 6 };
const WATER_FAR = ["#02090c", "#072a33", "#145a63", "#3f8f8c", "#a9ddd4"];
const WATER_NEAR = ["#020b08", "#0a3b2b", "#22805e", "#4EC397", "#e9fff5"];
const SHIP_COLORS = ["#93a8a0", "#4c5e57", "#cfdcd6", "#62786f", "#ffc46b", "#F99510", "#2f8268", "#22616a", "#5f7d75", "#43a582", "#1f5c4b", "#7e948c"];
const SHIP_GLOW = [0, 0, 0, 0, 7, 12, 0, 0, 0, 0, 0, 0];
const SHIP_MAT = { hull: 0, hullDim: 1, bridge: 2, name: 3, window: 4, light: 5, box: 6 };
function buildPalette() {
  const colors = [];
  const glow = [];
  const push = (c, g = 0) => {
    colors.push(c);
    glow.push(g);
  };
  for (let d = 0; d < W_DEPTHS; d++) {
    for (let l = 0; l < W_LEVELS; l++) {
      const t = l / (W_LEVELS - 1);
      const g = Math.pow(t, 0.85);
      push(css(lerpRGB(sample(WATER_FAR, g), sample(WATER_NEAR, g), d / (W_DEPTHS - 1))), l >= W_LEVELS - 2 ? 3 : 0);
    }
  }
  for (let l = 0; l < LEVELS.moon; l++) push(css(sample(["#141d1c", "#3e5352", "#94aba5", "#e3ebdc", "#fffbe9"], l / (LEVELS.moon - 1))), l >= LEVELS.moon - 4 ? 6 + l - (LEVELS.moon - 4) * 1 : 0);
  for (let l = 0; l < LEVELS.beam; l++) push(css(sample(["#170d02", "#4a2804", "#9a5608", "#F99510", "#ffc06a", "#fff0d6"], l / (LEVELS.beam - 1))), l >= LEVELS.beam - 3 ? 8 : 0);
  for (let l = 0; l < LEVELS.sky; l++) push(css(sample(["#0c1316", "#233139", "#5a6f7a", "#b4c6cf", "#f6faff"], l / (LEVELS.sky - 1))), l >= LEVELS.sky - 2 ? 5 : 0);
  for (let l = 0; l < LEVELS.mist; l++) push(css(sample(["#051110", "#0b2321", "#16413c", "#24605a"], l / (LEVELS.mist - 1))));
  for (const c of ["#0b1512", "#182b25", "#26433a", "#4b7366", "#7d8f88", "#b8c7c1"]) push(c);
  SHIP_COLORS.forEach((c, i) => push(c, SHIP_GLOW[i]));
  return { colors, glow };
}
const PALETTE = buildPalette();
const BIG_SHIP = [
  "      *                                    ",
  "      |                                    ",
  "   ___|___                                 ",
  "   |o o o|       [==]  [==][==]            ",
  "   |o o o|   [==][==][==][==][==][==]      ",
  "   |=====|[==][==][==][==][==][==][==][==] ",
  "___|_____|[==][==][==][==][==][==][==][==]_*",
  "\\                              PORTHMOS  / ",
  " \\=======================================/  "
];
const SMALL_SHIP = [
  "   *                  ",
  "  _|_   [=][=]        ",
  " |o o|[=][=][=][=]    ",
  "_|___|[=][=][=][=][=]*",
  "\\___________________/ "
];
const BIG_TOWER = [
  "  ^  ",
  " /_\\ ",
  " |@| ",
  "[===]",
  " |#| ",
  " | | ",
  " |#| ",
  " | | ",
  "/___\\"
];
const SMALL_TOWER = [
  "/@\\",
  "|#|",
  "|_|"
];
function shipSprite(rows, bridgeEnd) {
  const w = Math.max(...rows.map((l) => l.length));
  const h = rows.length;
  const color = new Int16Array(w * h).fill(-1);
  const lights = [];
  const spans = rows.map((l) => [l.search(/\S/), l.trimEnd().length - 1]);
  rows.forEach((line, r) => {
    let box = 0;
    for (let c = 0; c < line.length; c++) {
      const ch = line[c];
      if (ch === " ") continue;
      if (ch === "[") box++;
      let m = SHIP_MAT.hull;
      if (ch === "*") {
        m = SHIP_MAT.light;
        lights.push(c);
      } else if (ch === "o") {
        m = SHIP_MAT.window;
        lights.push(c);
      } else if (/[A-Z]/.test(ch)) m = SHIP_MAT.name;
      else if (c > bridgeEnd && /[[\]=]/.test(ch)) m = SHIP_MAT.box + (box * 7 + r * 3) % 5;
      else if (c <= bridgeEnd && r < h - 3) m = SHIP_MAT.bridge;
      else if (r === h - 1) m = SHIP_MAT.hullDim;
      color[r * w + c] = FAMILY.ship + m;
    }
  });
  return { rows, w, h, color, spans, lights: [...new Set(lights)], bridge: bridgeEnd };
}
const SHIPS = { big: shipSprite(BIG_SHIP, 9), small: shipSprite(SMALL_SHIP, 5) };
function hash(x, y) {
  let h = x * 374761393 + y * 668265263 | 0;
  h = Math.imul(h ^ h >>> 13, 1274126177);
  return ((h ^ h >>> 16) >>> 0) / 4294967296;
}
function noise(x, y) {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = x - xi;
  const yf = y - yi;
  const u = xf * xf * (3 - 2 * xf);
  const v = yf * yf * (3 - 2 * yf);
  const a = hash(xi, yi);
  const b = hash(xi + 1, yi);
  const c = hash(xi, yi + 1);
  const d = hash(xi + 1, yi + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
const clamp01 = (x) => x < 0 ? 0 : x > 1 ? 1 : x;
const smooth = (a, b, x) => {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};
const WATER_RAMP = "    .--~~~~=";
const GLITTER_RAMP = "  ..--~~==**";
const HAZE_RAMP = "  ..::-=+";
const code = (s, i) => s.charCodeAt(Math.max(0, Math.min(s.length - 1, i)));
const WAVES = [
  { kz: 44, kx: 8, w: 1.1, a: 1, p: 0 },
  { kz: 63, kx: -30, w: 1.45, a: 0.5, p: 1.7 },
  { kz: 88, kx: 46, w: 1.8, a: 0.32, p: 4.1 },
  { kz: 190, kx: -105, w: 3.1, a: 0.16, p: 2.3 },
  { kz: 260, kx: 150, w: 3.7, a: 0.1, p: 5.2 }
];
const U0 = 0.35;
const AMP = WAVES.reduce((s, w) => s + w.a, 0);
function makeScene(w, h, dpr, fontOverride, horizonFrac) {
  const band = h < 220;
  const fontCss = fontOverride || (band ? 10 : Math.max(12, Math.min(16, Math.round(w / 52))));
  const fontPx = fontCss * dpr;
  const probe = document.createElement("canvas").getContext("2d");
  let adv = fontPx * 0.6;
  if (probe) {
    probe.font = `${fontPx}px ${FONT}`;
    adv = probe.measureText("M").width || adv;
  }
  const cw = Math.max(1, Math.round(adv));
  const lh = Math.round(fontPx * (band ? 1.2 : 1.22));
  const cols = Math.ceil(w * dpr / cw);
  const rows = Math.ceil(h * dpr / lh);
  const horizon = Math.round(rows * (horizonFrac || 0.5));
  const seaRows = rows - horizon;
  const atlas = new GlyphAtlas(PALETTE, FONT, fontPx, cw, lh, dpr);
  const n = cols * rows;
  const sky = new Uint8Array(n);
  const skyColor = new Uint16Array(n);
  const opaque = new Uint8Array(n);
  const put = (r, c, ch, color, solid = true) => {
    if (r < 0 || r >= rows || c < 0 || c >= cols) return;
    const k = r * cols + c;
    sky[k] = ch.charCodeAt(0);
    skyColor[k] = color;
    if (solid) opaque[k] = 1;
  };
  const aspect = lh / cw;
  const moonR = band ? 0.95 : Math.max(1.6, Math.min(3.8, rows * 0.062));
  const moon = { x: cols * (band ? 0.74 : 0.69), y: band ? horizon * 0.42 : horizon - Math.max(5, horizon * 0.33), r: moonR };
  const tower = band ? SMALL_TOWER : BIG_TOWER;
  const hw = Math.round(cols * (band ? 0.2 : 0.26));
  const landH = band ? 1.2 : Math.max(2, Math.min(8, horizon * 0.24));
  const towerCol = band ? 3 : Math.max(1, Math.round(hw * 0.3) - 2);
  const heightAt = (c) => {
    if (c >= hw) return 0;
    const x = c / hw;
    const crown = 1 + 0.1 * Math.sin(x * 9 + 0.4) + (band ? 0 : 0.12 * (noise(c * 0.35, 3.3) - 0.5));
    const cliff = 1 - smooth(0.58, 0.8, x) * 0.78 - smooth(0.8, 1, x) * 0.22;
    return Math.max(0, landH * crown * cliff);
  };
  for (let c = 0; c < hw + 1; c++) {
    const H2 = heightAt(c);
    if (H2 < 0.2) continue;
    const top = horizon - Math.ceil(H2);
    const fill = H2 - Math.floor(H2) || 1;
    const slope = (heightAt(c + 1) - heightAt(c - 1)) / 2;
    const next = Math.ceil(heightAt(c + 1));
    for (let r = top; r < horizon; r++) {
      if (r === top) {
        const ch = slope < -0.55 ? "\\" : slope > 0.55 ? "/" : fill < 0.5 ? "_" : "-";
        put(r, c, ch, FAMILY.land + (slope < -0.55 ? 4 : 3));
      } else if (horizon - r > next) {
        put(r, c, hash(c, r) < 0.5 ? "|" : "!", FAMILY.land + 3);
      } else {
        const v = hash(c * 7 + 1, r * 13 + 5);
        const near = r - top < 2;
        put(r, c, v < 0.5 ? ":" : v < 0.82 ? "." : " ", FAMILY.land + (near || v < 0.15 ? 2 : 1));
      }
    }
  }
  const towerTop = horizon - Math.ceil(heightAt(towerCol + 2)) - tower.length + 1;
  tower.forEach((line, i) => {
    for (let j = 0; j < line.length; j++) {
      const ch = line[j];
      if (ch === " ") {
        if (i > 1) put(towerTop + i, towerCol + j, " ", 0, true);
        continue;
      }
      const lit = ch === "#" || ch === "_" || ch === "^" ? 4 : 5;
      put(towerTop + i, towerCol + j, ch, FAMILY.land + lit);
    }
  });
  for (let r = towerTop + tower.length; r < horizon; r++) for (let j = 0; j < tower[0].length; j++) if (!sky[r * cols + towerCol + j]) put(r, towerCol + j, " ", 0);
  const lampRow = tower.findIndex((l) => l.includes("@"));
  const lamp = { col: towerCol + tower[lampRow].indexOf("@"), row: towerTop + lampRow };
  if (!band) {
    for (let c = Math.round(cols * 0.5); c < cols; c++) {
      const H2 = 0.4 + 1.6 * smooth(0.5, 0.75, c / cols) * noise(c * 0.11, 9.1) + 0.5 * noise(c * 0.37, 2.2);
      const top = horizon - Math.max(1, Math.round(H2));
      for (let r = top; r < horizon; r++) put(r, c, r === top ? H2 - Math.floor(H2) > 0.7 ? "-" : H2 - Math.floor(H2) < 0.25 ? "." : "_" : hash(c, r) < 0.1 ? "." : " ", FAMILY.land + (r === top ? 2 : 1));
    }
    for (const fx of [0.79, 0.86, 0.93]) put(horizon - 1, Math.round(cols * fx), ".", FAMILY.moon + 9, true);
  }
  for (let r = 0; r < horizon; r++) {
    for (let c = 0; c < cols; c++) {
      const k = r * cols + c;
      if (opaque[k]) continue;
      const dx = (c + 0.5 - moon.x) / aspect;
      const dy = r + 0.5 - moon.y;
      const d = Math.sqrt(dx * dx + dy * dy) / moon.r;
      if (band) {
        if (r === Math.floor(moon.y) && Math.abs(c + 0.5 - moon.x) < 1.6) {
          put(r, c, c + 0.5 < moon.x - 0.6 ? "(" : c + 0.5 > moon.x + 0.6 ? ")" : "@", FAMILY.moon + 12);
          continue;
        }
      } else if (d < 1.25) {
        let cov = 0;
        for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) {
          const sx = (c + (i + 0.5) / 4 - moon.x) / aspect;
          const sy = r + (j + 0.5) / 4 - moon.y;
          if (sx * sx + sy * sy < moon.r * moon.r) cov++;
        }
        cov /= 16;
        if (cov > 0.08) {
          const z = Math.sqrt(Math.max(0, 1 - d * d));
          const maria = smooth(0.45, 0.75, noise(dx * 1.5 + 4.2, dy * 1.5 + 1.3)) * 0.3 + smooth(0.55, 0.8, noise(dx * 3.1, dy * 3.4 + 8)) * 0.12;
          const b2 = clamp01(0.8 + 0.2 * z - maria);
          const ch = cov > 0.82 ? maria > 0.22 ? "%" : "@" : cov > 0.5 ? "o" : cov > 0.25 ? ":" : ".";
          put(r, c, ch, FAMILY.moon + Math.round(4 + b2 * 9 * Math.min(1, cov + 0.3)));
          continue;
        }
      }
      const halo = 0.62 * Math.exp(-(d - 1) * 1.15);
      const hv = hash(c * 3 + 11, r * 5 + 7);
      if (d < 4.2 && hv < halo * 0.9) {
        put(r, c, hv < halo * 0.3 ? ":" : ".", FAMILY.moon + Math.max(1, Math.round(halo * 7)), false);
        continue;
      }
      if (band) continue;
      const nx = c / cols;
      const ny = r / horizon;
      const along = (nx - 0.02) * 0.83 + (0.86 - ny) * 0.56;
      const across = -(nx - 0.02) * 0.56 + (0.86 - ny) * 0.83;
      const veil = Math.exp(-((across - 0.05) * (across - 0.05)) / 0.012) * (0.35 + 0.65 * noise(c * 0.16, r * 0.32)) * smooth(-0.1, 0.3, along);
      const rift = Math.exp(-((across - 0.06) * (across - 0.06)) / 12e-4) * noise(c * 0.3 + 5, r * 0.5) * 0.9;
      const mw = clamp01((veil - rift) * 1.35) * smooth(1.5, 5.5, d) * smooth(0, 0.35, 1 - ny);
      const mv = hash(c * 17 + 3, r * 29 + 1);
      if (mv < mw * 0.6) put(r, c, mv < mw * 0.1 ? ":" : mv < mw * 0.22 ? "`" : ".", FAMILY.sky + (mv < mw * 0.1 ? 4 : mv < mw * 0.3 ? 3 : 2), false);
    }
  }
  const starList = [];
  for (let r = 0; r < horizon - 1; r++) {
    for (let c = 0; c < cols; c++) {
      const k = r * cols + c;
      if (opaque[k]) continue;
      if (hash(c * 41 + 7, r * 59 + 3) > 0.03) continue;
      const dx = (c + 0.5 - moon.x) / aspect;
      const dy = r + 0.5 - moon.y;
      const near = smooth(1.8, 6, Math.sqrt(dx * dx + dy * dy) / moon.r);
      const low = smooth(0, 0.3, (horizon - r) / horizon);
      const mag = Math.pow(hash(c * 7 + 2, r * 3 + 9), 2) * near * low;
      if (mag < 0.04) continue;
      starList.push(k, mag, hash(c, r * 7) * 6.28, 0.6 + hash(r, c * 5) * 2.6);
    }
  }
  const rowZ = new Float32Array(rows);
  const rowU = new Float32Array(rows);
  const rowGain = new Float32Array(rows * WAVES.length);
  const kScale = Math.min(1, seaRows * 0.26 / 3.2);
  for (let r = horizon; r < rows; r++) {
    const u = (r - horizon + 0.6) / seaRows;
    const Z = 1 / (u + U0);
    rowU[r] = u;
    rowZ[r] = Z;
    const dsx = cw / (seaRows * lh);
    WAVES.forEach((wv, i) => {
      const pr = 2 * Math.PI * (u + U0) * (u + U0) * seaRows / (wv.kz * kScale);
      const pc = 2 * Math.PI / (Math.abs(wv.kx * kScale) * Z * dsx);
      rowGain[r * WAVES.length + i] = smooth(1.7, 3.4, pr) * smooth(1.8, 3.5, pc);
    });
  }
  const ship = band ? SHIPS.small : SHIPS.big;
  const waterline = band ? Math.min(rows - 2, horizon + 3) : horizon + Math.max(ship.h - 3, Math.round(seaRows * 0.26));
  const W = w * dpr;
  const H = h * dpr;
  const hy = horizon * lh;
  const bg = document.createElement("canvas");
  bg.width = W;
  bg.height = H;
  const b = bg.getContext("2d");
  if (b) {
    const sky2 = b.createLinearGradient(0, 0, 0, hy);
    sky2.addColorStop(0, "#000000");
    sky2.addColorStop(0.7, "#010505");
    sky2.addColorStop(1, "#03100f");
    b.fillStyle = sky2;
    b.fillRect(0, 0, W, hy);
    const sea = b.createLinearGradient(0, hy, 0, H);
    sea.addColorStop(0, "#031210");
    sea.addColorStop(0.25, "#010605");
    sea.addColorStop(1, "#000000");
    b.fillStyle = sea;
    b.fillRect(0, hy, W, H - hy);
    const mx = moon.x * cw;
    const my = moon.y * lh;
    const R = moon.r * lh;
    const glow = b.createRadialGradient(mx, my, R * 0.6, mx, my, R * 7);
    glow.addColorStop(0, "rgba(214, 236, 222, 0.16)");
    glow.addColorStop(0.25, "rgba(120, 180, 165, 0.06)");
    glow.addColorStop(1, "rgba(0, 0, 0, 0)");
    b.fillStyle = glow;
    b.fillRect(0, 0, W, H);
    for (let r = horizon; r < rows; r++) {
      const u = (r - horizon + 0.5) / seaRows;
      const half = moon.r * aspect * cw * (0.8 + 3 * u);
      const a = 0.09 * (1 - 0.55 * u);
      const g = b.createLinearGradient(mx - half, 0, mx + half, 0);
      g.addColorStop(0, "rgba(200, 230, 215, 0)");
      g.addColorStop(0.5, `rgba(200, 230, 215, ${a})`);
      g.addColorStop(1, "rgba(200, 230, 215, 0)");
      b.fillStyle = g;
      b.fillRect(mx - half, r * lh, half * 2, lh);
    }
  }
  sky[lamp.row * cols + lamp.col] = 0;
  if (b) {
    for (let k = 0; k < horizon * cols; k++) {
      if (sky[k] <= 32) continue;
      atlas.draw(b, sky[k], skyColor[k], k % cols * cw, Math.floor(k / cols) * lh);
      opaque[k] = 1;
    }
  }
  return {
    w,
    h,
    dpr,
    cols,
    rows,
    cw,
    lh,
    band,
    horizon,
    seaRows,
    atlas,
    opaque,
    stars: new Float32Array(starList),
    moon,
    lamp,
    headland: hw,
    ship,
    waterline,
    rowZ,
    rowU,
    rowGain,
    kScale,
    bg,
    code: new Uint8Array(n),
    color: new Uint16Array(n)
  };
}
function beamAt(theta) {
  const side = Math.sin(theta);
  const facing = Math.cos(theta);
  const toward = Math.max(0, facing);
  const vy = 0.16 + 0.62 * toward - 0.08 * Math.max(0, -facing);
  const len = Math.hypot(side, vy) || 1;
  return {
    ax: side / len,
    ay: vy / len,
    len: 0.35 + 0.65 * Math.abs(side),
    tan: 0.075 + 0.22 * toward * toward,
    power: 0.5 + 0.5 * toward,
    glare: Math.pow(toward, 6)
  };
}
function render(ctx, s, still, time, P) {
  const { cols, rows, cw, lh, horizon, seaRows, atlas, ship, waterline } = s;
  const t = time + 12;
  const theta = still ? 1.22 : Math.PI * 1.1 - t / BEAM_PERIOD * Math.PI * 2;
  const beam = beamAt(theta);
  beam.len *= cols * cw * 1.25;
  const shipFrac = P.shipFrac != null ? P.shipFrac : (t / SHIP_PERIOD + 0.32) % 1;
  const shipX = P.ship === false ? cols + 999 : -ship.w - 2 + shipFrac * (cols + ship.w + 4);
  const shipCol = Math.floor(shipX);
  const shipTop = waterline - ship.h + 1;
  const stern = shipX + ship.spans[ship.h - 2][0];
  const bow = shipX + ship.spans[ship.h - 3][1];
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalCompositeOperation = "source-over";
  ctx.globalAlpha = 1;
  ctx.drawImage(s.bg, 0, 0);
  const lx = (s.lamp.col + 0.5) * cw;
  const ly = (s.lamp.row + 0.5) * lh;
  ctx.globalCompositeOperation = "lighter";
  {
    const L = beam.len;
    const ex = lx + beam.ax * L;
    const ey = ly + beam.ay * L;
    const nx = -beam.ay * L * beam.tan;
    const ny = beam.ax * L * beam.tan;
    const g = ctx.createLinearGradient(lx, ly, ex, ey);
    g.addColorStop(0, `rgba(249, 149, 16, ${0.26 * beam.power})`);
    g.addColorStop(0.45, `rgba(249, 149, 16, ${0.1 * beam.power})`);
    g.addColorStop(1, "rgba(249, 149, 16, 0)");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(lx, ly);
    ctx.lineTo(ex + nx, ey + ny);
    ctx.lineTo(ex - nx, ey - ny);
    ctx.closePath();
    ctx.fill();
    const R = lh * (1.5 + 7 * beam.glare);
    const flare = ctx.createRadialGradient(lx, ly, 0, lx, ly, R);
    flare.addColorStop(0, `rgba(255, 196, 110, ${0.35 + 0.4 * beam.glare})`);
    flare.addColorStop(1, "rgba(249, 149, 16, 0)");
    ctx.fillStyle = flare;
    ctx.fillRect(lx - R, ly - R, R * 2, R * 2);
  }
  ctx.globalCompositeOperation = "source-over";
  const out = s.code;
  const col = s.color;
  out.fill(0);
  const stars = s.stars;
  for (let i = 0; i < stars.length; i += 4) {
    const k = stars[i];
    if (s.opaque[k]) continue;
    const tw = 0.72 + 0.28 * Math.sin(t * stars[i + 3] + stars[i + 2]);
    const v = stars[i + 1] * tw;
    const lvl = Math.round(v * (LEVELS.sky - 1));
    if (lvl < 1) continue;
    out[k] = v > 0.7 ? 42 : v > 0.5 ? 43 : v > 0.2 ? 46 : 96;
    col[k] = FAMILY.sky + lvl;
  }
  const tanA = beam.tan;
  const reachMin = s.lh * 2;
  const aspect = lh / cw;
  for (let r = 0; r < horizon; r++) {
    const py = (r + 0.5) * lh - ly;
    const mistRow = horizon - r <= (s.band ? 1 : 3) ? horizon - r === 1 ? 1 : horizon - r === 2 ? 0.6 : 0.3 : 0;
    for (let c = 0; c < cols; c++) {
      const k = r * cols + c;
      if (s.opaque[k]) continue;
      const px = (c + 0.5) * cw - lx;
      const along = px * beam.ax + py * beam.ay;
      let haze = 0;
      if (along > 0) {
        const perp = Math.abs(px * beam.ay - py * beam.ax);
        const half2 = along * tanA + reachMin;
        const q = perp / half2;
        if (q < 2.2) haze = Math.exp(-q * q * 1.6) * beam.power * (1 - smooth(beam.len * 0.55, beam.len, along)) / (1 + along / (cols * cw * 0.7));
      }
      const dist = Math.hypot(px, py);
      haze = Math.max(haze, beam.glare * Math.exp(-dist / (lh * 4)));
      if (haze > 0.03) {
        const dust = 0.55 + 0.45 * noise(c * 0.35 + t * 0.25, r * 0.7 - t * 0.1);
        const hv = haze * dust;
        const dither = hash(c * 5 + 1, r * 9 + 4);
        if (hv > 0.05 && dither < hv * 3.8) {
          const lvl = Math.min(LEVELS.beam - 1, Math.round(hv * 12) + 1);
          const prev = out[k] ? col[k] : -1;
          if (prev < 0 || prev < FAMILY.beam || lvl > 4) {
            out[k] = code(HAZE_RAMP, Math.round(hv * 9));
            col[k] = FAMILY.beam + lvl;
            continue;
          }
        }
      }
      if (mistRow > 0 && !out[k]) {
        const m = mistRow * smooth(0.42, 0.85, noise(c * 0.07 - t * 0.12, r * 0.8 + 3.1));
        if (m > 0.12) {
          out[k] = m > 0.55 ? 126 : m > 0.3 ? 45 : 46;
          col[k] = FAMILY.mist + Math.min(LEVELS.mist - 1, Math.round(m * 4));
        }
      }
    }
  }
  {
    const k = s.lamp.row * cols + s.lamp.col;
    out[k] = 64;
    col[k] = FAMILY.beam + Math.min(LEVELS.beam - 1, 9 + Math.round(4 * beam.glare + 2 * beam.power));
  }
  const mx = s.moon.x;
  const moonW = s.moon.r * aspect;
  const bob = still ? 0 : Math.sin(t * 0.85) * 0.2 + Math.sin(t * 1.6 + 1.3) * 0.07;
  const pitch = still ? 0 : Math.sin(t * 0.85 - 1.2) * 0.16;
  const wakeLen = ship.w * 1.1;
  const nW = WAVES.length;
  const ks = s.kScale;
  const dsx = cw / (seaRows * lh);
  const half = cols / 2;
  const lampCx = s.lamp.col + 0.5;
  for (let r = horizon; r < rows; r++) {
    const u = s.rowU[r];
    const Z = s.rowZ[r];
    const band = Math.min(W_DEPTHS - 1, Math.floor(u * W_DEPTHS));
    const env = (0.42 + 0.68 * Math.pow(u, 0.7)) * (s.band ? 1.3 : 1) * (1 - 0.45 * (P.calm || 0));
    const partW = (P.part || 0) * (2 + (r - horizon) * 1.5);
    const sheen = Math.exp(-(r - horizon) / 1.6) * 0.32;
    const colW = moonW * (0.55 + 2.4 * u);
    const shipRow = r - shipTop;
    const inShip = shipRow >= 0 && shipRow < ship.h;
    const m0 = inShip ? shipCol + ship.spans[shipRow][0] + 1 : 0;
    const m1 = inShip ? shipCol + ship.spans[shipRow][1] - 1 : -1;
    const dyW = r - waterline;
    const nearShip = dyW > -4 && dyW < 9;
    const py = (r + 0.5) * lh - ly;
    for (let c = 0; c < cols; c++) {
      if (c >= m0 && c <= m1) continue;
      const partD = Math.abs(c + 0.5 - half);
      if (partW > 0.05 && partD < partW) continue;
      const sx = (c + 0.5 - half) * dsx;
      const X = sx * Z;
      let hgt = 0;
      let crest = 0;
      let slope = 0;
      let slopeN = 0;
      for (let i = 0; i < nW; i++) {
        const g = s.rowGain[r * nW + i];
        if (g < 0.02) continue;
        const wv = WAVES[i];
        const ph = (wv.kz * Z + wv.kx * X) * ks + wv.w * t + wv.p;
        const cs = Math.cos(ph);
        const a = wv.a * g;
        hgt += a * cs;
        const cr = (1 + cs) * 0.5;
        crest += a * cr * cr * cr * cr;
        slope += a * (i + 1) * Math.sin(ph);
        slopeN += a * (i + 1);
      }
      const hn = hgt / AMP;
      crest /= AMP;
      const fine = (1 - s.rowGain[r * nW]) * 0.55;
      const streak = fine > 0.02 ? fine * smooth(0.35, 0.95, noise(c * 0.19 + t * 0.35 + r * 3.7, r * 1.3 - t * 0.05)) : 0;
      let lit = (0.03 + 1.25 * crest + 0.14 * Math.max(0, hn) + streak + sheen * (0.5 + 0.5 * noise(c * 0.3 - t * 0.2, r))) * env;
      let foam = 0;
      if (hn > 0.42) foam = smooth(0.42, 0.75, hn) * smooth(0.6, 0.9, noise(c * 0.45 + 0.3 * t, Z * 9 - t * 0.2)) * (0.3 + 0.5 * u);
      if (partW > 0.05 && partD < partW + 3) foam = Math.max(foam, (1 - (partD - partW) / 3) * Math.min(1, P.part * 1.4) * (0.55 + 0.45 * noise(c * 0.7 + t * 1.3, r * 0.9 - t)));
      if (c < s.headland + 2 && r - horizon < 2) foam = Math.max(foam, smooth(0.5, 0.9, noise(c * 0.6 + t * 0.9, t * 0.7 + r)) * (1 - c / (s.headland + 2)) * 0.9);
      if (c < s.headland && r - horizon < 4) lit *= 0.45 + 0.15 * (r - horizon);
      const sl = slopeN > 0 ? slope / slopeN : 0;
      const sparkle = smooth(0.5, 0.92, noise(c * 0.85 + t * 1.1, r * 1.9 - t * 1.6));
      const glint = clamp01(0.65 * smooth(-0.25, 0.7, sl) + 0.6 * sparkle + streak);
      const dxm = (c + 0.5 - mx) / colW;
      const M = Math.exp(-dxm * dxm) * (0.16 + 0.85 * glint) * (0.78 + 0.3 * (1 - u));
      let B = 0;
      const px = (c + 0.5) * cw - lx;
      const along = px * beam.ax + py * beam.ay;
      if (along > 0) {
        const perp = Math.abs(px * beam.ay - py * beam.ax);
        const q = perp / (along * tanA + reachMin);
        if (q < 2.2) B = Math.exp(-q * q * 1.6) * beam.power * (1 - smooth(beam.len * 0.55, beam.len, along)) * (0.25 + 0.9 * (crest * 2 + glint * 0.5));
      }
      if (beam.glare > 0.01) {
        const dl = (c + 0.5 - lampCx) / (1.2 + 6 * u);
        B = Math.max(B, beam.glare * Math.exp(-dl * dl) * (0.2 + glint) * 0.9);
      }
      if (nearShip) {
        const dx = stern - c;
        if (dx > -1 && dx < wakeLen) {
          const f = Math.exp(-Math.max(0, dx) / (wakeLen * 0.45));
          const up = -dx * 0.09;
          const dn = 0.6 + dx * 0.17;
          const wdt = 0.55 + dx * 0.02;
          const arm = Math.max(Math.exp(-(((dyW - up) / wdt) ** 2)), Math.exp(-(((dyW - dn) / wdt) ** 2)));
          const trail = Math.exp(-(((dyW - 0.6) / 0.9) ** 2)) * Math.exp(-Math.max(0, dx) / (wakeLen * 0.25));
          const tex = 0.45 + 0.55 * noise(c * 0.6 - t * 0.3, r * 1.4 + t * 0.5);
          foam = Math.max(foam, (arm * 0.55 + trail * 0.6) * f * tex);
        }
        const db = c - bow;
        if (db > -2 && db < 3 && dyW >= -1 && dyW <= 1) foam = Math.max(foam, (0.5 + 0.4 * Math.sin(t * 1.7)) * (1 - Math.abs(db) / 3) * (0.6 + 0.4 * noise(c + t * 2, r)));
        if (dyW > 0 && dyW < 6) {
          for (const lc of ship.lights) {
            const d = c - (shipX + lc + 0.5);
            if (d > -1 && d < 1) {
              const fl = smooth(0.25, 0.8, noise(c * 1.3, r * 0.9 - t * 2.2));
              B = Math.max(B, (1 - Math.abs(d)) * Math.exp(-(dyW - 1) / 2.2) * fl * 0.85);
            }
          }
        }
      }
      const k = r * cols + c;
      const water = lit + foam * 0.85;
      if (M > water && M >= B && M > 0.08) {
        const v = clamp01(M + water * 0.25);
        const lvl = Math.round(Math.pow(v, 0.8) * (LEVELS.moon - 1));
        if (lvl < 2) continue;
        out[k] = code(GLITTER_RAMP, Math.round(v * (GLITTER_RAMP.length - 1)));
        col[k] = FAMILY.moon + lvl;
      } else if (B > water * 0.6 && B > 0.07) {
        const v = clamp01(B + water * 0.3);
        const lvl = Math.round(Math.pow(v, 0.85) * (LEVELS.beam - 1));
        if (lvl < 2) continue;
        out[k] = code(GLITTER_RAMP, Math.round(v * (GLITTER_RAMP.length - 1)));
        col[k] = FAMILY.beam + lvl;
      } else {
        const v = clamp01(water + M * 0.3 + B * 0.3);
        const lvl = Math.round(Math.pow(v, 0.9) * (W_LEVELS - 1));
        if (lvl < 2) continue;
        out[k] = code(WATER_RAMP, lvl);
        col[k] = FAMILY.water + band * W_LEVELS + lvl;
      }
    }
  }
  for (let r = 0; r < rows; r++) {
    const y = r * lh;
    const base = r * cols;
    for (let c = 0; c < cols; c++) {
      const ch = out[base + c];
      if (ch > 32) atlas.draw(ctx, ch, col[base + c], c * cw, y);
    }
  }
  if (shipX < cols && shipX + ship.w > 0) {
    const x0 = Math.round(shipX * cw);
    const y0 = shipTop * lh;
    const lift = (j) => Math.round((bob + pitch * (j / ship.w * 2 - 1)) * lh);
    ctx.fillStyle = "#000";
    for (let j = 0; j < ship.w; j++) {
      let top = -1;
      let bottom = -1;
      for (let i = 0; i < ship.h; i++) if (j >= ship.spans[i][0] && j <= ship.spans[i][1] && (top >= 0 || ship.rows[i][j] !== " ")) {
        if (top < 0) top = i;
        bottom = i;
      }
      if (top < 0) continue;
      ctx.fillRect(x0 + j * cw, y0 + top * lh + lift(j), cw, (bottom - top + 1) * lh);
    }
    for (let i = 0; i < ship.h; i++) {
      const line = ship.rows[i];
      for (let j = 0; j < line.length; j++) {
        const color = ship.color[i * ship.w + j];
        if (color < 0) continue;
        let ch = line.charCodeAt(j);
        if (ch === 42 && i === 0 && !still && Math.sin(t * 2.4) < -0.55) ch = 46;
        atlas.draw(ctx, ch, color, x0 + j * cw, y0 + i * lh + lift(j));
      }
    }
  }
}

  function create(canvas, opts) {
    opts = opts || {};
    const w = canvas.width;
    const h = canvas.height;
    const ctx = canvas.getContext("2d", { alpha: false });
    const scene = makeScene(w, h, 1, opts.fontPx, opts.horizon);
    return {
      scene,
      draw(time, params) {
        render(ctx, scene, false, time, params || {});
      },
    };
  }

  window.PorthmosSea = { create, hash, noise };
})();
