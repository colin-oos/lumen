import { parse } from '@lumen/parser'
import { assignStableSids } from '@lumen/core-ir'
import { run } from '@lumen/runner'
import fs from 'fs'
import path from 'path'

function ensure(cond: boolean, msg: string) {
  if (!cond) { console.error(msg); process.exit(1) }
}

// Loop semantics
{
  const src = `
let sum = 0
let i = 0
while i < 5 { i = i + 1; sum = sum + i; }
sum
`.trim()
  const ast = parse(src)
  assignStableSids(ast)
  const res = run(ast)
  ensure(res.value === 15, 'while loop failed')
}

// For over tuple
{
  const src = `
let acc = 0
for x in [1,2,3] { acc = acc + x; }
acc
`.trim()
  const ast = parse(src)
  assignStableSids(ast)
  const res = run(ast)
  ensure(res.value === 6, 'for loop failed')
}

// stdlib map/filter/reduce
{
  const stdlibPath = path.resolve(__dirname, '../examples/libs/stdlib.lum')
  const stdlibSrc = fs.readFileSync(stdlibPath, 'utf8')
  const stdAst = parse(stdlibSrc)
  assignStableSids(stdAst)
  const src = `
module test
let xs = [1,2,3,4]
let ys = stdlib.map(xs, fn(x: Int): Int = x + 1)
let zs = stdlib.filter(ys, fn(x: Int): Bool = x % 2 == 0)
let s = stdlib.reduce(zs, 0, fn(a: Int, x: Int): Int = a + x)
s
`.trim()
  const prog = parse(src) as any
  const merged = { kind: 'Program', sid: 'prog:merged', decls: [ ...(stdAst as any).decls, ...prog.decls ] }
  assignStableSids(merged as any)
  const res = run(merged as any)
  ensure(res.value === 2 + 4, 'stdlib map/filter/reduce failed')
}

console.log('loops-stdlib OK')