#!/usr/bin/env node
import fs from 'fs'
import path from 'path'
import { parse } from '@lumen/parser'
import { format } from '@lumen/fmt'
import { assignStableSids } from '@lumen/core-ir'
import { run } from '@lumen/runner'
let lspDiagnostics: any = null as any
let lspHover: any = null as any
try {
  // prefer compiled lsp dist
  const lsp = require('@lumen/lsp')
  lspDiagnostics = lsp.getDiagnostics
  lspHover = lsp.getHover
} catch {
  try {
    // fallback to local build path
    const lsp = require('../lsp/dist/index.js')
    lspDiagnostics = lsp.getDiagnostics
    lspHover = lsp.getHover
  } catch {}
}

let DISABLE_CACHE = false

function usage() {
  console.log(`lumen <cmd> [args]
  cmds:
    fmt <path> [--write] [--recursive]  Format file or directory (prints to stdout unless --write)
    run <file> [--deny e1,e2]      Parse (with imports) and run (runner)
    check <path> [--json] [--policy <file>] [--strict-warn]  Round-trip + effect check for file or directory
    init <dir>             Scaffold a new LUMEN project
    serve                  Start simple LSP-like server on stdin/stdout (newline-delimited JSON)
`)
}

async function main() {
  let [,, cmd, target, ...rest] = process.argv
  if (!cmd) { usage(); process.exit(1) }
  if (!target) {
    if (cmd === 'serve' || cmd === 'cache') target = '.'
    else { usage(); process.exit(1) }
  }
  const resolved = path.resolve(target)
  const isDir = fs.existsSync(resolved) && fs.lstatSync(resolved).isDirectory()
  const write = rest.includes('--write')
  const recursive = rest.includes('--recursive')
  const runOnFiles = (files: string[], fn: (p: string) => void) => {
    for (const f of files) fn(f)
  }

  if (cmd === 'fmt') {
    const files = isDir
      ? collectLumFiles(resolved, recursive)
      : [resolved]
    runOnFiles(files, (f) => {
      const src = fs.readFileSync(f, 'utf8')
      const ast = parse(src)
      assignStableSids(ast)
      const out = format(ast)
      if (write) fs.writeFileSync(f, out, 'utf8')
      else console.log(out)
    })
    return
  }
  if (cmd === 'cache') {
    const action = (rest[0] || '').toLowerCase()
    const cacheDir = path.resolve(process.cwd(), '.lumen-cache')
    if (action === 'clear') {
      try {
        if (fs.existsSync(cacheDir)) {
          for (const f of fs.readdirSync(cacheDir)) fs.unlinkSync(path.join(cacheDir, f))
          console.log('cache cleared')
        } else console.log('no cache')
      } catch (e) { console.error(String(e)); process.exit(1) }
      return
    }
    console.log('usage: lumen cache clear')
    return
  }
  if (cmd === 'hover') {
    const file = resolved
    const symbol = rest[0]
    const asJson = rest.includes('--json')
    if (!symbol) { console.error('usage: lumen hover <file> <symbol> [--json]'); process.exit(1) }
    const ast = loadWithImports(file)
    const info = hoverInfo(ast, symbol)
    if (asJson) console.log(JSON.stringify(info, null, 2))
    else console.log(info.kind ? `${info.kind}: ${info.name}` : 'not found')
    return
  }
  if (cmd === 'serve') {
    // Simple newline-delimited JSON protocol
    // Request: { action: 'hover'|'diagnostics', file?: string, source?: string, symbol?: string }
    // Response: JSON per line
    let buffer = ''
    process.stdin.setEncoding('utf8')
    process.stdin.on('data', chunk => {
      buffer += chunk
      let idx
      while ((idx = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, idx).trim()
        buffer = buffer.slice(idx + 1)
        if (!line) continue
        try {
          const req = JSON.parse(line)
          const src = req.source ?? (req.file ? fs.readFileSync(path.resolve(req.file), 'utf8') : '')
          if (req.action === 'diagnostics') {
            // If file provided, use merged AST + checks; else fallback to LSP single-file diags
            if (req.file) {
              const file = path.resolve(req.file)
              const ast = loadWithImports(file)
              const policyPath = findPolicyFile(file)
              const files = Array.from(new Set([file, ...collectImportsTransitive(file)])).map(p => ({ path: p, ast: parse(fs.readFileSync(p, 'utf8')) }))
              const effErrors = checkEffectsProject(files)
              const typeReport = checkTypesProject(files)
              const policy = policyPath && fs.existsSync(policyPath) ? JSON.parse(fs.readFileSync(policyPath, 'utf8')) : null
              const policyReport = policy ? checkPolicyDetailed(files, policy) : { errors: [], warnings: [] as string[] }
              const diagnostics = [
                ...typeReport.errors.map(m => ({ message: m })),
                ...effErrors.map(m => ({ message: m })),
                ...policyReport.errors.map(m => ({ message: m })),
                ...policyReport.warnings.map(m => ({ message: `warn: ${m}` }))
              ]
              process.stdout.write(JSON.stringify({ ok: true, diagnostics }) + '\n')
            } else {
              const diags = lspDiagnostics ? lspDiagnostics(src) : []
              process.stdout.write(JSON.stringify({ ok: true, diagnostics: diags }) + '\n')
            }
          } else if (req.action === 'hover') {
            const sym = String(req.symbol || '')
            let info: any = {}
            if (req.file) {
              const file = path.resolve(req.file)
              const ast = loadWithImports(file)
              info = hoverInfo(ast, sym)
            } else {
              info = lspHover ? lspHover(src, sym) : {}
            }
            process.stdout.write(JSON.stringify({ ok: true, hover: info }) + '\n')
          } else if (req.action === 'symbols') {
            const file = req.file ? path.resolve(req.file) : null
            const ast = file ? loadWithImports(file) : parse(src)
            const symbols: any[] = []
            if (ast.kind === 'Program') {
              let mod: string | null = null
              for (const d of ast.decls) {
                if (d.kind === 'ModuleDecl') { mod = d.name; continue }
                if (d.kind === 'EnumDecl') symbols.push({ kind: 'enum', module: mod || null, name: d.name })
                if (d.kind === 'Fn' && d.name) symbols.push({ kind: 'function', module: mod || null, name: d.name, params: d.params, returnType: d.returnType || null, effects: Array.from(d.effects || []) })
                if (d.kind === 'StoreDecl') symbols.push({ kind: 'store', module: mod || null, name: d.name, schema: d.schema })
                if (d.kind === 'QueryDecl') symbols.push({ kind: 'query', module: mod || null, name: d.name, source: d.source, projection: d.projection || [] })
              }
            }
            process.stdout.write(JSON.stringify({ ok: true, symbols }) + '\n')
          } else {
            process.stdout.write(JSON.stringify({ ok: false, error: 'unknown action' }) + '\n')
          }
        } catch (e) {
          process.stdout.write(JSON.stringify({ ok: false, error: String(e) }) + '\n')
        }
      }
    })
    return
  }
  if (cmd === 'trace') {
    const entry = resolved
    DISABLE_CACHE = rest.includes('--no-cache')
    const ast = loadWithImports(entry)
    assignStableSids(ast)
    const res = run(ast)
    const hash = hashTrace(res.trace)
    console.log(JSON.stringify({ hash, trace: res.trace }, null, 2))
    return
  }
  if (cmd === 'run') {
    const entry = resolved
    DISABLE_CACHE = rest.includes('--no-cache')
    const ast = loadWithImports(entry)
    assignStableSids(ast)
    // collect deny list from flag and policy
    const denyFlag = rest.find(a => a.startsWith('--deny'))
    let denyList: string[] = []
    if (denyFlag) {
      const parts = denyFlag.includes('=') ? denyFlag.split('=')[1] : rest[rest.indexOf('--deny') + 1]
      if (parts) denyList = parts.split(',').map(s => s.trim()).filter(Boolean)
    }
    const mockEffects = rest.includes('--mock-effects')
    const policyPathFlagIdx = rest.indexOf('--policy')
    const policyPath = policyPathFlagIdx >= 0 ? path.resolve(rest[policyPathFlagIdx + 1]) : findPolicyFile(entry)
    const strictWarn = rest.includes('--strict-warn')
    if (policyPath && fs.existsSync(policyPath)) {
      const policy = JSON.parse(fs.readFileSync(policyPath, 'utf8'))
      const fromPolicy: string[] = (policy?.policy?.deny ?? [])
      denyList = Array.from(new Set([...
        denyList,
        ...fromPolicy,
      ]))
    }
    const deniedEffects = new Set<string>(denyList)
    const runOpts: any = {}
    if (deniedEffects.size > 0) runOpts.deniedEffects = deniedEffects
    if (mockEffects) runOpts.mockEffects = true
    const res = run(ast, Object.keys(runOpts).length ? runOpts : undefined)
    const policy = policyPath && fs.existsSync(policyPath) ? JSON.parse(fs.readFileSync(policyPath, 'utf8')) : null
    const policyReport = policy ? checkPolicyDetailed([{ path: entry, ast }], policy) : { errors: [], warnings: [] as string[] }
    const ok = policyReport.errors.length === 0 && (!strictWarn || policyReport.warnings.length === 0)
    const out = { ok, value: res.value, trace: res.trace, policy: policyReport, deniedEffects: Array.from(deniedEffects) }
    console.log(JSON.stringify(out, null, 2))
    if (!ok) process.exit(2)
    return
  }
  if (cmd === 'check') {
    // Collect files: if a single file, include its transitive imports; if a dir, traverse dir
    const files = isDir
      ? collectLumFiles(resolved, recursive)
      : Array.from(new Set([resolved, ...collectImportsTransitive(resolved)]))

    let ok = true
    const writeBack: Array<{ path: string, content: string }> = []
    const parsed = files.map(f => ({ path: f, src: fs.readFileSync(f, 'utf8') }))
      .map(({ path: p, src }) => ({ path: p, ast: parse(src), formatted: '' as string, ast2: null as any }))

    // Round-trip
    for (const item of parsed) {
      assignStableSids(item.ast)
      assignStableSids(item.ast)
      item.formatted = format(item.ast)
      item.ast2 = parse(item.formatted)
      assignStableSids(item.ast2)
      assignStableSids(item.ast2)
      if (!structurallySimilar(item.ast, item.ast2)) {
        console.error(`Round-trip mismatch: ${item.path}`)
        ok = false
      }
      if (write) writeBack.push({ path: item.path, content: item.formatted })
    }

    // Effect analysis across files
    const json = rest.includes('--json')
    const strictWarn = rest.includes('--strict-warn')
    const policyPathFlagIdx = rest.indexOf('--policy')
    const policyPath = policyPathFlagIdx >= 0 ? path.resolve(rest[policyPathFlagIdx + 1]) : findPolicyFile(resolved)
    const policy = policyPath && fs.existsSync(policyPath) ? JSON.parse(fs.readFileSync(policyPath, 'utf8')) : null
    const projectFiles = parsed.map(p => ({ path: p.path, ast: p.ast }))
    const effErrors = checkEffectsProject(projectFiles)
    const guardErrors = checkGuardPurityProject(projectFiles)
    const typeReport = checkTypesProject(parsed.map(p => ({ path: p.path, ast: p.ast })))
    const policyReport = policy ? checkPolicyDetailed(parsed.map(p => ({ path: p.path, ast: p.ast })), policy) : { errors: [], warnings: [] as string[] }
    if (json) {
      const allErrors = [...effErrors, ...guardErrors, ...policyReport.errors]
      const payload = { ok: ok && allErrors.length === 0 && (!strictWarn || policyReport.warnings.length === 0) && typeReport.errors.length === 0, files: files, errors: allErrors, policy: policyReport, types: typeReport }
      console.log(JSON.stringify(payload, null, 2))
      if (!payload.ok) process.exit(2)
      return
    } else {
      for (const w of policyReport.warnings) console.warn(`warn: ${w}`)
      for (const e of typeReport.errors) { console.error(e); ok = false }
      for (const e of [...effErrors, ...guardErrors, ...policyReport.errors]) { console.error(e); ok = false }
      if (strictWarn && policyReport.warnings.length > 0) ok = false
    }

    if (!ok) process.exit(2)
    if (write) for (const w of writeBack) fs.writeFileSync(w.path, w.content, 'utf8')
    console.log('OK')
    return
  }

  if (cmd === 'init') {
    const dest = resolved
    if (!fs.existsSync(dest)) fs.mkdirSync(dest, { recursive: true })
    const srcDir = path.join(dest, 'src')
    if (!fs.existsSync(srcDir)) fs.mkdirSync(srcDir, { recursive: true })
    const mainPath = path.join(srcDir, 'main.lum')
    if (!fs.existsSync(mainPath)) {
      fs.writeFileSync(mainPath, `// LUMEN starter\nlet greeting = "Hello from LUMEN"\n\nfn main() = greeting\n\nmain()\n`, 'utf8')
    }
    const cfgPath = path.join(dest, 'lumen.json')
    if (!fs.existsSync(cfgPath)) {
      fs.writeFileSync(cfgPath, JSON.stringify({ policy: { deny: [] } }, null, 2), 'utf8')
    }
    console.log(`Initialized LUMEN project at ${dest}`)
    return
  }
  usage()
}

