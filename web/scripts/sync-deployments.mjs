import { readdirSync, mkdirSync, copyFileSync, existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const source = resolve(here, '../../deployments')
const target = resolve(here, '../public/deployments')

mkdirSync(target, { recursive: true })
if (!existsSync(source)) {
  console.log('[deployments] no ../deployments folder; replay fixtures only')
  process.exit(0)
}
const files = readdirSync(source).filter((f) => /^\d+\.json$/.test(f))
for (const f of files) copyFileSync(join(source, f), join(target, f))
console.log(files.length ? `[deployments] copied ${files.join(', ')}` : '[deployments] none yet; replay fixtures only')
