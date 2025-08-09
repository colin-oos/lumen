export type Sid = string

export type Span = { start: number, end: number, line?: number, col?: number }

export type Expr =
  | { kind: 'LitNum', sid: Sid, value: number, span?: Span }
  | { kind: 'LitFloat', sid: Sid, value: number, span?: Span }
  | { kind: 'LitText', sid: Sid, value: string, span?: Span }
  | { kind: 'LitBool', sid: Sid, value: boolean, span?: Span }
  | { kind: 'Var', sid: Sid, name: string, span?: Span }
  | { kind: 'Let', sid: Sid, name: string, type?: string, expr: Expr, mutable?: boolean, span?: Span }
  | { kind: 'Fn', sid: Sid, name: string | null, params: Array<{ name: string, type?: string }>, returnType?: string, body: Expr, effects: EffectSet, span?: Span }
  | { kind: 'Call', sid: Sid, callee: Expr, args: Expr[], span?: Span }
  | { kind: 'Unary', sid: Sid, op: 'not' | 'neg', expr: Expr, span?: Span }
  | { kind: 'Binary', sid: Sid, op: '+' | '-' | '*' | '/' | '%' | '==' | '!=' | '<' | '<=' | '>' | '>=' | 'and' | 'or', left: Expr, right: Expr, span?: Span }
  | { kind: 'If', sid: Sid, cond: Expr, then: Expr, else: Expr, span?: Span }
  | { kind: 'EffectCall', sid: Sid, effect: Effect, op: string, args: Expr[], span?: Span }
  | { kind: 'Block', sid: Sid, stmts: Expr[], span?: Span }
  | { kind: 'Assign', sid: Sid, name: string, expr: Expr, span?: Span }
  | { kind: 'RecordLit', sid: Sid, fields: Array<{ name: string, expr: Expr }>, span?: Span }
  | { kind: 'TupleLit', sid: Sid, elements: Expr[], span?: Span }
  | { kind: 'PatternOr', sid: Sid, left: Expr, right: Expr, span?: Span }
  | { kind: 'Match', sid: Sid, scrutinee: Expr, cases: Array<{ pattern: Expr, guard?: Expr, body: Expr }>, span?: Span }
  | { kind: 'SchemaDecl', sid: Sid, name: string, fields: Record<string,string>, span?: Span }
  | { kind: 'StoreDecl', sid: Sid, name: string, schema: string, config: string | null, span?: Span }
  | { kind: 'QueryDecl', sid: Sid, name: string, source: string, predicate?: Expr, projection?: string[], span?: Span }
  | { kind: 'ImportDecl', sid: Sid, path: string, name?: string, alias?: string, span?: Span }
  | { kind: 'ModuleDecl', sid: Sid, name: string, span?: Span }
  | { kind: 'EnumDecl', sid: Sid, name: string, variants: Array<{ name: string, params: string[] }>, span?: Span }
  | { kind: 'Ctor', sid: Sid, name: string, args: Expr[], span?: Span }
  | { kind: 'ActorDecl', sid: Sid, name: string, param: { name: string, type?: string } | null, body: Expr, effects: EffectSet, span?: Span }
  | { kind: 'ActorDeclNew', sid: Sid, name: string, state: Array<{ name: string, type?: string, init: Expr }>, handlers: Array<{ pattern: Expr, guard?: Expr, replyType?: string, body: Expr }>, effects: EffectSet, span?: Span }
  | { kind: 'Spawn', sid: Sid, actorName: string, span?: Span }
  | { kind: 'Send', sid: Sid, actor: Expr, message: Expr, span?: Span }
  | { kind: 'Ask', sid: Sid, actor: Expr, message: Expr, timeoutMs?: number, span?: Span }
  | { kind: 'Program', sid: Sid, decls: Expr[], span?: Span }

export type Effect =
  | 'pure' | 'io' | 'fs' | 'net' | 'db' | 'time' | 'nondet' | 'gpu' | 'unchecked'
  | string  // allow custom effects early

