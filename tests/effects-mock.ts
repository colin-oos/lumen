import fs from 'fs'
import path from 'path'
import { parse } from '@lumen/parser'
import { assignStableSids } from '@lumen/core-ir'
import { run } from '@lumen/runner'

const src = `fn netFetch(url) raises net = net.get(url)
fn now() raises time = time.now()
let a = netFetch("u")
let b = now()
[ a, b ]`
const ast = parse(src)
assignStableSids(ast)
const res = run(ast, { mockEffects: true })
const val = res.value as any
if (!Array.isArray(val) || val[0] !== 'MOCK:GET u' || val[1] !== 0) {
  console.error('effects-mock failed')
  process.exit(1)
}
console.log('effects-mock OK')