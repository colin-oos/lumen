import { execSync } from 'child_process'
import fs from 'fs'
import path from 'path'

const file = path.resolve(__dirname, '../examples/data/sqlite_items.lum')
const ok = execSync(`node ${path.resolve(__dirname, '../packages/cli/dist/index.js')} check ${file} --json`, { encoding: 'utf8' })
const okJson = JSON.parse(ok)
if (!okJson.ok) { console.error('sqlite-projection failed: ok=false'); process.exit(1) }

// Write a bad projection file
const bad = path.resolve(__dirname, '../examples/data/sqlite_items_bad.lum')
fs.writeFileSync(bad, `schema Item {\n id: Int\n name: Text\n}\n\nstore items : Item = "sqlite:./examples/data/items.sqlite3:items"\n\nquery bad from items select missing\n`, 'utf8')

let out = ''
try {
  out = execSync(`node ${path.resolve(__dirname, '../packages/cli/dist/index.js')} check ${bad} --json`, { encoding: 'utf8' })
  const json = JSON.parse(out)
  if (json.ok) throw new Error('expected bad projection to fail')
} catch (e: any) {
  const stdout = e && e.stdout ? String(e.stdout) : out
  const json = stdout ? JSON.parse(stdout) : { ok: true }
  if (json.ok) { console.error('sqlite-projection failed to detect error'); process.exit(1) }
}
console.log('sqlite-projection OK')