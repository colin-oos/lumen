import { spawn } from 'child_process'
import path from 'path'

function runServe(requests: any[]): Promise<any[]> {
  return new Promise((resolve, reject) => {
    const proc = spawn('node', [path.resolve(__dirname, '../packages/cli/dist/index.js'), 'serve'], { cwd: path.resolve(__dirname, '..') })
    const outputs: any[] = []
    let buffer = ''
    proc.stdout.setEncoding('utf8')
    proc.stdout.on('data', chunk => {
      buffer += chunk
      let idx
      while ((idx = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, idx).trim()
        buffer = buffer.slice(idx + 1)
        if (!line) continue
        try {
          const obj = JSON.parse(line)
          outputs.push(obj)
          if (outputs.filter(x => x && x.ok).length >= requests.length) { proc.kill(); resolve(outputs) }
        } catch {}
      }
    })
    proc.stderr.on('data', d => {})
    proc.on('error', reject)
    for (const req of requests) proc.stdin.write(JSON.stringify(req) + '\n')
  })
}

async function main() {
  const base = path.resolve(__dirname, '..')
  const hoverReq = { action: 'hover', file: path.join(base, 'examples/apps/calc_app.lum'), symbol: 'option_result.Ok' }
  const diagReq = { action: 'diagnostics', file: path.join(base, 'examples/apps/calc_app.lum') }
  const out = await runServe([hoverReq, diagReq])
  const oks = out.filter(x => x && x.ok)
  if (oks.length < 2 || !oks[0]?.hover || !oks[1]?.diagnostics) {
    console.error('serve-smoke failed')
    process.exit(1)
  }
  console.log('serve-smoke OK')
}

main().catch(e => { console.error(e); process.exit(1) })