import { parse } from '@lumen/parser'
import { assignStableSids } from '@lumen/core-ir'
import { run } from '@lumen/runner'

function ensure(cond: boolean, msg: string) { if (!cond) { console.error(msg); process.exit(1) } }

const src = `
let a = stdlib.trim("  hi  ")
let parts = stdlib.split("a,b,c", ",")
let joined = stdlib.join(parts, ";")
let rep = stdlib.replace("foo bar", "bar", "baz")
[a, parts, joined, rep]
`.trim()

const ast = parse(src)
assignStableSids(ast)
const res = run(ast)
const [a, parts, joined, rep] = res.value as any[]
ensure(a === 'hi', 'trim failed')
ensure(JSON.stringify(parts) === JSON.stringify(['a','b','c']), 'split failed')
ensure(joined === 'a;b;c', 'join failed')
ensure(rep === 'foo baz', 'replace failed')
console.log('text-helpers OK')