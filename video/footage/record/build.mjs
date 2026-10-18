import { copyFileSync, existsSync, readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { join } from 'node:path'
import { FOOTAGE, TAKES } from './lib.mjs'

// Picks the newest take of each clip (or the one named in takes/selected.json), copies it to footage/<clip>.mp4,
// joins the R8 shots into R8.mp4, then writes manifest.json and contact-sheet.png.
const FONT = '/usr/share/fonts/TTF/JetBrainsMonoNerdFont-Regular.ttf'
const index = readFileSync(join(TAKES, 'index.jsonl'), 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l))
const selected = existsSync(join(TAKES, 'selected.json')) ? JSON.parse(readFileSync(join(TAKES, 'selected.json'), 'utf8')) : {}
const latest = {}
for (const t of index) {
  if (!existsSync(t.file)) continue
  if (selected[t.name] ? t.file.includes(selected[t.name]) : true) latest[t.name] = t
}

const probe = (f) => Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', f]).toString().trim())
const clips = {}
for (const [name, t] of Object.entries(latest)) {
  if (name.startsWith('R8-')) continue
  const out = join(FOOTAGE, `${name}.mp4`)
  copyFileSync(t.file, out)
  clips[name] = { file: `${name}.mp4`, take: t.file.replace(`${FOOTAGE}/`, ''), duration: +probe(out).toFixed(2), fps: 30, marks: t.marks, ...(t.reply ? { reply: t.reply } : {}), ...(t.notes ? { notes: t.notes } : {}) }
}

const r8 = ['R8-treasury', 'R8-risk', 'R8-audit'].filter((n) => latest[n])
if (r8.length) {
  const list = join(TAKES, 'r8-concat.txt')
  writeFileSync(list, r8.map((n) => `file '${latest[n].file}'`).join('\n'))
  const out = join(FOOTAGE, 'R8.mp4')
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', '-movflags', '+faststart', out])
  rmSync(list)
  const marks = {}
  let offset = 0
  for (const n of r8) {
    const short = n.replace('R8-', '')
    marks[`${short}Start`] = +offset.toFixed(2)
    for (const [k, v] of Object.entries(latest[n].marks)) if (k !== 'start') marks[`${short}.${k}`] = +(offset + v).toFixed(2)
    offset += probe(latest[n].file)
  }
  clips.R8 = { file: 'R8.mp4', takes: r8.map((n) => latest[n].file.replace(`${FOOTAGE}/`, '')), duration: +probe(out).toFixed(2), fps: 30, marks }
}

const order = Object.keys(clips).sort()
writeFileSync(join(FOOTAGE, 'manifest.json'), JSON.stringify({ resolution: '1920x1080', fps: 30, codec: 'H.264 CRF 16 yuv420p', clips: Object.fromEntries(order.map((k) => [k, clips[k]])) }, null, 2) + '\n')

const tmp = join(TAKES, 'sheet')
rmSync(tmp, { recursive: true, force: true })
mkdirSync(tmp)
const rows = []
for (const name of order) {
  const c = clips[name]
  const every = c.duration > 60 ? 6 : 3
  const n = Math.max(1, Math.ceil(c.duration / every))
  const row = join(tmp, `${name}.png`)
  const label = `drawtext=fontfile=${FONT}:text='${name}  %{pts\\:hms}':x=8:y=8:fontsize=18:fontcolor=white:box=1:boxcolor=black@0.7:boxborderw=5`
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', join(FOOTAGE, c.file), '-vf', `fps=1/${every},scale=384:216,${label},tile=8x${Math.ceil(n / 8)}:padding=4:color=0x07110D`, '-frames:v', '1', row])
  rows.push(row)
}
const args = ['-y', '-loglevel', 'error']
for (const r of rows) args.push('-i', r)
args.push('-filter_complex', rows.length > 1 ? `${rows.map((_, i) => `[${i}]`).join('')}vstack=inputs=${rows.length}` : '[0]copy', join(FOOTAGE, 'contact-sheet.png'))
execFileSync('ffmpeg', args)
rmSync(tmp, { recursive: true, force: true })
console.log(JSON.stringify(Object.fromEntries(order.map((k) => [k, clips[k].duration]))))
