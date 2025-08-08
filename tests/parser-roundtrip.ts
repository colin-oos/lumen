import fs from 'fs'
import path from 'path'
import { parse } from '@lumen/parser'
import { format } from '@lumen/fmt'
import { assignStableSids } from '@lumen/core-ir'

const file = path.resolve(__dirname, '../examples/hello/main.lum')
const src = fs.readFileSync(file, 'utf8')
const ast = parse(src)
assignStableSids(ast)
const out = format(ast)
const ast2 = parse(out)
assignStableSids(ast2)

function structurallySimilar(a: any, b: any): boolean {
  if (a?.kind !== b?.kind) return false
  if (a.kind === 'Program') {
    if (a.decls.length !== b.decls.length) return false
    for (let i = 0; i < a.decls.length; i++) if (!structurallySimilar(a.decls[i], b.decls[i])) return false
    return true
  }
  const keysA = Object.keys(a).filter(k => k !== 'sid')
  const keysB = Object.keys(b).filter(k => k !== 'sid')
  if (keysA.length !== keysB.length) return false
  for (const k of keysA) {
    const va = a[k], vb = b[k]
    if (Array.isArray(va) && Array.isArray(vb)) {
      if (va.length !== vb.length) return false
      for (let i = 0; i < va.length; i++) if (!structurallySimilar(va[i], vb[i])) return false
    } else if (va && typeof va === 'object' && vb && typeof vb === 'object') {
      if (!structurallySimilar(va, vb)) return false
    } else if (va !== vb) return false
  }
  return true
}

if (!structurallySimilar(ast, ast2)) {
  console.error('parser-roundtrip failed')
  process.exit(1)
}
// SID stability spot check: kind sequences identical and root SIDs equal after assignment
if (ast.kind === 'Program' && ast2.kind === 'Program') {
  if (ast.sid !== ast2.sid) {
    console.error('sid-stability failed')
    process.exit(1)
  }
}
console.log('parser-roundtrip OK')


