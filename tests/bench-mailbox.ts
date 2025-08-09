import { parse } from '@lumen/parser'
import { assignStableSids } from '@lumen/core-ir'
import { run } from '@lumen/runner'

const N = 1000
const src = `
actor Counter(msg) = 0
let a = spawn Counter
` + Array.from({length: N}).map((_,i)=>`send a, ${i}`).join('\n') + `
0
`

const ast = parse(src)
assignStableSids(ast)
const t0 = Date.now()
const res = run(ast)
const t1 = Date.now()
console.log(`bench-mailbox: ${N} msgs in ${t1 - t0}ms`)