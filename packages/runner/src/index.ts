import { Expr } from '@lumen/core-ir'
import { isSqliteConfig, loadSqlite } from './adapters/sqlite'
import { httpGet, httpPost } from './adapters/http'

export interface RunResult {
  value: unknown
  trace: Array<{ sid: string, note: string }>
  denials?: Array<{ effect: string, reason: string }>
}

const LOOP_BREAK = Symbol.for('lumen.break')
const LOOP_CONTINUE = Symbol.for('lumen.continue')

function hash32(s: string): number {
  let h = 2166136261 >>> 0
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0 }
  return h >>> 0
}

export function run(ast: Expr, options?: { deniedEffects?: Set<string>, mockEffects?: boolean, schedulerSeed?: string }): RunResult {
  const trace: RunResult['trace'] = []
  const denials: Array<{ effect: string, reason: string }> = []
  const env = new Map<string, unknown>()
  let currentModule: string | null = null
  // simple actor mailbox map
  const mailboxes = new Map<string, Array<unknown>>()
  const actors = new Map<string, { paramName?: string, body?: Expr, effects: Set<string>, state?: Map<string, unknown>, handlers?: Array<{ match: (msg: unknown)=>{ ok: boolean, binds: Map<string, unknown> }, guard?: Expr, reply?: (msg: unknown, binds: Map<string, unknown>)=>unknown, run: (binds: Map<string, unknown>)=>unknown }> }>()
  const effectStack: Array<Set<string> | null> = []
  const stores = new Map<string, Array<any>>()

  // Inject minimal stdlib builtins (deterministic, pure)
  env.set('stdlib.length', (s: unknown) => typeof s === 'string' ? (s as string).length : (Array.isArray(s) ? (s as any[]).length : 0))
  env.set('stdlib.uppercase', (s: unknown) => typeof s === 'string' ? (s as string).toUpperCase() : s)
  env.set('stdlib.lowercase', (s: unknown) => typeof s === 'string' ? (s as string).toLowerCase() : s)
  env.set('stdlib.startsWith', (s: unknown, prefix: unknown) => typeof s === 'string' && typeof prefix === 'string' ? (s as string).startsWith(prefix as string) : false)
  env.set('stdlib.endsWith', (s: unknown, suffix: unknown) => typeof s === 'string' && typeof suffix === 'string' ? (s as string).endsWith(suffix as string) : false)
  env.set('stdlib.contains', (s: unknown, sub: unknown) => typeof s === 'string' && typeof sub === 'string' ? (s as string).includes(sub as string) : false)
  env.set('stdlib.map', (xs: unknown, f: any) => Array.isArray(xs) && typeof f === 'function' ? (xs as any[]).map((x: any) => f(x)) : [])
  env.set('stdlib.filter', (xs: unknown, f: any) => Array.isArray(xs) && typeof f === 'function' ? (xs as any[]).filter((x: any) => Boolean(f(x))) : [])
  env.set('stdlib.reduce', (xs: unknown, init: unknown, f: any) => Array.isArray(xs) && typeof f === 'function' ? (xs as any[]).reduce((a: any, x: any) => f(a, x), init) : init)
  env.set('stdlib.hasSet', (xs: unknown, x: unknown) => Array.isArray(xs) ? (xs as any[]).some(v => JSON.stringify(v) === JSON.stringify(x)) : false)
  env.set('stdlib.getMap', (xs: unknown, k: unknown, def: unknown) => {
    if (!Array.isArray(xs)) return def
    for (const pair of xs as any[]) { if (Array.isArray(pair) && pair.length >= 2 && JSON.stringify(pair[0]) === JSON.stringify(k)) return pair[1] }
    return def
  })
  env.set('stdlib.setMap', (xs: unknown, k: unknown, v: unknown) => {
    const out: any[] = []
    let replaced = false
    if (Array.isArray(xs)) {
      for (const pair of xs as any[]) {
        if (Array.isArray(pair) && pair.length >= 2 && JSON.stringify(pair[0]) === JSON.stringify(k)) { out.push([k, v]); replaced = true }
        else out.push(pair)
      }
    }
    if (!replaced) out.push([k, v])
    return out
  })
  env.set('stdlib.any', (xs: unknown, f: any) => Array.isArray(xs) && typeof f === 'function' ? (xs as any[]).some((x: any) => Boolean(f(x))) : false)
  env.set('stdlib.all', (xs: unknown, f: any) => Array.isArray(xs) && typeof f === 'function' ? (xs as any[]).every((x: any) => Boolean(f(x))) : false)
  env.set('stdlib.unique', (xs: unknown) => Array.isArray(xs) ? (xs as any[]).filter((v, i, a) => a.findIndex(z => JSON.stringify(z) === JSON.stringify(v)) === i) : [])
  env.set('stdlib.union', (a: unknown, b: unknown) => {
    const aa = Array.isArray(a) ? (a as any[]) : []
    const bb = Array.isArray(b) ? (b as any[]) : []
    const combined = aa.concat(bb)
    return (combined as any[]).filter((v, i, arr) => arr.findIndex(z => JSON.stringify(z) === JSON.stringify(v)) === i)
  })
  env.set('stdlib.intersect', (a: unknown, b: unknown) => {
    const aa = Array.isArray(a) ? (a as any[]) : []
    const bb = Array.isArray(b) ? (b as any[]) : []
    return aa.filter(x => bb.findIndex(z => JSON.stringify(z) === JSON.stringify(x)) >= 0).filter((v, i, arr) => arr.findIndex(z => JSON.stringify(z) === JSON.stringify(v)) === i)
  })
  env.set('stdlib.keys', (xs: unknown) => Array.isArray(xs) ? (xs as any[]).map(p => Array.isArray(p) ? p[0] : null).filter(x => x !== null) : [])
  env.set('stdlib.values', (xs: unknown) => Array.isArray(xs) ? (xs as any[]).map(p => Array.isArray(p) ? p[1] : null).filter(x => x !== null) : [])
  env.set('stdlib.lengthList', (xs: unknown) => Array.isArray(xs) ? (xs as any[]).length : 0)
  env.set('stdlib.head', (xs: unknown) => Array.isArray(xs) && (xs as any[]).length > 0 ? (xs as any[])[0] : null)
  env.set('stdlib.tail', (xs: unknown) => Array.isArray(xs) && (xs as any[]).length > 0 ? (xs as any[]).slice(1) : [])
  env.set('stdlib.trim', (s: unknown) => typeof s === 'string' ? (s as string).trim() : s)
  env.set('stdlib.split', (s: unknown, sep: unknown) => typeof s === 'string' && typeof sep === 'string' ? (s as string).split(sep as string) : [])
  env.set('stdlib.join', (xs: unknown, sep: unknown) => Array.isArray(xs) && typeof sep === 'string' ? (xs as any[]).join(sep as string) : '')
  env.set('stdlib.replace', (s: unknown, a: unknown, b: unknown) => typeof s === 'string' && typeof a === 'string' && typeof b === 'string' ? (s as string).split(a as string).join(b as string) : s)
  env.set('stdlib.padLeft', (s: unknown, n: unknown, ch: unknown) => {
    const str = typeof s === 'string' ? s : String(s)
    const width = typeof n === 'number' ? n : Number(n)
    const fill = typeof ch === 'string' && ch.length > 0 ? ch[0] : ' '
    if (!isFinite(width) || width <= str.length) return str
    return fill.repeat(width - str.length) + str
  })
  env.set('stdlib.padRight', (s: unknown, n: unknown, ch: unknown) => {
    const str = typeof s === 'string' ? s : String(s)
    const width = typeof n === 'number' ? n : Number(n)
    const fill = typeof ch === 'string' && ch.length > 0 ? ch[0] : ' '
    if (!isFinite(width) || width <= str.length) return str
    return str + fill.repeat(width - str.length)
  })
  env.set('stdlib.concat', (xs: unknown, ys: unknown) => (Array.isArray(xs) ? xs : []).concat(Array.isArray(ys) ? ys : []))
  env.set('stdlib.flatten', (xss: unknown) => Array.isArray(xss) ? (xss as any[]).reduce((a, x) => a.concat(Array.isArray(x) ? x : [x]), [] as any[]) : [])

  function wrapMessage(m: unknown): { value: unknown, sink?: { done: boolean, value?: unknown } } {
    if (m && typeof m === 'object' && 'value' in (m as any)) return m as any
    return { value: m }
  }

  function processMailboxesUntil(predicate?: () => boolean): void {
    let progressed = true
    let tick = 0
    const seed = options?.schedulerSeed ?? ''
    while (progressed) {
      if (predicate && predicate()) return
      progressed = false
      // deterministically order actor names per tick using seed
      const entries = Array.from(mailboxes.entries())
      entries.sort((a, b) => {
        const ha = hash32(a[0] + ':' + tick + ':' + seed)
        const hb = hash32(b[0] + ':' + tick + ':' + seed)
        return ha - hb
      })
      for (const [name, queue] of entries) {
        if (!queue.length) continue
        const msgObj = wrapMessage(queue.shift() as any)
        const actor = actors.get(name)
        if (!actor) continue
        // Param-style actor
        if (actor.body && actor.paramName) {
          const prevEnv = new Map(env)
          env.set(actor.paramName, msgObj.value)
          const allowed = actor.effects instanceof Set ? actor.effects : new Set<string>(Array.isArray(actor.effects as any) ? (actor.effects as any as string[]) : [])
          effectStack.push(allowed)
          try { evalExpr(actor.body) } finally {
            effectStack.pop(); env.clear(); for (const [k,v] of prevEnv) env.set(k,v)
          }
          progressed = true
          continue
        }
        // Handler-style actor
        if (actor.handlers && actor.state) {
          let chosen: { h: any, binds: Map<string, unknown> } | null = null
          for (const h of actor.handlers) {
            const res = h.match(msgObj.value)
            if (res.ok) { chosen = { h, binds: res.binds }; break }
          }
          if (chosen) {
            const prevEnv = new Map(env)
            // load state into env and binds
            for (const [k,v] of actor.state) env.set(k, v)
            for (const [k,v] of chosen.binds) env.set(k, v)
            const allowed = actor.effects instanceof Set ? actor.effects : new Set<string>(Array.isArray(actor.effects as any) ? (actor.effects as any as string[]) : [])
            effectStack.push(allowed)
            try {
              // guard check (must be pure, we just evaluate expression)
              let guardOk = true
              const hAny: any = chosen.h
              if (hAny.guard) {
                const hasEffectCall = (expr: any): boolean => {
                  if (!expr || typeof expr !== 'object') return false
                  if (expr.kind === 'EffectCall') return true
                  for (const k of Object.keys(expr)) {
                    const v = (expr as any)[k]
                    if (v && typeof v === 'object' && 'kind' in v) { if (hasEffectCall(v)) return true }
                    if (Array.isArray(v)) { for (const it of v) if (it && typeof it === 'object' && 'kind' in it) { if (hasEffectCall(it)) return true } }
                  }
                  return false
                }
                if (hasEffectCall(hAny.guard)) guardOk = false
                else guardOk = Boolean(evalExpr(hAny.guard as any))
              }
              let result: unknown = null
              if (guardOk) result = chosen.h.run(chosen.binds)
              // write back state
              for (const [k] of actor.state) actor.state.set(k, env.get(k))
              if (msgObj.sink && chosen.h.reply) { msgObj.sink.done = true; msgObj.sink.value = chosen.h.reply(msgObj.value, chosen.binds) }
            } finally {
              effectStack.pop(); env.clear(); for (const [k,v] of prevEnv) env.set(k,v)
            }
            progressed = true
          }
        }
      }
      tick++
    }
  }

  function truthy(b: unknown): boolean { return Boolean(b) }

  function matchPattern(pat: Expr, val: any): { ok: boolean, binds: Map<string, unknown> } {
    const binds = new Map<string, unknown>()
    const isCtor = (v: any) => v && typeof v === 'object' && '$' in v && Array.isArray((v as any).values)
    const equal = (a: any, b: any): boolean => JSON.stringify(a) === JSON.stringify(b)
    function merge(a: Map<string, unknown>, b: Map<string, unknown>): Map<string, unknown> | null {
      const out = new Map(a)
      for (const [k,v] of b) { if (out.has(k) && out.get(k) !== v) return null; out.set(k, v) }
      return out
    }
    function go(p: Expr, v: any): { ok: boolean, binds: Map<string, unknown> } {
      switch (p.kind) {
        case 'Var': {
          const name = p.name
          if (name === '_' || name === '*') return { ok: true, binds: new Map() }
          const m = new Map<string, unknown>()
          m.set(name, v)
          return { ok: true, binds: m }
        }
        case 'LitNum':
        case 'LitFloat':
        case 'LitText':
        case 'LitBool':
          return { ok: equal(evalExpr(p), v), binds: new Map() }
        case 'Ctor': {
          if (!isCtor(v)) return { ok: false, binds: new Map() }
          const vv = v as any
          if (vv.$ !== p.name) return { ok: false, binds: new Map() }
          if (p.args.length !== vv.values.length) return { ok: false, binds: new Map() }
          let acc = new Map<string, unknown>()
          for (let i = 0; i < p.args.length; i++) {
            const r = go(p.args[i], vv.values[i])
            if (!r.ok) return { ok: false, binds: new Map() }
            const merged = merge(acc, r.binds)
            if (!merged) return { ok: false, binds: new Map() }
            acc = merged
          }
          return { ok: true, binds: acc }
        }
        case 'RecordLit': {
          if (!v || typeof v !== 'object') return { ok: false, binds: new Map() }
          let acc = new Map<string, unknown>()
          for (const f of (p as any).fields as Array<{ name: string, expr: Expr }>) {
            const r = go(f.expr, (v as any)[f.name])
            if (!r.ok) return { ok: false, binds: new Map() }
            const merged = merge(acc, r.binds)
            if (!merged) return { ok: false, binds: new Map() }
            acc = merged
          }
          return { ok: true, binds: acc }
        }
        case 'TupleLit': {
          if (!Array.isArray(v)) return { ok: false, binds: new Map() }
          if (p.elements.length !== v.length) return { ok: false, binds: new Map() }
          let acc = new Map<string, unknown>()
          for (let i = 0; i < p.elements.length; i++) {
            const r = go(p.elements[i], v[i])
            if (!r.ok) return { ok: false, binds: new Map() }
            const merged = merge(acc, r.binds)
            if (!merged) return { ok: false, binds: new Map() }
            acc = merged
          }
          return { ok: true, binds: acc }
        }
        case 'PatternOr': {
          const left = go((p as any).left, v)
          if (left.ok) return left
          return go((p as any).right, v)
        }
        default:
          return { ok: equal(evalExpr(p), v), binds: new Map() }
      }
    }
    const res = go(pat, val)
    return res
  }

  function evalExpr(e: Expr): unknown {
    trace.push({ sid: (e as any).sid ?? 'unknown', note: e.kind })
    switch (e.kind) {
      case 'Program': {
        let last: unknown = null
        for (const d of e.decls) {
          // Top-level function declarations bind their name
          if (d.kind === 'Fn' && d.name) {
            const fnv = evalExpr(d)
            const key = currentModule ? `${currentModule}.${d.name}` : d.name
            if (!env.has(key)) env.set(key, fnv)
            last = fnv
          } else if (d.kind === 'ModuleDecl') {
            currentModule = d.name
            last = null
          } else if (d.kind === 'EnumDecl') {
            // no runtime binding needed for enum decls in MVP
            last = null
          } else if (d.kind === 'SchemaDecl' || d.kind === 'StoreDecl' || d.kind === 'QueryDecl') {
            // schema is compile-time only (no op)
            if (d.kind === 'StoreDecl') {
              // If config is provided, attempt to load JSON array
              if (d.config) {
                const data = evalExpr({ kind: 'EffectCall', sid: 'eff:dbload', effect: 'db' as any, op: 'load', args: [{ kind: 'LitText', sid: 'lit', value: d.config } as any] } as any)
                if (Array.isArray(data)) stores.set(d.name, data as any)
                else stores.set(d.name, [])
              } else stores.set(d.name, [])
            }
            if (d.kind === 'QueryDecl') {
              const key = currentModule ? `${currentModule}.${d.name}` : d.name
              // if store name exists and was loaded from sqlite, we can eval where/projection via adapter against store config
              const storeDecl = (ast as any).decls?.find((x: any) => x.kind === 'StoreDecl' && x.name === d.source)
              const whereFn = d.predicate ? (row: Record<string, unknown>) => {
                const prev = new Map(env)
                env.clear()
                for (const [k, v] of Object.entries(row)) env.set(k, v)
                let ok = true
                try { ok = Boolean(evalExpr((d.predicate as any))) } finally { env.clear(); for (const [k,v] of prev) env.set(k,v) }
                return ok
              } : undefined
              if (storeDecl && isSqliteConfig(storeDecl.config)) {
                const arr = loadSqlite(storeDecl.config as string, whereFn, d.projection as any)
                env.set(key, arr)
              } else {
                const rows = stores.get(d.source) || []
                const results: any[] = []
                for (const row of rows) {
                  let pass = true
                  if (whereFn) pass = whereFn(row as any)
                  if (!pass) continue
                  if (d.projection && d.projection.length > 0) {
                    const proj: any = {}
                    for (const f of d.projection) proj[f] = (row as any)[f]
                    results.push(proj)
                  } else results.push(row)
                }
                env.set(key, results)
              }
            }
            last = null
          } else if (d.kind === 'ActorDecl') {
            const key = currentModule ? `${currentModule}.${d.name}` : d.name
            actors.set(key, { paramName: d.param?.name, body: d.body, effects: d.effects as any })
            mailboxes.set(key, [])
            last = null
          } else if (d.kind === 'ActorDeclNew') {
            const key = currentModule ? `${currentModule}.${d.name}` : d.name
            const state = new Map<string, unknown>()
            for (const s of d.state as any[]) state.set(s.name, evalExpr(s.init))
            const handlers = (d.handlers as any[]).map(h => ({
              match: (msg: unknown) => matchPattern(h.pattern as any, msg),
              guard: h.guard ? (h.guard as any) : undefined,
              reply: h.replyType ? (_msg: unknown, binds: Map<string, unknown>) => {
                const prev = new Map(env); for (const [k,v] of binds) env.set(k, v)
                try { return evalExpr(h.body) } finally { env.clear(); for (const [k,v] of prev) env.set(k,v) }
              } : undefined,
              run: (binds: Map<string, unknown>) => {
                const prev = new Map(env); for (const [k,v] of binds) env.set(k, v)
                try { return evalExpr(h.body) } finally { env.clear(); for (const [k,v] of prev) env.set(k,v) }
              }
            }))
            actors.set(key, { effects: d.effects as any, state, handlers })
            mailboxes.set(key, [])
            last = null
          } else if (d.kind === 'Spawn') {
            const key = currentModule ? `${currentModule}.${d.actorName}` : d.actorName
            if (!mailboxes.has(key)) mailboxes.set(key, [])
            last = key
          } else if (d.kind === 'Send') {
            const target = evalExpr(d.actor)
            const mb = mailboxes.get(String(target))
            if (mb) mb.push(evalExpr(d.message))
            last = null
          } else {
            last = evalExpr(d)
          }
        }
        // Deterministic actor message processing: drain mailboxes
        processMailboxesUntil()
        return last
      }
      case 'Let': {
        const v = evalExpr(e.expr)
        env.set(e.name, v)
        return v
      }
      case 'Assign': {
        const v = evalExpr(e.expr)
        env.set(e.name, v)
        return v
      }
      case 'LitText': return e.value
      case 'LitFloat': return e.value
      case 'LitNum': return e.value
      case 'LitBool': return e.value
      case 'Var': {
        // support qualified var lookup: foo.bar -> treat as flat key
        const key = e.name
        if (!env.has(key)) return `(unbound ${e.name})`
        return env.get(key)
      }
      case 'Fn': {
        // closure over current env snapshot
        const closureEnv = new Map(env)
        const fnWrapper = function(...args: unknown[]) {
          const local = new Map(closureEnv)
          ;(e.params as Array<{ name: string }>).forEach((p, i) => local.set(p.name, args[i]))
          // Replace env temporarily
          const prev = new Map(env)
          env.clear(); for (const [k,v] of local) env.set(k,v)
          try { return evalExpr(e.body) }
          finally { env.clear(); for (const [k,v] of prev) env.set(k,v) }
        } as any
        ;(fnWrapper as any).lumenEffects = e.effects
        ;(fnWrapper as any).lumenName = e.name ?? '<anon>'
        return fnWrapper
      }
      case 'Call': {
        const callee = evalExpr(e.callee)
        const args = e.args.map(evalExpr)
        if (typeof callee === 'function') {
          const fx: Set<string> | undefined = (callee as any).lumenEffects
          if (fx && options?.deniedEffects && intersects(fx, options.deniedEffects)) {
            const eff = Array.from(fx).find(x => options.deniedEffects!.has(x)) as string
            denials.push({ effect: eff, reason: 'policy-deny' })
            return `(denied effect ${eff})`
          }
          // Enforce actor-allowed effects if present
          const allowed = effectStack.length ? effectStack[effectStack.length - 1] : null
          if (fx && allowed) {
            if (!(allowed instanceof Set)) { for (const eff of fx) { denials.push({ effect: eff, reason: 'actor-cap' }); return `(denied effect ${eff})` } }
            for (const eff of fx) if (!(allowed as Set<string>).has(eff)) { denials.push({ effect: eff, reason: 'actor-cap' }); return `(denied effect ${eff})` }
          }
          return (callee as any)(...args)
        }
        return `(not-callable ${String(callee)})`
      }
      case 'Ctor': {
        const values = e.args.map(evalExpr)
        return { $: e.name, values }
      }
      case 'Spawn': {
        const key = currentModule ? `${currentModule}.${e.actorName}` : e.actorName
        if (!mailboxes.has(key)) mailboxes.set(key, [])
        return key
      }
      case 'EffectCall': {
        // Enforce runtime deny for effect
        const eff = e.effect as string
        if (options?.deniedEffects && options.deniedEffects.has(eff)) { denials.push({ effect: eff, reason: 'policy-deny' }); return `(denied effect ${eff})` }
        const allowed = effectStack.length ? effectStack[effectStack.length - 1] : null
        if (allowed) {
          if (!(allowed instanceof Set)) { denials.push({ effect: eff, reason: 'actor-cap' }); return `(denied effect ${eff})` }
          if (!(allowed as Set<string>).has(eff)) { denials.push({ effect: eff, reason: 'actor-cap' }); return `(denied effect ${eff})` }
        }
        // Minimal effect hooks
        if (e.effect === 'io' && e.op === 'print') {
          // eslint-disable-next-line no-console
          console.log(...e.args.map(evalExpr))
          return null
        }
        if (e.effect === 'net') {
          const args = e.args.map(evalExpr)
          if (e.op === 'get') {
            if (options?.mockEffects) return `MOCK:GET ${String(args[0])}`
            return `(net.get ${String(args[0])})`
          }
        }
        if (e.effect === 'time') {
          if (e.op === 'now') return options?.mockEffects ? 0 : `(time.now)`
          if (e.op === 'sleep') return null
        }
        if (e.effect === 'db') {
          const args = e.args.map(evalExpr)
          if (e.op === 'load') {
            try {
              const p = String(args[0])
              if (isSqliteConfig(p)) return loadSqlite(p)
              const raw = require('fs').readFileSync(p, 'utf8')
              return JSON.parse(raw)
            } catch { return `(db.load error)` }
          }
        }
        if (e.effect === 'http') {
          const args = e.args.map(evalExpr)
          if (e.op === 'get') return httpGet(String(args[0]))
          if (e.op === 'post') return httpPost(String(args[0]), String(args[1] ?? ''))
        }
        if (e.effect === 'fs') {
          const args = e.args.map(evalExpr)
          if (e.op === 'read') {
            try {
              const p = String(args[0])
              return require('fs').readFileSync(p, 'utf8')
            } catch { return `(fs.read error)` }
          }
          if (e.op === 'write') {
            try {
              const p = String(args[0])
              const data = String(args[1])
              require('fs').writeFileSync(p, data, 'utf8')
              return null
            } catch { return `(fs.write error)` }
          }
        }
        return `(effect ${e.effect}.${e.op})`
      }
      case 'Ask': {
        const actorRef = evalExpr(e.actor)
        const message = evalExpr(e.message)
        const sink: { done: boolean, value?: unknown } = { done: false }
        const mb = mailboxes.get(String(actorRef)) || []
        mailboxes.set(String(actorRef), mb)
        mb.push({ value: message, sink })
        if (e.timeoutMs && e.timeoutMs > 0) {
          const start = Date.now()
          processMailboxesUntil(() => sink.done || (Date.now() - start) >= e.timeoutMs!)
          return sink.done ? (sink.value ?? null) : `(timeout ${e.timeoutMs})`
        } else {
          processMailboxesUntil(() => sink.done)
          return sink.value ?? null
        }
      }
      case 'Unary': {
        const v = evalExpr(e.expr)
        if (e.op === 'not') return !truthy(v)
        if (e.op === 'neg') return -(v as any)
        return null
      }
      case 'Binary': {
        const l = evalExpr(e.left)
        const r = evalExpr(e.right)
        switch (e.op) {
          case '+': {
            if (Array.isArray(l) && Array.isArray(r)) return (l as any[]).concat(r as any[])
            return (l as any) + (r as any)
          }
          case '-': return (l as any) - (r as any)
          case '*': return (l as any) * (r as any)
          case '/': return (l as any) / (r as any)
          case '%': return (l as any) % (r as any)
          case '==': return JSON.stringify(l) === JSON.stringify(r)
          case '!=': return JSON.stringify(l) !== JSON.stringify(r)
          case '<': return (l as any) < (r as any)
          case '<=': return (l as any) <= (r as any)
          case '>': return (l as any) > (r as any)
          case '>=': return (l as any) >= (r as any)
          case 'and': return truthy(l) && truthy(r)
          case 'or': return truthy(l) || truthy(r)
        }
        return null
      }
      case 'If': {
        const c = evalExpr(e.cond)
        return truthy(c) ? evalExpr(e.then) : evalExpr(e.else)
      }
      case 'While': {
        while (truthy(evalExpr(e.cond))) {
          try { evalExpr((e as any).body) } catch (x) { if (x === LOOP_BREAK) break; else if (x === LOOP_CONTINUE) continue; else throw x }
        }
        return null
      }
      case 'For': {
        const it = evalExpr(e.iter)
        const arr = Array.isArray(it) ? it : []
        for (const v of arr) {
          env.set(e.name, v)
          try { evalExpr(e.body) } catch (x) { if (x === LOOP_BREAK) break; else if (x === LOOP_CONTINUE) continue; else throw x }
        }
        return null
      }
      case 'Break': throw LOOP_BREAK
      case 'Continue': throw LOOP_CONTINUE
      case 'RecordLit': {
        const obj: any = {}
        for (const f of e.fields as any[]) obj[f.name] = evalExpr(f.expr)
        return obj
      }
      case 'TupleLit': {
        return (e.elements as any[]).map(x => evalExpr(x))
      }
      case 'SetLit': {
        return (e.elements as any[]).map(x => evalExpr(x))
      }
      case 'MapLit': {
        const out: Array<[unknown, unknown]> = []
        for (const en of (e as any).entries as Array<{ key: Expr, value: Expr }>) out.push([evalExpr(en.key), evalExpr(en.value)])
        return out
      }
      case 'Match': {
        const value = evalExpr(e.scrutinee)
        const hasEffectCall = (expr: any): boolean => {
          if (!expr || typeof expr !== 'object') return false
          if (expr.kind === 'EffectCall') return true
          for (const k of Object.keys(expr)) {
            const v = (expr as any)[k]
            if (v && typeof v === 'object' && 'kind' in v) { if (hasEffectCall(v)) return true }
            if (Array.isArray(v)) { for (const it of v) if (it && typeof it === 'object' && 'kind' in it) { if (hasEffectCall(it)) return true } }
          }
          return false
        }
        for (const c of e.cases as any[]) {
          const res = matchPattern(c.pattern, value)
          if (res.ok) {
            if (c.guard) {
              const prev = new Map(env); for (const [k,v] of res.binds) env.set(k, v)
              try {
                if (hasEffectCall(c.guard)) { for (const [k] of res.binds) env.delete(k); continue }
                const g = evalExpr(c.guard)
                if (!g) { for (const [k] of res.binds) env.delete(k); continue }
              } finally {
                env.clear(); for (const [k,v] of prev) env.set(k, v)
              }
            }
            const prev = new Map(env); for (const [k,v] of res.binds) env.set(k, v)
            try { return evalExpr(c.body) } finally { env.clear(); for (const [k,v] of prev) env.set(k, v) }
          }
        }
        return null
      }
      case 'Block': {
        let last: unknown = null
        for (const s of e.stmts) last = evalExpr(s)
        return last
      }
      default: return null
    }
  }
  const value = evalExpr(ast)
  return { value, trace, denials }
}
function intersects(a: Set<string>, b: Set<string>): boolean {
  for (const v of a) if (b.has(v)) return true
  return false
}