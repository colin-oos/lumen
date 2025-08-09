import { spawnSync } from 'child_process'

const req = { action: 'rename', source: 'fn foo() = 1\nfoo()', oldName: 'foo', newName: 'bar' }
const input = JSON.stringify(req) + '\n'
const out = spawnSync('node', ['packages/cli/dist/index.js', 'serve'], { input: input, encoding: 'utf8' })
if (out.status !== 0 && out.status !== null) { console.error('serve exited', out.status, out.stderr); process.exit(1) }
const line = (out.stdout || '').trim().split('\n').find(Boolean)
if (!line) { console.error('no output'); process.exit(1) }
const res = JSON.parse(line)
if (!res.ok) { console.error('not ok', line); process.exit(1) }
const rn = res.rename
if (!rn || !rn.edits || rn.edits.length === 0) { console.error('no edits'); process.exit(1) }
if (!rn.newSource || rn.newSource.indexOf('bar') < 0) { console.error('rename failed'); process.exit(1) }
console.log('serve-rename OK')