export type EffectSet = Set<Effect>

export function sid(prefix: string = 'sid'): Sid {
  // simple stable-ish SID generator stub (replace with crypto/random + stable mapping)
  return `${prefix}:${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`
}

export function program(decls: Expr[]): Expr {
  return { kind: 'Program', sid: sid('prog'), decls }
}

// Constructors (ergonomic helpers)
export const litNum = (n: number): Expr => ({ kind: 'LitNum', sid: sid('lit'), value: n })
export const litText = (t: string): Expr => ({ kind: 'LitText', sid: sid('lit'), value: t })
export const litBool = (b: boolean): Expr => ({ kind: 'LitBool', sid: sid('lit'), value: b })
export const variable = (name: string): Expr => ({ kind: 'Var', sid: sid('var'), name })
export const letBind = (name: string, expr: Expr): Expr => ({ kind: 'Let', sid: sid('let'), name, expr })
export const fnExpr = (name: string | null, params: Array<{ name: string, type?: string }>, body: Expr, effects: EffectSet = new Set()): Expr => ({ kind: 'Fn', sid: sid('fn'), name, params, body, effects })
export const call = (callee: Expr, args: Expr[]): Expr => ({ kind: 'Call', sid: sid('call'), callee, args })

// Stable SID assignment
function hashString(input: string): string {
  let h = 5381
  for (let i = 0; i < input.length; i++) h = ((h << 5) + h) ^ input.charCodeAt(i)
  return (h >>> 0).toString(36)
}

function nodeSignature(e: Expr): string {
  switch (e.kind) {
    case 'LitNum': return `LitNum:${e.value}`
    case 'LitFloat': return `LitFloat:${e.value}`
    case 'LitText': return `LitText:${e.value}`
    case 'LitBool': return `LitBool:${e.value}`
    case 'Var': return `Var:${e.name}`
    case 'Let': return `Let:${e.name}:${(e.expr as any).sid ?? '?'}`
    case 'Fn': {
      const eff = Array.from(e.effects.values()).sort().join('|')
      const paramsSig = (e.params as Array<{ name: string, type?: string }>).map(p => `${p.name}:${p.type ?? ''}`).join('|')
      return `Fn:${e.name ?? ''}(${paramsSig}):${(e.body as any).sid ?? '?'}:${eff}`
    }
    case 'Call': return `Call:${(e.callee as any).sid ?? '?'}(${e.args.map(a => (a as any).sid ?? '?').join(',')})`
    case 'Unary': return `Unary:${e.op}:${(e.expr as any).sid ?? '?'}`
    case 'Binary': return `Binary:${e.op}:${(e.left as any).sid ?? '?'}:${(e.right as any).sid ?? '?'}`
    case 'If': return `If:${(e.cond as any).sid ?? '?'}:${(e.then as any).sid ?? '?'}:${(e.else as any).sid ?? '?'}`
    case 'EffectCall': return `EffectCall:${e.effect}:${e.op}(${e.args.map(a => (a as any).sid ?? '?').join(',')})`
    case 'RecordLit': return `RecordLit:{${e.fields.map(f => `${f.name}:${(f.expr as any).sid ?? '?'}`).join(',')}}`
    case 'TupleLit': return `TupleLit:(${e.elements.map(a => (a as any).sid ?? '?').join(',')})`
    case 'PatternOr': return `PatternOr:${(e.left as any).sid ?? '?'}|${(e.right as any).sid ?? '?'}`
    case 'Match': return `Match:${(e.scrutinee as any).sid ?? '?'}:${e.cases.length}`
    case 'SchemaDecl': return `SchemaDecl:${e.name}:${Object.entries(e.fields).map(([k,v])=>`${k}:${v}`).join(',')}`
    case 'StoreDecl': return `StoreDecl:${e.name}:${e.schema}:${e.config ?? ''}`
    case 'QueryDecl': return `QueryDecl:${e.name}:${e.source}:${(e.predicate as any)?.sid ?? ''}:${(e.projection || []).join(',')}`
    case 'ImportDecl': return `ImportDecl:${e.path}:${e.alias ?? ''}`
    case 'ModuleDecl': return `ModuleDecl:${e.name}`
    case 'EnumDecl': return `EnumDecl:${e.name}:${e.variants.map(v=>`${v.name}(${v.params.join(',')})`).join('|')}`
    case 'Ctor': return `Ctor:${e.name}(${e.args.map(a => (a as any).sid ?? '?').join(',')})`
    case 'Block': return `Block:${e.stmts.map(s => (s as any).sid ?? '?').join(',')}`
    case 'Assign': return `Assign:${e.name}:${(e.expr as any).sid ?? '?'}`
    case 'ActorDecl': return `ActorDecl:${e.name}:${e.param?.name ?? ''}:${(e.body as any).sid ?? '?'}`
    case 'ActorDeclNew': return `ActorDeclNew:${e.name}:${e.state.map(s=>s.name).join('|')}:${e.handlers.length}`
    case 'Spawn': return `Spawn:${e.actorName}`
    case 'Send': return `Send:${(e.actor as any).sid ?? '?'}:${(e.message as any).sid ?? '?'}`
    case 'Ask': return `Ask:${(e.actor as any).sid ?? '?'}:${(e.message as any).sid ?? '?'}:${e.timeoutMs ?? ''}`
    case 'Program': return `Program:${e.decls.map(d => (d as any).sid ?? '?').join(',')}`
    default: return 'Unknown'
  }
}

