import { parse } from '@lumen/parser'
import { assignStableSids } from '@lumen/core-ir'
import { run } from '@lumen/runner'

function ensure(cond: boolean, msg: string) { if (!cond) { console.error(msg); process.exit(1) } }

const src = `
let a = stdlib.trim("  hi  ")
let parts = stdlib.split("a,b,c", ",")
let joined = stdlib.join(parts, ";")
let rep = stdlib.replace("foo bar", "bar", "baz")
let pl = stdlib.padLeft("7", 3, "0")
let pr = stdlib.padRight("7", 3, "0")
let cat = stdlib.concat([1],[2])
let flat = stdlib.flatten([[1],[2,3]])
[a, parts, joined, rep, pl, pr, cat, flat]
`.trim()

const ast = parse(src)
assignStableSids(ast)
const res = run(ast)
const [a, parts, joined, rep, pl, pr, cat, flat] = res.value as any[]
ensure(a === 'hi', 'trim failed')
ensure(JSON.stringify(parts) === JSON.stringify(['a','b','c']), 'split failed')
ensure(joined === 'a;b;c', 'join failed')
ensure(rep === 'foo baz', 'replace failed')
ensure(pl === '007', 'padLeft failed')
ensure(pr === '700', 'padRight failed')
ensure(JSON.stringify(cat) === JSON.stringify([1,2]), 'concat failed')
ensure(JSON.stringify(flat) === JSON.stringify([1,2,3]), 'flatten failed')
console.log('text-helpers OK')