import { execSync } from 'child_process'
import path from 'path'

const file = path.resolve(__dirname, '../examples/actors/adder.lum')
const out = execSync(`node ${path.resolve(__dirname, '../packages/cli/dist/index.js')} trace ${file} --no-cache`, { encoding: 'utf8' })
const start = out.indexOf('{')
const end = out.lastIndexOf('}')
const jsonStr = start >= 0 && end > start ? out.slice(start, end + 1) : '{}'
const json = JSON.parse(jsonStr)
if (!/^t:/.test(json.hash || '')) {
  console.error('adder-trace failed')
  process.exit(1)
}
console.log('adder-trace OK', json.hash)