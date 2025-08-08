import { Expr, sid } from '@lumen/core-ir'

// Very small hand-rolled parser for:
// - let <name> = <literal|identifier>
// - fn <name>(<params,...>) = <identifier|literal>
// - bare identifier or literal as a statement
// Literals: number, boolean, text in double quotes

function parseLiteral(tok: string): Expr | null {
  if (/^\d+(?:\.\d+)?$/.test(tok)) return { kind: 'LitNum', sid: sid('lit'), value: Number(tok) }
  if (tok === 'true' || tok === 'false') return { kind: 'LitBool', sid: sid('lit'), value: tok === 'true' }
  const stringMatch = tok.match(/^"([\s\S]*)"$/)
  if (stringMatch) return { kind: 'LitText', sid: sid('lit'), value: stringMatch[1] }
  return null
}

// Recursive descent parser for expressions with + and * and calls
class Lexer {
  i = 0
  constructor(public s: string) {}
  peek(): string { return this.s[this.i] ?? '' }
  next(): string { return this.s[this.i++] ?? '' }
  eatWs() { while (/\s/.test(this.peek())) this.next() }
  eof(): boolean { return this.i >= this.s.length }
}

function parseExprRD(src: string): Expr {
  // quick patterns before lexing
  const assignMatch = src.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.+)$/)
  if (assignMatch) {
    return { kind: 'Assign', sid: sid('assign'), name: assignMatch[1], expr: parseExprRD(assignMatch[2]) } as any
  }
  const askMatch = src.match(/^ask\s+([^\s]+)\s+([\s\S]+)$/)
  if (askMatch) {
    return { kind: 'Ask', sid: sid('ask'), actor: parseExprRD(askMatch[1]), message: parseExprRD(askMatch[2]) } as any
  }
  const spawnMatch = src.match(/^spawn\s+([^\s]+)$/)
  if (spawnMatch) {
    return { kind: 'Spawn', sid: sid('spawn'), actorName: spawnMatch[1] } as any
  }
  const lx = new Lexer(src)
  lx.eatWs()
  const builtinEffects = new Set(['io','fs','net','db','time','nondet','gpu','unchecked'])
  function parsePrimary(): Expr {
    lx.eatWs()
    if (lx.peek() === '"') {
      lx.next()
      let v = ''
      while (!lx.eof() && lx.peek() !== '"') v += lx.next()
      if (lx.peek() === '"') lx.next()
      return { kind: 'LitText', sid: sid('lit'), value: v }
    }
    if (/[0-9]/.test(lx.peek())) {
      let n = ''
      while (/[0-9.]/.test(lx.peek())) n += lx.next()
      return { kind: 'LitNum', sid: sid('lit'), value: Number(n) }
    }
    if (lx.s.slice(lx['i'], lx['i'] + 4) === 'true') { lx['i'] += 4; return { kind: 'LitBool', sid: sid('lit'), value: true } }
    if (lx.s.slice(lx['i'], lx['i'] + 5) === 'false') { lx['i'] += 5; return { kind: 'LitBool', sid: sid('lit'), value: false } }
    if (lx.peek() === '(') { lx.next(); const e = parseAdd(); lx.eatWs(); if (lx.peek() === ')') lx.next(); return e }
    if (lx.peek() === '{') {
      // Block: { expr; expr; ... }
      lx.next()
      const stmts: Expr[] = []
      while (!lx.eof() && lx.peek() !== '}') {
        const start = lx['i']
        // read until ';' or '}'
        let depth = 0
        let buf = ''
        while (!lx.eof()) {
          const ch = lx.peek()
          if (ch === '{') depth++
          if (ch === '}') { if (depth === 0) break; depth-- }
          if (ch === ';' && depth === 0) { lx.next(); break }
          buf += lx.next()
        }
        const stmt = buf.trim()
        if (stmt.length > 0) stmts.push(parseExprRD(stmt))
        lx.eatWs()
      }
      if (lx.peek() === '}') lx.next()
      return { kind: 'Block', sid: sid('block'), stmts }
    }
    // identifier (possibly qualified with dots) or call
    let name = ''
    if (/[A-Za-z_]/.test(lx.peek())) {
      while (/[A-Za-z0-9_]/.test(lx.peek())) name += lx.next()
      // allow qualified: foo.bar.baz
      while (lx.peek() === '.') {
        name += lx.next()
        while (/[A-Za-z0-9_]/.test(lx.peek())) name += lx.next()
      }
      lx.eatWs()
      if (lx.peek() === '(') {
        lx.next()
        const args: Expr[] = []
        lx.eatWs()
        if (lx.peek() !== ')') {
          while (true) {
            const arg = parseAdd()
            args.push(arg)
            lx.eatWs()
            if (lx.peek() === ',') { lx.next(); lx.eatWs(); continue }
            break
          }
        }
        if (lx.peek() === ')') lx.next()
        // Effect call if first segment is a builtin effect
        const dotIdx = name.indexOf('.')
        if (dotIdx > 0) {
          const head = name.slice(0, dotIdx)
          const op = name.slice(dotIdx + 1)
          if (builtinEffects.has(head)) {
            return { kind: 'EffectCall', sid: sid('eff'), effect: head as any, op, args }
          }
        }
        // ADT constructor if starts with uppercase and is unqualified
        if (/^[A-Z]/.test(name) && !name.includes('.')) {
          return { kind: 'Ctor', sid: sid('ctor'), name, args } as any
        }
        // spawn as expression: spawn Name -> treat as Call to builtin spawn
        if (name === 'spawn' && args.length === 1 && args[0].kind === 'Var') {
          return { kind: 'Spawn', sid: sid('spawn'), actorName: (args[0] as any).name } as any
        }
        // ask as expression: ask actor, msg OR ask actor msg (optional comma)
        if (name === 'ask' && args.length === 2) {
          return { kind: 'Ask', sid: sid('ask'), actor: args[0], message: args[1] } as any
        }
        return { kind: 'Call', sid: sid('call'), callee: { kind: 'Var', sid: sid('var'), name }, args }
      }
      return { kind: 'Var', sid: sid('var'), name }
    }
    // fallback empty string literal
    return { kind: 'LitText', sid: sid('lit'), value: '' }
  }
  function parseMul(): Expr {
    let left = parsePrimary()
    while (true) {
      lx.eatWs()
      if (lx.peek() === '*' || lx.peek() === '/') {
        const op = lx.next() as '*' | '/'
        const right = parsePrimary()
        left = { kind: 'Binary', sid: sid('bin'), op, left, right }
      } else break
    }
    return left
  }
  function parseAdd(): Expr {
    let left = parseMul()
    while (true) {
      lx.eatWs()
      if (lx.peek() === '+' || lx.peek() === '-') {
        const op = lx.next() as '+' | '-'
        const right = parseMul()
        left = { kind: 'Binary', sid: sid('bin'), op, left, right }
      } else break
    }
    return left
  }
  const expr = parseAdd()
  return expr
}

