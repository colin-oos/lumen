import { parse } from '@lumen/parser'
import { assignStableSids } from '@lumen/core-ir'
import { run } from '@lumen/runner'

const N = 5000
const users = Array.from({ length: N }).map((_, i) => `{ id: ${i}, name: "User${i}" }`).join(',')
const src = `
module bench
schema User { id: Int, name: Text }
store Users: User = ""
let _load = { users: [${users}] }
// emulate store load by evaluating query with predicate that always true
query All from Users select id,name
All
`

const ast = parse(src)
assignStableSids(ast)
const t0 = Date.now()
const res = run(ast)
const t1 = Date.now()
console.log(`bench-query: ${N} rows in ${t1 - t0}ms`)