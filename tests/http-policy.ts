import { execSync } from 'child_process'
import fs from 'fs'
import path from 'path'

const file = path.resolve(__dirname, '../examples/http/service.lum')
const policyDeny = path.resolve(__dirname, '../examples/http/lumen.deny.json')
fs.writeFileSync(policyDeny, JSON.stringify({ policy: { deny: ['http'] } }, null, 2), 'utf8')

let out = ''
try {
  out = execSync(`node ${path.resolve(__dirname, '../packages/cli/dist/index.js')} check ${file} --policy ${policyDeny} --strict-warn --json`, { encoding: 'utf8' })
  const json = JSON.parse(out)
  if (json.ok) throw new Error('expected http deny to fail')
} catch (e: any) {
  const stdout = e && e.stdout ? String(e.stdout) : out
  const json = stdout ? JSON.parse(stdout) : { ok: true }
  if (json.ok) { console.error('http-policy failed'); process.exit(1) }
}
console.log('http-policy OK')