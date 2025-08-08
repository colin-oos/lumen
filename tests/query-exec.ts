import { execSync } from 'child_process'
import path from 'path'
import fs from 'fs'
import { parse } from '@lumen/parser'
import { assignStableSids } from '@lumen/core-ir'
import { run } from '@lumen/runner'

const example = path.resolve(__dirname, '../examples/newproj/src/main.lum')
const src = fs.readFileSync(example, 'utf8')
const ast = parse(src)
assignStableSids(ast)
const res = run(ast)
// query name is 'active' and should be bound in env only via side effects in run result? we only get value+trace.
// Instead, we re-run by adding a final expression to access the query by name.

const src2 = src + '\nlet out = active\n'
const ast2 = parse(src2)
assignStableSids(ast2)
const res2 = run(ast2)
if (!Array.isArray(res2.value) || res2.value.length !== 2) {
  console.error('query-exec failed')
  process.exit(1)
}
console.log('query-exec OK')