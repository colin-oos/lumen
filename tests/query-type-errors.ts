import { execSync } from 'child_process'
import fs from 'fs'
import path from 'path'

const tmp = path.resolve(__dirname, '../examples/data/bad_query.lum')
fs.writeFileSync(tmp, `schema User {\n  id: Int\n  name: Text\n}\n\nstore users : User = "./examples/newproj/users.json"\n\nquery bad from users where id + name select id\n`, 'utf8')

let out = ''
try {
  out = execSync(`node ${path.resolve(__dirname, '../packages/cli/dist/index.js')} check ${tmp} --json`, { encoding: 'utf8' })
  // if it didn't throw, ok must be false
  const json = JSON.parse(out)
  if (json.ok !== false) throw new Error('expected check to fail')
} catch (e: any) {
  const stdout = e && e.stdout ? String(e.stdout) : out
  const json = stdout ? JSON.parse(stdout) : { ok: true }
  if (json.ok) {
    console.error('query-type-errors failed: ok=true')
    process.exit(1)
  }
}
console.log('query-type-errors OK')