export function parse(source: string): Expr {
  const rawLines = source.split(/\n+/)
  const lines = rawLines.map(s => s.trim()).filter(s => s.length > 0 && !s.startsWith('//'))
  const decls: Expr[] = []
  for (let idx = 0; idx < lines.length; idx++) {
    const ln = lines[idx]
    if (ln.startsWith('module ')) {
      const m = ln.match(/^module\s+([A-Za-z_][A-Za-z0-9_]*)$/)
      if (m) { decls.push({ kind: 'ModuleDecl', sid: sid('module'), name: m[1] } as any); continue }
    }
    if (ln.startsWith('import ')) {
      const m = ln.match(/^import\s+"([^"]+)"$/)
      if (m) {
        decls.push({ kind: 'ImportDecl', sid: sid('import'), path: m[1] } as any)
        continue
      }
    }
    if (ln.startsWith('enum ')) {
      // enum Name = A | B(Int, Text)
      const m = ln.match(/^enum\s+([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.+)$/)
      if (m) {
        const name = m[1]
        const rhs = m[2]
        const variants = rhs.split('|').map(s => s.trim()).filter(Boolean).map(v => {
          const mm = v.match(/^([A-Za-z_][A-Za-z0-9_]*)(?:\(([^)]*)\))?$/)
          const vname = mm?.[1] || v
          const params = (mm?.[2] || '').trim() ? (mm![2].split(',').map(x => x.trim()).filter(Boolean)) : []
          return { name: vname, params }
        })
        decls.push({ kind: 'EnumDecl', sid: sid('enum'), name, variants } as any)
        continue
      }
    }
    // actor block form: actor Name { ... }
    if (/^actor\s+[A-Za-z_][A-Za-z0-9_]*\s*\{$/.test(ln)) {
      const name = ln.match(/^actor\s+([A-Za-z_][A-Za-z0-9_]*)\s*\{$/)![1]
      const state: Array<{ name: string, type?: string, init: Expr }> = []
      const handlers: Array<{ pattern: Expr, replyType?: string, body: Expr }> = []
      idx++
      for (; idx < lines.length; idx++) {
        const line = lines[idx]
        if (line === '}') break
        if (line.startsWith('state ')) {
          const sm = line.match(/^state\s+([A-Za-z_][A-Za-z0-9_]*)\s*:\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.+)$/)
          if (sm) {
            state.push({ name: sm[1], type: sm[2], init: parseExprRD(sm[3]) })
            continue
          }
        }
        if (line.startsWith('on ')) {
          // on PATTERN [if COND] reply Type -> EXPR  |  on PATTERN [if COND] -> EXPR
          let hm = line.match(/^on\s+(.+?)\s+if\s+(.+?)\s+reply\s+([A-Za-z_][A-Za-z0-9_]*)\s*->\s*(.+)$/)
          if (hm) { handlers.push({ pattern: parseExprRD(hm[1]), replyType: hm[3], body: parseExprRD(hm[4]), guard: parseExprRD(hm[2]) } as any); continue }
          hm = line.match(/^on\s+(.+?)\s+reply\s+([A-Za-z_][A-Za-z0-9_]*)\s*->\s*(.+)$/)
          if (hm) { handlers.push({ pattern: parseExprRD(hm[1]), replyType: hm[2], body: parseExprRD(hm[3]) }); continue }
          hm = line.match(/^on\s+(.+?)\s+if\s+(.+?)\s*->\s*(.+)$/)
          if (hm) { handlers.push({ pattern: parseExprRD(hm[1]), body: parseExprRD(hm[3]), guard: parseExprRD(hm[2]) } as any); continue }
          hm = line.match(/^on\s+(.+)\s*->\s*(.+)$/)
          if (hm) { handlers.push({ pattern: parseExprRD(hm[1]), body: parseExprRD(hm[2]) }); continue }
        }
      }
      decls.push({ kind: 'ActorDeclNew', sid: sid('actorN'), name, state, handlers, effects: new Set() } as any)
      continue
    }
    if (ln.startsWith('let ')) {
      // let name[: Type]? = expr
      const m = ln.match(/^let\s+([A-Za-z_][A-Za-z0-9_]*)(?:\s*:\s*([A-Za-z_][A-Za-z0-9_]*))?\s*=\s*(.+)$/)
      if (m) {
        decls.push({ kind: 'Let', sid: sid('let'), name: m[1], type: m[2] || undefined, expr: parseExprRD(m[3]) } as any)
        continue
      }
    }
    if (ln.startsWith('fn ')) {
      // fn name(params[:Type, ...])[:Return]? [raises e1, e2] = expr
      const m = ln.match(/^fn\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(([^)]*)\)\s*(?::\s*([A-Za-z_][A-Za-z0-9_]*))?\s*(?:raises\s+([^=]+))?=\s*(.+)$/)
      if (m) {
        const params = m[2].trim() === '' ? [] : m[2].split(',').map(s => s.trim()).map(p => {
          const pm = p.match(/^([A-Za-z_][A-Za-z0-9_]*)(?:\s*:\s*([A-Za-z_][A-Za-z0-9_]*))?$/)
          return { name: pm?.[1] || p, type: pm?.[2] }
        })
        const returnType = m[3] || undefined
        const body = parseExprRD(m[5])
        const effects = new Set<string>() as any
        const raises = (m[4] ?? '').trim()
        if (raises) {
          for (const eff of raises.split(',').map(s => s.trim()).filter(Boolean)) effects.add(eff)
        }
        decls.push({ kind: 'Fn', sid: sid('fn'), name: m[1], params, returnType, body, effects } as any)
        continue
      }
    }
    if (ln.startsWith('actor ')) {
      // actor Name[(param[:Type])]? [raises e1,e2] = expr
      const m = ln.match(/^actor\s+([A-Za-z_][A-Za-z0-9_]*)\s*(?:\(([^:)]+)(?::\s*([A-Za-z_][A-Za-z0-9_]*))?\))?\s*(?:raises\s+([^=]+))?=\s*(.+)$/)
      if (m) {
        const name = m[1]
        const param = m[2] ? { name: m[2], type: m[3] || undefined } : null
        const effects = new Set<string>() as any
        const raises = (m[4] ?? '').trim()
        if (raises) for (const eff of raises.split(',').map(s => s.trim()).filter(Boolean)) effects.add(eff)
        const body = parseExprRD(m[5])
        decls.push({ kind: 'ActorDecl', sid: sid('actor'), name, param, body, effects } as any)
        continue
      }
    }
    if (ln.startsWith('spawn ')) {
      const m = ln.match(/^spawn\s+([A-Za-z_][A-Za-z0-9_.]*)$/)
      if (m) { decls.push({ kind: 'Spawn', sid: sid('spawn'), actorName: m[1] } as any); continue }
    }
    if (ln.startsWith('send ')) {
      // support both: send a, b   and send a b
      let m = ln.match(/^send\s+([^,\s]+)\s*,\s*(.+)$/)
      if (!m) m = ln.match(/^send\s+([^\s]+)\s+(.+)$/)
      if (m) { decls.push({ kind: 'Send', sid: sid('send'), actor: parseExprRD(m[1]), message: parseExprRD(m[2]) } as any); continue }
    }
    // Fallback: treat as bare expression declaration by synthesizing a let _N
    const name = `tmp_${decls.length}`
    decls.push({ kind: 'Let', sid: sid('let'), name, expr: parseExprRD(ln) })
  }
  return { kind: 'Program', sid: sid('prog'), decls }
}