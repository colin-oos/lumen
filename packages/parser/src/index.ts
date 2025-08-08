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
  const sendMatch = src.match(/^send\s+([^,\s]+)\s*(?:,\s*|\s+)([\s\S]+)$/)
  if (sendMatch) {
    return { kind: 'Send', sid: sid('send'), actor: parseExprRD(sendMatch[1]), message: parseExprRD(sendMatch[2]) } as any
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
    // expression-level match: match <expr> { pat -> expr; ... }
    if (lx.s.slice(lx['i'], lx['i'] + 5) === 'match' && /\b/.test(lx.s[lx['i'] + 5] || ' ')) {
      lx['i'] += 5
      lx.eatWs()
      const scr = parseAdd()
      lx.eatWs()
      if (lx.peek() === '{') {
        lx.next()
        const cases: any[] = []
        while (!lx.eof() && lx.peek() !== '}') {
          // read until ';' or '}'
          let depth = 0
          let buf = ''
          while (!lx.eof()) {
            const ch = lx.peek()
            if (ch === '{') depth++
            if (ch === '}') { if (depth === 0) break; depth-- }
            if ((ch === ';' || ch === '\n') && depth === 0) { lx.next(); break }
            buf += lx.next()
          }
          const stmt = buf.trim()
          if (stmt.length > 0) {
            let cm = stmt.match(/^(.+?)\s+if\s+(.+?)\s*->\s*(.+)$/)
            if (cm) cases.push({ pattern: parseExprRD(cm[1]), guard: parseExprRD(cm[2]), body: parseExprRD(cm[3]) })
            else {
              cm = stmt.match(/^(.+?)\s*->\s*(.+)$/)
              if (cm) cases.push({ pattern: parseExprRD(cm[1]), body: parseExprRD(cm[2]) })
            }
          }
          lx.eatWs()
        }
        if (lx.peek() === '}') lx.next()
        return { kind: 'Match', sid: sid('match'), scrutinee: scr, cases } as any
      }
    }
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
      // Decide between RecordLit and Block by scanning ahead for ':' vs ';'
      let j = lx['i'] + 1
      let depth = 0
      let sawColon = false
      let sawSemicolon = false
      while (j < lx.s.length) {
        const ch = lx.s[j]
        if (ch === '{') depth++
        else if (ch === '}') { if (depth === 0) break; depth-- }
        else if (depth === 0) {
          if (ch === ':') { sawColon = true; break }
          if (ch === ';') { sawSemicolon = true; break }
        }
        j++
      }
      if (sawColon && !sawSemicolon) {
        // Parse as RecordLit: { key: expr, key2: expr }
        lx.next()
        const fields: Array<{ name: string, expr: Expr }> = []
        lx.eatWs()
        if (lx.peek() !== '}') {
          while (true) {
            lx.eatWs(); let key = ''
            while (/[A-Za-z_]/.test(lx.peek())) key += lx.next()
            lx.eatWs(); if (lx.peek() === ':') lx.next(); lx.eatWs()
            const value = parseAdd(); fields.push({ name: key, expr: value })
            lx.eatWs(); if (lx.peek() === ',') { lx.next(); lx.eatWs(); continue }
            break
          }
        }
        if (lx.peek() === '}') lx.next()
        return { kind: 'RecordLit', sid: sid('rec'), fields }
      } else {
        // Block: { expr; expr; ... }
        lx.next()
        const stmts: Expr[] = []
        while (!lx.eof() && lx.peek() !== '}') {
          // read until ';' or '}'
          let depth2 = 0
          let buf = ''
          while (!lx.eof()) {
            const ch = lx.peek()
            if (ch === '{') depth2++
            if (ch === '}') { if (depth2 === 0) break; depth2-- }
            if (ch === ';' && depth2 === 0) { lx.next(); break }
            buf += lx.next()
          }
          const stmt = buf.trim()
          if (stmt.length > 0) stmts.push(parseExprRD(stmt))
          lx.eatWs()
        }
        if (lx.peek() === '}') lx.next()
        return { kind: 'Block', sid: sid('block'), stmts }
      }
    }
    // tuple or record literal shorthand
    if (lx.peek() === '[') {
      // allow [a, b] as tuple (alt syntax)
      lx.next(); const elements: Expr[] = []
      lx.eatWs(); if (lx.peek() !== ']') {
        while (true) { const el = parseAdd(); elements.push(el); lx.eatWs(); if (lx.peek() === ',') { lx.next(); lx.eatWs(); continue } break }
      }
      if (lx.peek() === ']') lx.next()
      return { kind: 'TupleLit', sid: sid('tuple'), elements }
    }
    // note: record literal handled above in '{' case
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
        // ADT constructor if the final segment starts with uppercase (qualified allowed)
        const lastSeg = name.includes('.') ? name.split('.').pop() || '' : name
        if (/^[A-Z]/.test(lastSeg)) {
          return { kind: 'Ctor', sid: sid('ctor'), name, args } as any
        }
        // spawn as expression: spawn Name -> treat as Call to builtin spawn
        if (name === 'spawn' && args.length === 1 && args[0].kind === 'Var') {
          return { kind: 'Spawn', sid: sid('spawn'), actorName: (args[0] as any).name } as any
        }
        // ask as expression: ask actor, msg OR ask actor msg (optional comma)
        if (name === 'ask' && (args.length === 2 || args.length === 3)) {
          const timeout = args.length === 3 && args[2].kind === 'LitNum' ? (args[2] as any).value : undefined
          return { kind: 'Ask', sid: sid('ask'), actor: args[0], message: args[1], timeoutMs: timeout } as any
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
        let rhs = m[3]
        if (/^match\b/.test(rhs) && (rhs.split('{').length - 1) > (rhs.split('}').length - 1)) {
          let depth = (rhs.match(/\{/g) || []).length - (rhs.match(/\}/g) || []).length
          while (depth > 0 && idx + 1 < lines.length) {
            idx++
            rhs += '\n' + lines[idx]
            depth += (lines[idx].match(/\{/g) || []).length - (lines[idx].match(/\}/g) || []).length
          }
        }
        decls.push({ kind: 'Let', sid: sid('let'), name: m[1], type: m[2] || undefined, expr: parseExprRD(rhs) } as any)
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
        let bodySrc = m[5]
        if (/^match\b/.test(bodySrc) && (bodySrc.split('{').length - 1) > (bodySrc.split('}').length - 1)) {
          let depth = (bodySrc.match(/\{/g) || []).length - (bodySrc.match(/\}/g) || []).length
          while (depth > 0 && idx + 1 < lines.length) {
            idx++
            bodySrc += '\n' + lines[idx]
            depth += (lines[idx].match(/\{/g) || []).length - (lines[idx].match(/\}/g) || []).length
          }
        }
        const body = parseExprRD(bodySrc)
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
    if (ln.startsWith('ask ')) {
      // ask a, b[, timeout]  or ask a b[, timeout]
      let m = ln.match(/^ask\s+([^,\s]+)\s*,\s*([^,\s]+)(?:\s*,\s*(\d+))?$/)
      if (!m) m = ln.match(/^ask\s+([^\s]+)\s+([^,\s]+)(?:\s*,\s*(\d+))?$/)
      if (m) {
        const actor = parseExprRD(m[1])
        const msg = parseExprRD(m[2])
        const timeout = m[3] ? Number(m[3]) : undefined
        decls.push({ kind: 'Ask', sid: sid('ask'), actor, message: msg, timeoutMs: timeout } as any)
        continue
      }
    }
    if (ln.startsWith('match ')) {
      // match expr { pattern [if guard] -> expr; ... }
      let mm = ln.match(/^match\s+(.+)\s*\{$/)
      if (mm) {
        const scr = parseExprRD(mm[1])
        idx += 1
        const cases: any[] = []
        for (; idx < lines.length; idx++) {
          const line = lines[idx]
          if (line === '}') break
          let cm = line.match(/^(.+?)\s+if\s+(.+?)\s*->\s*(.+)$/)
          if (cm) { cases.push({ pattern: parseExprRD(cm[1]), guard: parseExprRD(cm[2]), body: parseExprRD(cm[3]) }); continue }
          cm = line.match(/^(.+?)\s*->\s*(.+)$/)
          if (cm) { cases.push({ pattern: parseExprRD(cm[1]), body: parseExprRD(cm[2]) }); continue }
        }
        decls.push({ kind: 'Match', sid: sid('match'), scrutinee: scr, cases } as any)
        continue
      }
      mm = ln.match(/^match\s+(.+)$/)
      if (mm) {
        const scr = parseExprRD(mm[1])
        if (lines[idx + 1] && lines[idx + 1].trim() === '{') {
          idx += 2
          const cases: any[] = []
          for (; idx < lines.length; idx++) {
            const line = lines[idx]
            if (line === '}') break
            let cm = line.match(/^(.+?)\s+if\s+(.+?)\s*->\s*(.+)$/)
            if (cm) { cases.push({ pattern: parseExprRD(cm[1]), guard: parseExprRD(cm[2]), body: parseExprRD(cm[3]) }); continue }
            cm = line.match(/^(.+?)\s*->\s*(.+)$/)
            if (cm) { cases.push({ pattern: parseExprRD(cm[1]), body: parseExprRD(cm[2]) }); continue }
          }
          decls.push({ kind: 'Match', sid: sid('match'), scrutinee: scr, cases } as any)
          continue
        }
      }
    }
    if (ln.startsWith('schema ')) {
      // schema Name { f: Type, ... }
      const m = ln.match(/^schema\s+([A-Za-z_][A-Za-z0-9_]*)\s*\{$/)
      if (m) {
        const name = m[1]
        idx += 1
        const fields: Record<string, string> = {}
        for (; idx < lines.length; idx++) {
          const line = lines[idx]
          if (line === '}') break
          const fm = line.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*:\s*([A-Za-z_][A-Za-z0-9_]*)\s*,?$/)
          if (fm) fields[fm[1]] = fm[2]
        }
        decls.push({ kind: 'SchemaDecl', sid: sid('schema'), name, fields } as any)
        continue
      }
    }
    if (ln.startsWith('source ') || ln.startsWith('store ')) {
      // store Name : Schema = "config"
      const m = ln.match(/^(?:source|store)\s+([A-Za-z_][A-Za-z0-9_]*)\s*:\s*([A-Za-z_][A-Za-z0-9_]*)\s*(?:=\s*"([^"]*)")?$/)
      if (m) {
        decls.push({ kind: 'StoreDecl', sid: sid('store'), name: m[1], schema: m[2], config: m[3] ?? null } as any)
        continue
      }
    }
    if (ln.startsWith('query ')) {
      // query Name from Store where <expr> select a,b
      let m = ln.match(/^query\s+([A-Za-z_][A-Za-z0-9_]*)\s+from\s+([A-Za-z_][A-Za-z0-9_]*)\s+where\s+(.+)\s+select\s+(.+)$/)
      if (!m) m = ln.match(/^query\s+([A-Za-z_][A-Za-z0-9_]*)\s+from\s+([A-Za-z_][A-Za-z0-9_]*)(?:\s+select\s+(.+))?$/)
      if (m) {
        const name = m[1]
        const source = m[2]
        const where = m[3] && m[4] ? m[3] : (m[3] && !m[4] ? undefined : undefined)
        const select = m[4] || (m[3] && !m[4] ? m[3] : undefined)
        const predicate = where ? parseExprRD(where) : undefined
        const projection = select ? select.split(',').map(s => s.trim()).filter(Boolean) : undefined
        decls.push({ kind: 'QueryDecl', sid: sid('query'), name, source, predicate, projection } as any)
        continue
      }
    }
    // Fallback: treat as bare expression declaration by synthesizing a let _N
    const name = `tmp_${decls.length}`
    decls.push({ kind: 'Let', sid: sid('let'), name, expr: parseExprRD(ln) })
  }
  return { kind: 'Program', sid: sid('prog'), decls }
}