main().catch(e => { console.error(e); process.exit(1) })

function hoverInfo(ast: any, symbol: string): any {
  const lastSeg = symbol.includes('.') ? symbol.split('.').pop() as string : symbol
  const result: any = {}
  if (ast.kind !== 'Program') return result
  // collect enums and variants
  const enums: Array<{ name: string, module?: string, variants: Array<{ name: string, params: string[] }> }> = []
  let currentModule: string | null = null
  for (const d of ast.decls) {
    if (d.kind === 'ModuleDecl') currentModule = d.name
    if (d.kind === 'EnumDecl') enums.push({ name: d.name, module: currentModule || undefined, variants: d.variants })
  }
  for (const en of enums) {
    if (en.name === symbol || en.name === lastSeg) return { kind: 'enum', name: en.name, module: en.module, variants: en.variants }
    for (const v of en.variants) if (v.name === symbol || v.name === lastSeg) return { kind: 'constructor', name: v.name, enum: en.name, params: v.params }
  }
  // collect functions with types/effects
  const fns: Array<{ name: string, module?: string, params: Array<{ name: string, type?: string }>, returnType?: string, effects: Set<string> }> = []
  currentModule = null
  for (const d of ast.decls) {
    if (d.kind === 'ModuleDecl') currentModule = d.name
    if (d.kind === 'Fn' && d.name) fns.push({ name: d.name, module: currentModule || undefined, params: d.params, returnType: d.returnType, effects: d.effects })
  }
  for (const fn of fns) {
    const full = fn.module ? `${fn.module}.${fn.name}` : fn.name
    if (fn.name === symbol || full === symbol) return { kind: 'function', name: full, module: fn.module || null, params: fn.params, returnType: fn.returnType, effects: Array.from(fn.effects) }
  }
  // stores and queries
  currentModule = null
  for (const d of ast.decls) {
    if (d.kind === 'ModuleDecl') currentModule = d.name
    if (d.kind === 'StoreDecl') {
      const full = currentModule ? `${currentModule}.${d.name}` : d.name
      if (d.name === symbol || full === symbol) return { kind: 'store', name: full, module: currentModule || null, schema: d.schema }
    }
    if (d.kind === 'QueryDecl') {
      const full = currentModule ? `${currentModule}.${d.name}` : d.name
      if (d.name === symbol || full === symbol) return { kind: 'query', name: full, module: currentModule || null, source: d.source, projection: d.projection || [] }
    }
  }
  return result
}

