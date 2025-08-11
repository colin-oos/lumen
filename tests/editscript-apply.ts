import fs from 'fs'
import path from 'path'
import { execFileSync } from 'child_process'

const cli = (args: string[], input?: string): string => {
  const bin = path.resolve(__dirname, '..', 'packages/cli/dist/index.js')
  const out = execFileSync(process.execPath, [bin, ...args], { encoding: 'utf8', input })
  return out
}

function run(): void {
  const tmpDir = path.resolve(__dirname, '..', 'examples', 'edits')
  fs.mkdirSync(tmpDir, { recursive: true })
  const file = path.join(tmpDir, 'target.lum')
  // simple file with a function to rewrite
  fs.writeFileSync(file, 'fn hello() = 1\nhello()', 'utf8')
  // capture SIDs with check --sid-snapshot
  const snap = cli(['check', file, '--sid-snapshot', file])
  const json = JSON.parse(snap) as { nodes: Array<{ sid: string, kind: string, name?: string, file: string }> }
  const fn = json.nodes.find(n => n.kind === 'Fn' && n.name === 'hello')
  if (!fn) throw new Error('Fn hello not found in snapshot')
  // prepare editscript
  const specPath = path.join(tmpDir, 'edit.json')
  fs.writeFileSync(specPath, JSON.stringify({ targetSid: fn.sid, newBody: '2' }, null, 2), 'utf8')
  // apply
  const out = cli(['apply', specPath])
  if (!/apply OK/.test(out)) throw new Error('apply did not report success')
  // verify file changed
  const after = fs.readFileSync(file, 'utf8')
  if (!/fn hello\(\) = 2/.test(after)) throw new Error('file was not rewritten as expected')
  console.log('EditScript apply OK')
}

run()