import { execSync } from 'child_process'
import path from 'path'

function run(cmd: string): string {
  return execSync(cmd, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] })
}

const example = path.resolve(__dirname, '../examples/actors/adt_counter.lum')
const out = run(`node ${path.resolve(__dirname, '../packages/cli/dist/index.js')} check ${example}`)
if (!/OK/.test(out)) {
  console.error('adt-check failed')
  process.exit(1)
}
console.log('adt-check OK')