function hashTrace(trace: Array<{ sid: string, note: string }>): string {
  let h = 2166136261 >>> 0
  for (const ev of trace) {
    const s = `${ev.sid}:${ev.note}`
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i)
      h = Math.imul(h, 16777619) >>> 0
    }
  }
  return `t:${h.toString(36)}`
}

function hashFiles(files: string[], policyPath?: string): string {
  let h = 2166136261 >>> 0
  const sorted = [...files].sort()
  for (const f of sorted) {
    const s = f + '|' + require('fs').readFileSync(f, 'utf8')
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0 }
  }
  if (policyPath && fs.existsSync(policyPath)) {
    const ps = policyPath + '|' + fs.readFileSync(policyPath, 'utf8')
    for (let i = 0; i < ps.length; i++) { h ^= ps.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0 }
  }
  return `p:${h.toString(36)}`
}

// Helpers
function structurallySimilar(a: any, b: any): boolean {
  // Compare kinds and structure of Program decls ignoring sid
  if (a?.kind !== b?.kind) return false
  if (a.kind === 'Program' && b.kind === 'Program') {
    if (a.decls.length !== b.decls.length) return false
    for (let i = 0; i < a.decls.length; i++) {
      if (!structurallySimilar(a.decls[i], b.decls[i])) return false
    }
    return true
  }
  const keysA = Object.keys(a).filter(k => k !== 'sid')
  const keysB = Object.keys(b).filter(k => k !== 'sid')
  if (keysA.length !== keysB.length) return false
  for (const k of keysA) {
    if (!structEqual(a[k], b[k])) return false
  }
  return true
}

