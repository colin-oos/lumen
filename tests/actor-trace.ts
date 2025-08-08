import { execSync } from 'child_process'
import path from 'path'

function trace(p: string): string {
  const out = execSync(`node ${path.resolve(__dirname, '../packages/cli/dist/index.js')} trace ${p} --no-cache`, { encoding: 'utf8' })
  const start = out.indexOf('{')
  const end = out.lastIndexOf('}')
  const jsonStr = start >= 0 && end > start ? out.slice(start, end + 1) : '{}'
  const json = JSON.parse(jsonStr)
  return json.hash as string
}

const router = path.resolve(__dirname, '../examples/actors/router_adt.lum')
const supervisor = path.resolve(__dirname, '../examples/actors/supervisor.lum')

const routerHash = trace(router)
const supervisorHash = trace(supervisor)

if (!/^t:/.test(routerHash) || !/^t:/.test(supervisorHash)) {
  console.error('actor-trace invalid hash format')
  process.exit(1)
}

console.log('actor-trace OK', routerHash, supervisorHash)