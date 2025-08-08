export type Sid = string

export type Expr =
  | { kind: 'LitNum', sid: Sid, value: number }
  | { kind: 'LitText', sid: Sid, value: string }
  | { kind: 'LitBool', sid: Sid, value: boolean }
  | { kind: 'Var', sid: Sid, name: string }
  | { kind: 'Let', sid: Sid, name: string, type?: string, expr: Expr }
  | { kind: 'Fn', sid: Sid, name: string | null, params: Array<{ name: string, type?: string }>, returnType?: string, body: Expr, effects: EffectSet }
  | { kind: 'Call', sid: Sid, callee: Expr, args: Expr[] }
  | { kind: 'Binary', sid: Sid, op: '+' | '-' | '*' | '/', left: Expr, right: Expr }
  | { kind: 'EffectCall', sid: Sid, effect: Effect, op: string, args: Expr[] }
  | { kind: 'Block', sid: Sid, stmts: Expr[] }
  | { kind: 'Assign', sid: Sid, name: string, expr: Expr }
  | { kind: 'SchemaDecl', sid: Sid, name: string, fields: Record<string,string> }
  | { kind: 'StoreDecl', sid: Sid, name: string, schema: string, config: string | null }
  | { kind: 'QueryDecl', sid: Sid, name: string, source: string, predicate?: string }
  | { kind: 'ImportDecl', sid: Sid, path: string }
  | { kind: 'ModuleDecl', sid: Sid, name: string }
  | { kind: 'ActorDecl', sid: Sid, name: string, param: { name: string, type?: string } | null, body: Expr, effects: EffectSet }
  | { kind: 'ActorDeclNew', sid: Sid, name: string, state: Array<{ name: string, type?: string, init: Expr }>, handlers: Array<{ pattern: Expr, guard?: Expr, replyType?: string, body: Expr }>, effects: EffectSet }
  | { kind: 'Spawn', sid: Sid, actorName: string }
  | { kind: 'Send', sid: Sid, actor: Expr, message: Expr }
  | { kind: 'Ask', sid: Sid, actor: Expr, message: Expr }
  | { kind: 'Program', sid: Sid, decls: Expr[] }

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
    case 'LitText': return `LitText:${e.value}`
    case 'LitBool': return `LitBool:${e.value}`
    case 'Var': return `Var:${e.name}`
    case 'Let': return `Let:${e.name}:${(e.expr as any).sid ?? '?'}`
    case 'Fn': {
      const eff = Array.from(e.effects.values()).sort().join('|')
      return `Fn:${e.name ?? ''}(${e.params.join(',')}):${(e.body as any).sid ?? '?'}:${eff}`
    }
    case 'Call': return `Call:${(e.callee as any).sid ?? '?'}(${e.args.map(a => (a as any).sid ?? '?').join(',')})`
    case 'Binary': return `Binary:${e.op}:${(e.left as any).sid ?? '?'}:${(e.right as any).sid ?? '?'}`
    case 'EffectCall': return `EffectCall:${e.effect}:${e.op}(${e.args.map(a => (a as any).sid ?? '?').join(',')})`
    case 'SchemaDecl': return `SchemaDecl:${e.name}:${Object.entries(e.fields).map(([k,v])=>`${k}:${v}`).join(',')}`
    case 'StoreDecl': return `StoreDecl:${e.name}:${e.schema}:${e.config ?? ''}`
    case 'QueryDecl': return `QueryDecl:${e.name}:${e.source}:${e.predicate ?? ''}`
    case 'ImportDecl': return `ImportDecl:${e.path}`
    case 'ModuleDecl': return `ModuleDecl:${e.name}`
    case 'Block': return `Block:${e.stmts.map(s => (s as any).sid ?? '?').join(',')}`
    case 'Assign': return `Assign:${e.name}:${(e.expr as any).sid ?? '?'}`
    case 'ActorDecl': return `ActorDecl:${e.name}:${e.param?.name ?? ''}:${(e.body as any).sid ?? '?'}`
    case 'ActorDeclNew': return `ActorDeclNew:${e.name}:${e.state.map(s=>s.name).join('|')}:${e.handlers.length}`
    case 'Spawn': return `Spawn:${e.actorName}`
    case 'Send': return `Send:${(e.actor as any).sid ?? '?'}:${(e.message as any).sid ?? '?'}`
    case 'Ask': return `Ask:${(e.actor as any).sid ?? '?'}:${(e.message as any).sid ?? '?'}`
    case 'Program': return `Program:${e.decls.map(d => (d as any).sid ?? '?').join(',')}`
    default: return 'Unknown'
  }
}

export function assignStableSids(e: Expr): void {
  // Post-order traversal to ensure child sids exist first
  switch (e.kind) {
    case 'Program': for (const d of e.decls) assignStableSids(d); break
    case 'Let': assignStableSids(e.expr); break
    case 'Fn': assignStableSids(e.body); break
    case 'Call': assignStableSids(e.callee); for (const a of e.args) assignStableSids(a); break
    case 'Binary': assignStableSids(e.left); assignStableSids(e.right); break
    case 'EffectCall': for (const a of e.args) assignStableSids(a); break
    case 'ActorDecl': assignStableSids(e.body); break
    case 'Send': assignStableSids(e.actor); assignStableSids(e.message); break
    default: break
  }
  const sig = nodeSignature(e)
  const h = hashString(sig)
  e.sid = `${e.kind.toLowerCase()}:${h}`
}