function structEqual(a: any, b: any): boolean {
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false
    for (let i = 0; i < a.length; i++) if (!structEqual(a[i], b[i])) return false
    return true
  }
  if (a && typeof a === 'object' && b && typeof b === 'object') return structurallySimilar(a, b)
  return a === b
}

function checkEffects(ast: any): string[] {
  // Build function table: name -> Set effects
  const fnTable = new Map<string, Set<string>>()
  if (ast.kind === 'Program') {
    for (const d of ast.decls) {
      if (d.kind === 'Fn' && d.name) {
        const set = new Set<string>()
        for (const v of (d.effects as Set<string>)) set.add(v)
        fnTable.set(d.name, set)
      }
    }
  }
  const errors: string[] = []
  function walk(e: any, currentFn: { name: string, effects: Set<string> } | null) {
    switch (e.kind) {
      case 'Program':
        for (const d of e.decls) walk(d, null)
        break
      case 'Fn': {
        const set = new Set<string>()
        for (const v of (e.effects as Set<string>)) set.add(v)
        walk(e.body, { name: e.name ?? '<anon>', effects: set })
        break
      }
      case 'Call': {
        if (e.callee.kind === 'Var') {
          const calleeEffects = fnTable.get(e.callee.name)
          if (calleeEffects && currentFn) {
            for (const ce of calleeEffects) {
              if (!currentFn.effects.has(ce)) {
                errors.push(`effects: function ${currentFn.name} missing '${ce}' but calls ${e.callee.name}`)
              }
            }
          }
        }
        for (const a of e.args) walk(a, currentFn)
        break
      }
      default:
        // descend simple fields
        for (const k of Object.keys(e)) {
          const v = (e as any)[k]
          if (v && typeof v === 'object' && 'kind' in v) walk(v, currentFn)
          if (Array.isArray(v)) for (const it of v) if (it && typeof it === 'object' && 'kind' in it) walk(it, currentFn)
        }
    }
  }
  walk(ast, null)
  return errors
}

function collectLumFiles(dir: string, recursive: boolean): string[] {
  const out: string[] = []
  for (const ent of fs.readdirSync(dir, { withFileTypes: true }) as unknown as Array<{ name: string, isDirectory: () => boolean }>) {
    const p = path.join(dir, ent.name)
    if (ent.isDirectory()) {
      if (recursive) out.push(...collectLumFiles(p, true))
    } else if (p.endsWith('.lum')) out.push(p)
  }
  return out
}

// Cross-file effect analysis: build a function table across all files and check nested calls
function checkEffectsProject(files: Array<{ path: string, ast: any }>): string[] {
  const table = new Map<string, { effects: Set<string>, path: string }>()
  // First pass: collect named fns and their declared effects
  for (const f of files) {
    if (f.ast.kind !== 'Program') continue
    const moduleName = getModuleName(f.ast)
    for (const d of f.ast.decls) {
      if (d.kind === 'Fn' && d.name) {
        const set = new Set<string>()
        for (const v of (d.effects as Set<string>)) set.add(v)
        const key = moduleName ? `${moduleName}.${d.name}` : d.name
        table.set(key, { effects: set, path: f.path })
      }
    }
  }
  const errors: string[] = []
  function walk(e: any, currentFn: { name: string, effects: Set<string>, path: string, chain: string[] } | null) {
    switch (e.kind) {
      case 'Program':
        for (const d of e.decls) walk(d, null)
        break
      case 'Fn': {
        const set = new Set<string>()
        for (const v of (e.effects as Set<string>)) set.add(v)
        const ctx = { name: e.name ?? '<anon>', effects: set, path: '', chain: [e.name ?? '<anon>'] }
        walk(e.body, ctx)
        break
      }
      case 'Call': {
        if (e.callee.kind === 'Var') {
          const name = e.callee.name
          const possibleNames = name.includes('.') ? [name] : [name, ...prefixWithModule(files, name)]
          const calleeMeta = possibleNames.map(n => table.get(n)).find(Boolean)
          if (calleeMeta && currentFn) {
            for (const ce of calleeMeta.effects) {
              if (!currentFn.effects.has(ce)) {
                const chain = [...(currentFn.chain || []), e.callee.name].join(' -> ')
                errors.push(`${currentFn.path || ''}: effects: function ${currentFn.name} missing '${ce}' (call chain: ${chain})`.trim())
              }
            }
            // Recurse into callee body by simulating a call chain context, to catch deeper chains
            const nextCtx = { name: currentFn.name, effects: currentFn.effects, path: currentFn.path, chain: [...(currentFn.chain || []), e.callee.name] }
            // Find callee AST and walk its body under the same effect set
            const calleeFile = files.find(f => f.path === calleeMeta.path)
            if (calleeFile) {
              for (const d of (calleeFile.ast.decls || [])) {
                if (d.kind === 'Fn' && (d.name === e.callee.name || `${getModuleName(calleeFile.ast)}.${d.name}` === possibleNames[1])) walk(d.body, nextCtx)
              }
            }
          }
        }
        for (const a of e.args) walk(a, currentFn)
        break
      }
      case 'EffectCall': {
        if (currentFn) {
          const eff = e.effect
          if (!currentFn.effects.has(eff)) {
            const chain = (currentFn.chain || []).join(' -> ')
            errors.push(`${currentFn.path || ''}: effects: function ${currentFn.name} missing '${eff}' (effect call${chain ? ` in ${chain}` : ''})`.trim())
          }
        }
        for (const a of e.args) walk(a, currentFn)
        break
      }
      default:
        for (const k of Object.keys(e)) {
          const v = (e as any)[k]
          if (v && typeof v === 'object' && 'kind' in v) walk(v, currentFn)
          if (Array.isArray(v)) for (const it of v) if (it && typeof it === 'object' && 'kind' in it) walk(it, currentFn)
        }
    }
  }
  for (const f of files) walk(f.ast, null)
  return Array.from(new Set(errors))
}

