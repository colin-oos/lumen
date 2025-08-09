import { execSync } from 'child_process'
import path from 'path'

const file = path.resolve(__dirname, '../examples/actors/adder.lum')
const seeds = ['A','B','C','D','E']
const outs = seeds.map(s => JSON.parse(execSync(`node packages/cli/dist/index.js trace ${file} --seed ${s}`).toString()))
const shapes = outs.map(o => o.trace.map((t:any)=>t.note).join('|'))
const allSame = shapes.every(s => s === shapes[0])
if (!allSame) { console.error('property-trace failed'); process.exit(1) }
console.log('property-trace OK')