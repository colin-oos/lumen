import { parse } from '@lumen/parser'
import { assignStableSids } from '@lumen/core-ir'
import { run } from '@lumen/runner'
import { execSync } from 'child_process'
import path from 'path'

function ensure(cond: boolean, msg: string) { if (!cond) { console.error(msg); process.exit(1) } }

const tmpFile = path.resolve(__dirname, '../examples/loops/loops_with_stdlib.lum')

const out1 = execSync(`node packages/cli/dist/index.js trace ${tmpFile} --hash-only --seed A`).toString().trim()
const out2 = execSync(`node packages/cli/dist/index.js trace ${tmpFile} --hash-only --seed B`).toString().trim()
ensure(out1 !== out2, 'trace seed did not affect hash')
console.log('trace-seed OK')