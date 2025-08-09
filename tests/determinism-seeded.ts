import { execSync } from 'child_process'
import path from 'path'

function ensure(cond: boolean, msg: string) { if (!cond) { console.error(msg); process.exit(1) } }

const file = path.resolve(__dirname, '../examples/actors/adder.lum')
const outA = execSync(`node packages/cli/dist/index.js trace ${file} --seed A`).toString()
const outB = execSync(`node packages/cli/dist/index.js trace ${file} --seed B`).toString()
const a = JSON.parse(outA)
const b = JSON.parse(outB)
ensure(a.hash !== b.hash, 'seeded hashes equal unexpectedly')
ensure(JSON.stringify(a.trace.map((t:any)=>t.note)) === JSON.stringify(b.trace.map((t:any)=>t.note)), 'trace event shapes differ unexpectedly')
console.log('determinism-seeded OK')