// Guards must be pure: no EffectCall and no calls to functions with effects
function checkGuardPurityProject(files: Array<{ path: string, ast: any }>): string[] {
  const table = new Map<string, { effects: Set<string>, path: string }>()
  for (const f of files) {
    if (f.ast.kind !== 'Program') continue
    const moduleName = getModuleName(f.ast)
    for (const d of f.ast.decls) {
      if (d.kind === 'Fn' && d.name) {
        const set = new Set<string>()
        for (const v of (d.effects as Set<string>)) set.add(v)
        const key = moduleName ? `${moduleName}.${d.name}` : d.name
        table.set(key, { effects: set, path: f.path })
      }
    }
  }
  const errors: string[] = []
  function walkGuard(expr: any, currentFile: string, moduleName: string | null) {
    if (!expr || typeof expr !== 'object') return
    if (expr.kind === 'EffectCall') {
      errors.push(`${currentFile}: guard must be pure (found effect ${expr.effect}.${expr.op})`)
      return
    }
    if (expr.kind === 'Call' && expr.callee?.kind === 'Var') {
      const name = expr.callee.name as string
      const candidates = name.includes('.') ? [name] : [name, ...(moduleName ? [`${moduleName}.${name}`] : [])]
      const meta = candidates.map(n => table.get(n)).find(Boolean)
      if (meta && meta.effects.size > 0) {
        errors.push(`${currentFile}: guard must be pure (function ${name} has effects: ${Array.from(meta.effects).join(', ')})`)
      }
    }
    for (const k of Object.keys(expr)) {
      const v = (expr as any)[k]
      if (v && typeof v === 'object' && 'kind' in v) walkGuard(v, currentFile, moduleName)
      if (Array.isArray(v)) for (const it of v) if (it && typeof it === 'object' && 'kind' in it) walkGuard(it, currentFile, moduleName)
    }
  }
  for (const f of files) {
    const ast = f.ast
    if (ast.kind !== 'Program') continue
    const moduleName = getModuleName(ast)
    for (const d of ast.decls) {
      if (d.kind === 'ActorDeclNew') {
        for (const h of (d.handlers as any[])) if (h.guard) walkGuard(h.guard, f.path, moduleName)
      }
    }
  }
  return Array.from(new Set(errors))
}

// Import expansion helpers
function collectImportsTransitive(entry: string, visited = new Set<string>()): string[] {
  if (visited.has(entry)) return []
  visited.add(entry)
  const dir = path.dirname(entry)
  const src = fs.readFileSync(entry, 'utf8')
  const ast = parse(src)
  const imports: string[] = []
  if (ast.kind === 'Program') {
    for (const d of ast.decls) {
      if (d.kind === 'ImportDecl') {
        const p = resolveImportPath(entry, d.path)
        imports.push(p)
        imports.push(...collectImportsTransitive(p, visited))
      }
    }
  }
  return imports
}

function loadWithImports(entry: string, visited = new Set<string>()): any {
  const files = Array.from(new Set([entry, ...collectImportsTransitive(entry)]))
  // simple content hash for merged program
  const policyPath = findPolicyFile(entry)
  const key = hashFiles(files, policyPath || undefined)
  const cacheDir = path.resolve(process.cwd(), '.lumen-cache')
  const cachePath = path.join(cacheDir, `${key}.json`)
  if (!DISABLE_CACHE && fs.existsSync(cachePath)) {
    try { return JSON.parse(fs.readFileSync(cachePath, 'utf8')) } catch {}
  }
  const decls: any[] = []
  for (const f of files) {
    const src = fs.readFileSync(f, 'utf8')
    const ast = parse(src)
    if (ast.kind === 'Program') {
      for (const d of ast.decls) if (d.kind !== 'ImportDecl') decls.push(d)
    }
  }
  const merged = { kind: 'Program', sid: 'prog:merged', decls }
  try { if (!DISABLE_CACHE) { if (!fs.existsSync(cacheDir)) fs.mkdirSync(cacheDir, { recursive: true }); fs.writeFileSync(cachePath, JSON.stringify(merged), 'utf8') } } catch {}
  return merged
}

