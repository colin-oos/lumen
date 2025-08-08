import { spawn } from 'child_process'
import path from 'path'

function runServeOnce(req: any): Promise<any> {
  return new Promise((resolve, reject) => {
    const proc = spawn('node', [path.resolve(__dirname, '../packages/cli/dist/index.js'), 'serve'], { cwd: path.resolve(__dirname, '..') })
    let buffer = ''
    proc.stdout.setEncoding('utf8')
    proc.stdout.on('data', chunk => {
      buffer += chunk
      const idx = buffer.indexOf('\n')
      if (idx >= 0) {
        const line = buffer.slice(0, idx).trim()
        try { resolve(JSON.parse(line)); proc.kill() } catch { reject(new Error('bad json')) }
      }
    })
    proc.stderr.on('data', d => {})
    proc.on('error', reject)
    proc.stdin.write(JSON.stringify(req) + '\n')
  })
}

async function main() {
  const file = path.resolve(__dirname, '../examples/data/sqlite_query.lum')
  const res = await runServeOnce({ action: 'symbols', file })
  if (!res?.ok || !Array.isArray(res.symbols)) {
    console.error('serve-symbols failed: no response')
    process.exit(1)
  }
  const kinds = res.symbols.map((s: any) => s.kind)
  if (!kinds.includes('store') || !kinds.includes('query')) {
    console.error('serve-symbols failed: missing store or query')
    process.exit(1)
  }
  console.log('serve-symbols OK')
}

main().catch(e => { console.error(e); process.exit(1) })