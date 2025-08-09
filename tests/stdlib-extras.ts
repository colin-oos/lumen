import { parse } from '@lumen/parser'
import { assignStableSids } from '@lumen/core-ir'
import { run } from '@lumen/runner'
import fs from 'fs'
import path from 'path'

function ensure(cond: boolean, msg: string) { if (!cond) { console.error(msg); process.exit(1) } }

const stdlibPath = path.resolve(__dirname, '../examples/libs/stdlib.lum')
const stdlibSrc = fs.readFileSync(stdlibPath, 'utf8')
const stdAst = parse(stdlibSrc)
assignStableSids(stdAst)

const src = `
module t
let xs = [1,2,2,3]
let ys = [2,3,4]
let u = stdlib.unique(xs)
let un = stdlib.union(xs, ys)
let inter = stdlib.intersect(xs, ys)
let anyGt2 = stdlib.any(xs, fn(x: Int): Bool = x > 2)
let allPos = stdlib.all(xs, fn(x: Int): Bool = x > 0)
[u, un, inter, anyGt2, allPos]
`.trim()

const prog = parse(src) as any
const merged = { kind: 'Program', sid: 'prog:merged', decls: [ ...(stdAst as any).decls, ...prog.decls ] }
assignStableSids(merged as any)
const res = run(merged as any)
const [u, un, inter, anyGt2, allPos] = res.value as any[]
ensure(Array.isArray(u) && Array.isArray(un) && Array.isArray(inter), 'shapes failed')
ensure(anyGt2 === true, 'any failed')
ensure(allPos === true, 'all failed')
console.log('stdlib-extras OK')