function findPolicyFile(start: string): string | null {
  const stat = fs.existsSync(start) ? fs.lstatSync(start) : null
  const base = stat && stat.isDirectory() ? start : path.dirname(start)
  const p = path.join(base, 'lumen.json')
  return fs.existsSync(p) ? p : null
}
// Override import resolution to consult lumen.pkg.json deps if present
function resolveImportPath(from: string, spec: string): string {
  const baseDir = fs.lstatSync(from).isDirectory() ? from : path.dirname(from)
  if (spec.startsWith('.')) return path.resolve(baseDir, spec)
  const pkgPath = path.resolve(process.cwd(), 'lumen.pkg.json')
  if (fs.existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'))
      const map = pkg?.deps || {}
      if (spec in map) return path.resolve(process.cwd(), map[spec])
    } catch {}
  }
  return path.resolve(baseDir, spec)
}

function checkPolicyDetailed(files: Array<{ path: string, ast: any }>, policy: any): { errors: string[], warnings: string[] } {
  const denies: string[] = (policy?.policy?.deny ?? [])
  const allows: string[] = (policy?.policy?.allow ?? [])
  const warnEffects: string[] = (policy?.policy?.warn ?? [])
  const errors: string[] = []
  const warnings: string[] = []
  function walk(e: any, file: string, moduleName: string | null) {
    if (!e || typeof e !== 'object') return
    if (e.kind === 'Fn') {
      const effs = Array.from((e.effects as Set<string>) ?? [])
      for (const d of denies) if (effs.includes(d)) errors.push(`${file}: policy denies effect '${d}' in function ${moduleName ? moduleName + '.' : ''}${e.name ?? '<anon>'}`)
      for (const w of warnEffects) if (effs.includes(w)) warnings.push(`${file}: policy warns on effect '${w}' in function ${moduleName ? moduleName + '.' : ''}${e.name ?? '<anon>'}`)
      walk(e.body, file, moduleName)
      return
    }
    if (e.kind === 'Program') {
      const mod = getModuleName(e)
      for (const d of e.decls) walk(d, file, mod)
      return
    }
    for (const k of Object.keys(e)) {
      const v = (e as any)[k]
      if (v && typeof v === 'object' && 'kind' in v) walk(v, file, moduleName)
      if (Array.isArray(v)) for (const it of v) if (it && typeof it === 'object' && 'kind' in it) walk(it, file, moduleName)
    }
  }
  for (const f of files) walk(f.ast, f.path, null)
  return { errors, warnings }
}

function getModuleName(ast: any): string | null {
  if (ast.kind !== 'Program') return null
  for (const d of ast.decls) if (d.kind === 'ModuleDecl') return d.name
  return null
}

function prefixWithModule(files: Array<{ path: string, ast: any }>, name: string): string[] {
  const out: string[] = []
  for (const f of files) {
    const m = getModuleName(f.ast)
    if (m) out.push(`${m}.${name}`)
  }
  return out
}