export function assignStableSids(e: Expr): void {
  // Post-order traversal to ensure child sids exist first
  switch (e.kind) {
    case 'Program': for (const d of e.decls) assignStableSids(d); break
    case 'Let': assignStableSids(e.expr); break
    case 'Assign': assignStableSids(e.expr); break
    case 'Fn': assignStableSids(e.body); break
    case 'Call': assignStableSids(e.callee); for (const a of e.args) assignStableSids(a); break
    case 'Unary': assignStableSids(e.expr); break
    case 'Binary': assignStableSids(e.left); assignStableSids(e.right); break
    case 'If': assignStableSids(e.cond); assignStableSids(e.then); assignStableSids(e.else); break
    case 'Block': for (const s of e.stmts) assignStableSids(s); break
    case 'EffectCall': for (const a of e.args) assignStableSids(a); break
    case 'RecordLit': for (const f of e.fields) assignStableSids(f.expr); break
    case 'TupleLit': for (const a of e.elements) assignStableSids(a); break
    case 'PatternOr': assignStableSids(e.left); assignStableSids(e.right); break
    case 'Match': assignStableSids(e.scrutinee); for (const c of e.cases as any[]) { if (c.pattern) assignStableSids(c.pattern); if (c.guard) assignStableSids(c.guard); if (c.body) assignStableSids(c.body) } break
    case 'SchemaDecl': break
    case 'StoreDecl': break
    case 'QueryDecl': if (e.predicate) assignStableSids(e.predicate); break
    case 'Ctor': for (const a of e.args) assignStableSids(a); break
    case 'ActorDecl': assignStableSids(e.body); break
    case 'ActorDeclNew':
      for (const s of e.state) assignStableSids(s.init as any)
      for (const h of e.handlers as any[]) { if (h.pattern) assignStableSids(h.pattern); if (h.guard) assignStableSids(h.guard); if (h.body) assignStableSids(h.body) }
      break
    case 'Send': assignStableSids(e.actor); assignStableSids(e.message); break
    case 'Ask': assignStableSids(e.actor); assignStableSids(e.message); break
    default: break
  }
  const sig = nodeSignature(e)
  const h = hashString(sig)
  e.sid = `${e.kind.toLowerCase()}:${h}`
}