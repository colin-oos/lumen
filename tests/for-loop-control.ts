import { parse } from '@lumen/parser'
import { assignStableSids } from '@lumen/core-ir'
import { run } from '@lumen/runner'

function ensure(cond: boolean, msg: string) { if (!cond) { console.error(msg); process.exit(1) } }

// for-loop break
{
  const src = `
let acc = 0;
for x in [1,2,3,4,5] { acc = acc + x; if x == 4 then { break } else acc = acc; }
acc
`.trim()
  const ast = parse(src)
  assignStableSids(ast)
  const res = run(ast)
  ensure(res.value === 1 + 2 + 3 + 4, 'for break failed')
}

// for-loop continue
{
  const src = `
let acc = 0;
for x in [1,2,3,4,5] { if x == 3 then { continue } else acc = acc + x; }
acc
`.trim()
  const ast = parse(src)
  assignStableSids(ast)
  const res = run(ast)
  ensure(res.value === 1 + 2 + 4 + 5, 'for continue failed')
}

console.log('for-loop-control OK')