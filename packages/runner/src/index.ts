import { Expr } from '@lumen/core-ir'
import { isSqliteConfig, loadSqlite } from './adapters/sqlite'
import { httpGet, httpPost } from './adapters/http'

export interface RunResult {
  value: unknown
  trace: Array<{ sid: string, note: string }>
}

export function run(ast: Expr, options?: { deniedEffects?: Set<string>, mockEffects?: boolean }): RunResult {
  const trace: RunResult['trace'] = []
  const env = new Map<string, unknown>()
  let currentModule: string | null = null
  // simple actor mailbox map
  const mailboxes = new Map<string, Array<unknown>>()
  const actors = new Map<string, { paramName?: string, body?: Expr, effects: Set<string>, state?: Map<string, unknown>, handlers?: Array<{ test: (msg: unknown)=>boolean, reply?: (msg: unknown)=>unknown, run: ()=>unknown, guard?: Expr }> }>()
  const effectStack: Array<Set<string> | null> = []
  const stores = new Map<string, Array<any>>()

  function wrapMessage(m: unknown): { value: unknown, sink?: { done: boolean, value?: unknown } } {
    if (m && typeof m === 'object' && 'value' in (m as any)) return m as any
    return { value: m }
  }

  function processMailboxesUntil(predicate?: () => boolean): void {
    let progressed = true
    while (progressed) {
      if (predicate && predicate()) return
      progressed = false
      for (const [name, queue] of mailboxes) {
        if (!queue.length) continue
        const msgObj = wrapMessage(queue.shift() as any)
        const actor = actors.get(name)
        if (!actor) continue
        // Param-style actor
        if (actor.body && actor.paramName) {
          const prevEnv = new Map(env)
          env.set(actor.paramName, msgObj.value)
          effectStack.push(actor.effects)
          try { evalExpr(actor.body) } finally {
            effectStack.pop(); env.clear(); for (const [k,v] of prevEnv) env.set(k,v)
          }
          progressed = true
          continue
        }
        // Handler-style actor
        if (actor.handlers && actor.state) {
          const handler = actor.handlers.find(h => h.test(msgObj.value))
          if (handler) {
            const prevEnv = new Map(env)
            // load state into env
            for (const [k,v] of actor.state) env.set(k, v)
            effectStack.push(actor.effects)
            try {
              // guard check (must be pure, we just evaluate expression)
              let guardOk = true
              const hAny: any = handler
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
              if (guardOk) result = handler.run()
              // write back state
              for (const [k] of actor.state) actor.state.set(k, env.get(k))
              if (msgObj.sink && handler.reply) { msgObj.sink.done = true; msgObj.sink.value = result }
            } finally {
              effectStack.pop(); env.clear(); for (const [k,v] of prevEnv) env.set(k,v)
            }
            progressed = true
          }
        }
      }
    }
  }

  function truthy(b: unknown): boolean { return Boolean(b) }

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
            env.set(key, fnv)
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
                try { ok = Boolean(evalExpr(d.predicate as any)) } finally { env.clear(); for (const [k,v] of prev) env.set(k,v) }
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
              test: (msg: unknown) => {
                // pattern matching with wildcard, literal equality, ctor equality, or pattern OR
                const pat = h.pattern as any
                const resolve = (val: any): any => val && typeof val === 'object' && val.kind ? evalExpr(val) : val
                const matchOne = (patv: any, v: any): boolean => {
                  if (typeof patv === 'string' && (patv === '_' || patv === '*')) return true
                  if (pat && pat.kind === 'PatternOr') return matchOne(resolve(pat.left), v) || matchOne(resolve(pat.right), v)
                  const isCtor = (x: any) => x && typeof x === 'object' && '$' in x && Array.isArray(x.values)
                  if (isCtor(patv) && isCtor(v)) return (patv as any).$ === (v as any).$ && JSON.stringify((patv as any).values) === JSON.stringify((v as any).values)
                  return JSON.stringify(patv) === JSON.stringify(v)
                }
                const patVal = resolve(pat)
                return matchOne(patVal, msg)
              },
              guard: h.guard ? (h.guard as any) : undefined,
              reply: h.replyType ? (msg: unknown) => evalExpr(h.body) : undefined,
              run: () => evalExpr(h.body)
            }))
            actors.set(key, { effects: d.effects as any, state, handlers })
            mailboxes.set(key, [])
            last = null
          } else if (d.kind === 'Spawn') {
            const key = d.actorName
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
            const eff = Array.from(fx).find(x => options.deniedEffects!.has(x))
            return `(denied effect ${eff})`
          }
          // Enforce actor-allowed effects if present
          const allowed = effectStack.length ? effectStack[effectStack.length - 1] : null
          if (fx && allowed) {
            for (const eff of fx) if (!allowed.has(eff)) return `(denied effect ${eff})`
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
        const key = e.actorName
        if (!mailboxes.has(key)) mailboxes.set(key, [])
        return key
      }
      case 'EffectCall': {
        // Enforce runtime deny for effect
        const eff = e.effect as string
        if (options?.deniedEffects && options.deniedEffects.has(eff)) return `(denied effect ${eff})`
        const allowed = effectStack.length ? effectStack[effectStack.length - 1] : null
        if (allowed && !allowed.has(eff)) return `(denied effect ${eff})`
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
          case '+': return (l as any) + (r as any)
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
      case 'RecordLit': {
        const obj: any = {}
        for (const f of e.fields as any[]) obj[f.name] = evalExpr(f.expr)
        return obj
      }
      case 'TupleLit': {
        return (e.elements as any[]).map(x => evalExpr(x))
      }
      case 'Match': {
        const value = evalExpr(e.scrutinee)
        const isCtor = (v: any) => v && typeof v === 'object' && '$' in v && Array.isArray(v.values)
        const equal = (a: any, b: any): boolean => JSON.stringify(a) === JSON.stringify(b)
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
        const matchPattern = (pat: any, val: any): boolean => {
          const pv = evalExpr(pat)
          if (typeof pv === 'string' && (pv === '_' || pv === '*')) return true
          if ((pat as any).kind === 'PatternOr') return matchPattern((pat as any).left, val) || matchPattern((pat as any).right, val)
          if (isCtor(pv) && isCtor(val)) return (pv as any).$ === (val as any).$ && equal((pv as any).values, (val as any).values)
          return equal(pv, val)
        }
        for (const c of e.cases as any[]) {
          const matched = matchPattern(c.pattern, value)
          if (matched) {
            if (c.guard) {
              if (hasEffectCall(c.guard)) continue
              const g = evalExpr(c.guard)
              if (!g) continue
            }
            return evalExpr(c.body)
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
  return { value, trace }
}
function intersects(a: Set<string>, b: Set<string>): boolean {
  for (const v of a) if (b.has(v)) return true
  return false
}