import { execSync } from 'child_process'
import path from 'path'

const file = path.resolve(__dirname, '../examples/data/sqlite_items.lum')
const out = execSync(`node ${path.resolve(__dirname, '../packages/cli/dist/index.js')} emit ${file} --ts`, { encoding: 'utf8' })
if (!/interface\s+Item/.test(out) || !/type\s+names\s+=\s+Array<Pick<Item, 'name'>>/.test(out)) {
  console.error('emit-types failed')
  process.exit(1)
}
console.log('emit-types OK')