// Very small type checker for literals/ident/let/fn/call/binary/block
function checkTypesProject(files: Array<{ path: string, ast: any }>): { errors: string[] } {
  type Type = 'Int' | 'Text' | 'Bool' | 'Unit' | 'Unknown' | `ADT:${string}`
  function typeOfLiteral(e: any): Type {
    if (e.kind === 'LitNum') return 'Int'
    if (e.kind === 'LitText') return 'Text'
    if (e.kind === 'LitBool') return 'Bool'
    return 'Unknown'
  }
  const errors: string[] = []
  // simple env per file; fn table for arity checking
  const fnSigs = new Map<string, { params: Type[], ret: Type, path: string }>()
  // ADT constructor table: CtorName -> { enumName, params: Type[] }
  const adtCtors = new Map<string, { enumName: string, params: Type }[]>()
  const ctorToEnum = new Map<string, { enumName: string, params: Type[] }>()
  const enumToVariants = new Map<string, Array<{ name: string }>>()
  const schemas = new Map<string, Record<string, string>>()
  const stores = new Map<string, { schema: string, path: string }>()
  const enumNames = new Set<string>()
  function parseTypeName(t?: string): Type {
    if (!t) return 'Unknown'
    if (t === 'Int') return 'Int'
    if (t === 'Text') return 'Text'
    if (t === 'Bool') return 'Bool'
    if (enumNames.has(t)) return `ADT:${t}`
    return 'Unknown'
  }
  function effectReturnType(eff: string, op: string): Type {
    if (eff === 'io' && op === 'print') return 'Unit'
    if (eff === 'fs' && op === 'read') return 'Text'
    if (eff === 'fs' && op === 'write') return 'Unit'
    return 'Unknown'
  }
  // First pass: collect function signatures
  for (const f of files) {
    if (f.ast.kind !== 'Program') continue
    const mod = getModuleName(f.ast)
    for (const d of f.ast.decls) {
      if (d.kind === 'Fn' && d.name) {
        const params = (d.params as Array<{ name: string, type?: string }>).map(p => parseTypeName(p.type))
        const ret = parseTypeName(d.returnType)
        fnSigs.set(mod ? `${mod}.${d.name}` : d.name, { params, ret, path: f.path })
      }
      if (d.kind === 'EnumDecl') {
        enumToVariants.set(d.name, (d.variants as any[]).map(v => ({ name: v.name })))
        enumNames.add(d.name)
        for (const v of d.variants as Array<{ name: string, params: string[] }>) {
          const params = v.params.map(parseTypeName)
          ctorToEnum.set(v.name, { enumName: d.name, params })
        }
      }
      if (d.kind === 'SchemaDecl') schemas.set(d.name, d.fields)
      if (d.kind === 'StoreDecl') stores.set(d.name, { schema: d.schema, path: f.path })
    }
  }
  // Second pass: check bodies
  function checkExpr(e: any, env: Map<string, Type>, file: string): Type {
    switch (e.kind) {
      case 'LitNum':
      case 'LitText':
      case 'LitBool':
        return typeOfLiteral(e)
      case 'Var':
        return env.get(e.name) ?? 'Unknown'
      case 'Ctor': {
        const meta = ctorToEnum.get(e.name)
        const argTypes = (e.args as any[]).map(a => checkExpr(a, env, file))
        if (meta) {
          if (meta.params.length !== argTypes.length) errors.push(`${file}: constructor ${e.name} arity ${argTypes.length} but expected ${meta.params.length}`)
          else {
            for (let i = 0; i < meta.params.length; i++) {
              if (meta.params[i] !== 'Unknown' && argTypes[i] !== 'Unknown' && meta.params[i] !== argTypes[i]) {
                errors.push(`${file}: constructor ${e.name} arg ${i+1} type ${argTypes[i]} but expected ${meta.params[i]}`)
              }
            }
          }
          return `ADT:${meta.enumName}`
        }
        return 'Unknown'
      }
      case 'RecordLit': {
        for (const f of e.fields as any[]) checkExpr(f.expr, env, file)
        return 'Unknown'
      }
      case 'TupleLit': {
        for (const el of e.elements as any[]) checkExpr(el, env, file)
        return 'Unknown'
      }
      case 'Match': {
        const _t = checkExpr(e.scrutinee, env, file)
        let branchT: Type = 'Unknown'
        // collect constructors for exhaustiveness and infer result type
        const ctors = new Set<string>()
        let enumNameForCases: string | null = null
        let onlyCtors = true
        let allBranchesBaseType: Type | null = null
        for (const c of e.cases as any[]) {
          if (c.guard) checkExpr(c.guard, env, file)
          const bt = checkExpr(c.body, env, file)
          // infer base type consensus
          if (bt === 'Int' || bt === 'Text' || bt === 'Bool' || bt === 'Unit') {
            allBranchesBaseType = allBranchesBaseType === null ? bt : (allBranchesBaseType === bt ? bt : 'Unknown')
          } else if (typeof bt === 'string' && bt.startsWith('ADT:')) {
            // track ADT result type
            const en = bt.slice(4)
            enumNameForCases = enumNameForCases ?? en
            if (enumNameForCases !== en) allBranchesBaseType = 'Unknown'
          } else {
            allBranchesBaseType = 'Unknown'
          }
          if (c.pattern?.kind === 'Ctor') {
            const meta = ctorToEnum.get(c.pattern.name)
            if (meta) {
              ctors.add(c.pattern.name)
              enumNameForCases = enumNameForCases ?? meta.enumName
              if (enumNameForCases !== meta.enumName) onlyCtors = false
            } else onlyCtors = false
          } else if (c.pattern?.kind === 'Var' && (c.pattern.name === '_' || c.pattern.name === '*')) {
            onlyCtors = false
          } else {
            onlyCtors = false
          }
        }
        if (onlyCtors && enumNameForCases) {
          const variants = enumToVariants.get(enumNameForCases) || []
          const missing = variants.map(v => v.name).filter(vn => !ctors.has(vn))
          if (missing.length > 0) errors.push(`${file}: match not exhaustive for ${enumNameForCases}; missing: ${missing.join(', ')}`)
          branchT = `ADT:${enumNameForCases}`
        } else if (allBranchesBaseType && allBranchesBaseType !== 'Unknown') {
          branchT = allBranchesBaseType
        }
        return branchT
      }
      case 'Let': {
        const t = checkExpr(e.expr, env, file)
        const declT = parseTypeName(e.type)
        if (e.type && declT !== 'Unknown' && t !== 'Unknown' && declT !== t) {
          errors.push(`${file}: type mismatch in let ${e.name}: declared ${declT} but got ${t}`)
        }
        env.set(e.name, declT !== 'Unknown' ? declT : t)
        return env.get(e.name) ?? 'Unknown'
      }
      case 'Binary': {
        const lt = checkExpr(e.left, env, file)
        const rt = checkExpr(e.right, env, file)
        if ((lt !== 'Int' || rt !== 'Int') && (lt !== 'Unknown' && rt !== 'Unknown')) {
          errors.push(`${file}: binary ${e.op} expects Int, got ${lt} and ${rt}`)
        }
        return 'Int'
      }
      case 'EffectCall': {
        const rt = effectReturnType(e.effect, e.op)
        for (const a of e.args) checkExpr(a, env, file)
        return rt
      }
      case 'Call': {
        const name = e.callee.kind === 'Var' ? e.callee.name : ''
        const candidates = name.includes('.') ? [name] : [name, ...prefixWithModule(files, name)]
        const sig = candidates.map(n => fnSigs.get(n)).find(Boolean)
        const argTypes = e.args.map((a: any) => checkExpr(a, env, file))
        if (sig) {
          if (sig.params.length !== argTypes.length) errors.push(`${file}: call ${name} arity ${argTypes.length} but expected ${sig.params.length}`)
          else {
            for (let i = 0; i < sig.params.length; i++) {
              if (sig.params[i] !== 'Unknown' && argTypes[i] !== 'Unknown' && sig.params[i] !== argTypes[i]) {
                errors.push(`${file}: call ${name} arg ${i+1} type ${argTypes[i]} but expected ${sig.params[i]}`)
              }
            }
          }
          return sig.ret
        }
        return 'Unknown'
      }
      case 'Block': {
        const local = new Map(env)
        let last: Type = 'Unknown'
        for (const s of e.stmts) last = checkExpr(s, local, file)
        return last
      }
      case 'Fn': {
        const local = new Map(env)
        for (const p of (e.params as Array<{ name: string, type?: string }>)) local.set(p.name, parseTypeName(p.type))
        const bodyT = checkExpr(e.body, local, file)
        const retT = parseTypeName(e.returnType)
        if (e.returnType) {
          if (retT !== 'Unknown' && bodyT !== 'Unknown' && retT !== bodyT) {
            // if return is ADT:Enum and body is ADT:Enum, allow if same
            errors.push(`${file}: function ${e.name ?? '<anon>'} returns ${bodyT} but declared ${retT}`)
          }
          // additionally, if declared ADT, ensure body forms are constructors of that ADT (best-effort)
          if (typeof retT === 'string' && retT.startsWith('ADT:')) {
            const en = retT.slice(4)
            const violates: { ok: boolean } = { ok: false }
            const verify = (expr: any) => {
              if (!expr || typeof expr !== 'object') return
              if (expr.kind === 'Ctor') {
                const meta = ctorToEnum.get(expr.name)
                if (!meta || meta.enumName !== en) violates.ok = true
                return
              }
              for (const k of Object.keys(expr)) {
                const v = (expr as any)[k]
                if (v && typeof v === 'object' && 'kind' in v) verify(v)
                if (Array.isArray(v)) for (const it of v) if (it && typeof it === 'object' && 'kind' in it) verify(it)
              }
            }
            verify(e.body)
            if (violates.ok) errors.push(`${file}: function ${e.name ?? '<anon>'} declared ${retT} but returns constructor from different enum`)
          }
        }
        return 'Unknown'
      }
      default:
        return 'Unknown'
    }
  }
  for (const f of files) {
    const env = new Map<string, Type>()
    if (f.ast.kind !== 'Program') continue
    for (const d of f.ast.decls) {
      if (d.kind === 'QueryDecl') {
        const store = stores.get(d.source)
        if (!store) errors.push(`${f.path}: query ${d.name} references unknown store ${d.source}`)
        const schema = store ? schemas.get(store.schema) : null
        if (!schema) {
          if (store) errors.push(`${f.path}: query ${d.name} references store ${d.source} with unknown schema ${store.schema}`)
        } else {
          // validate projection fields
          const proj = (d.projection || []) as string[]
          for (const p of proj) if (!(p in schema)) errors.push(`${f.path}: query ${d.name} selects unknown field ${p}`)
          // basic predicate variable usage: allow only field names and literals/operators
          if (d.predicate) {
            // Build env with field types and type-check predicate
            const env = new Map<string, Type>()
            for (const [k, v] of Object.entries(schema)) env.set(k, parseTypeName(v))
            const _t = checkExpr(d.predicate, env, f.path)
          }
        }
      } else {
        checkExpr(d, env, f.path)
      }
    }
    // Exhaustiveness for handler-style actors when patterns are constructors of same enum
    for (const d of f.ast.decls) {
      if (d.kind === 'ActorDeclNew') {
        const ctors = new Set<string>()
        let enumName: string | null = null
        let onlyCtors = true
        for (const h of (d.handlers as any[])) {
          if (h.pattern?.kind === 'Ctor') {
            const meta = ctorToEnum.get(h.pattern.name)
            if (meta) {
              ctors.add(h.pattern.name)
              enumName = enumName ?? meta.enumName
              if (enumName !== meta.enumName) onlyCtors = false
            } else onlyCtors = false
          } else if (h.pattern?.kind === 'Var' && (h.pattern.name === '_' || h.pattern.name === '*')) {
            // wildcard -> treat as exhaustive
            onlyCtors = false
            enumName = null
            break
          } else {
            onlyCtors = false
          }
        }
        if (onlyCtors && enumName) {
          const variants = enumToVariants.get(enumName) || []
          const missing = variants.map(v => v.name).filter(vn => !ctors.has(vn))
          if (missing.length > 0) errors.push(`${f.path}: actor ${d.name} handlers not exhaustive for ${enumName}; missing: ${missing.join(', ')}`)
        }
      }
    }
    // Additionally, validate that router handlers' reply annotations (if any) are consistent with body types (basic)
    for (const d of f.ast.decls) {
      if (d.kind === 'ActorDeclNew') {
        for (const h of (d.handlers as any[])) {
          if (h.replyType) {
            const envLocal = new Map<string, Type>()
            const bt = checkExpr(h.body, envLocal, f.path)
            const rt = parseTypeName(h.replyType)
            if (rt !== 'Unknown' && bt !== 'Unknown' && rt !== bt) {
              errors.push(`${f.path}: actor ${d.name} handler reply type ${h.replyType} mismatches body type ${bt}`)
            }
          }
        }
      }
    }
  }
  function validatePredicateUses(expr: any, schema: Record<string,string>): boolean {
    let ok = true
    const visit = (e: any) => {
      if (!e || typeof e !== 'object') return
      if (e.kind === 'Var') { if (!(e.name in schema)) ok = false; return }
      for (const k of Object.keys(e)) {
        const v = (e as any)[k]
        if (v && typeof v === 'object' && 'kind' in v) visit(v)
        if (Array.isArray(v)) for (const it of v) if (it && typeof it === 'object' && 'kind' in it) visit(it)
      }
    }
    visit(expr)
    return ok
  }
  return { errors }
}