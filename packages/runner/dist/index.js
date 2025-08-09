"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.run = run;
const sqlite_1 = require("./adapters/sqlite");
const http_1 = require("./adapters/http");
const LOOP_BREAK = Symbol.for('lumen.break');
const LOOP_CONTINUE = Symbol.for('lumen.continue');
function hash32(s) {
    let h = 2166136261 >>> 0;
    for (let i = 0; i < s.length; i++) {
        h ^= s.charCodeAt(i);
        h = Math.imul(h, 16777619) >>> 0;
    }
    return h >>> 0;
}
function run(ast, options) {
    const trace = [];
    const env = new Map();
    let currentModule = null;
    // simple actor mailbox map
    const mailboxes = new Map();
    const actors = new Map();
    const effectStack = [];
    const stores = new Map();
    // Inject minimal stdlib builtins (deterministic, pure)
    env.set('stdlib.length', (s) => typeof s === 'string' ? s.length : (Array.isArray(s) ? s.length : 0));
    env.set('stdlib.uppercase', (s) => typeof s === 'string' ? s.toUpperCase() : s);
    env.set('stdlib.lowercase', (s) => typeof s === 'string' ? s.toLowerCase() : s);
    env.set('stdlib.startsWith', (s, prefix) => typeof s === 'string' && typeof prefix === 'string' ? s.startsWith(prefix) : false);
    env.set('stdlib.endsWith', (s, suffix) => typeof s === 'string' && typeof suffix === 'string' ? s.endsWith(suffix) : false);
    env.set('stdlib.contains', (s, sub) => typeof s === 'string' && typeof sub === 'string' ? s.includes(sub) : false);
    env.set('stdlib.map', (xs, f) => Array.isArray(xs) && typeof f === 'function' ? xs.map((x) => f(x)) : []);
    env.set('stdlib.filter', (xs, f) => Array.isArray(xs) && typeof f === 'function' ? xs.filter((x) => Boolean(f(x))) : []);
    env.set('stdlib.reduce', (xs, init, f) => Array.isArray(xs) && typeof f === 'function' ? xs.reduce((a, x) => f(a, x), init) : init);
    env.set('stdlib.hasSet', (xs, x) => Array.isArray(xs) ? xs.some(v => JSON.stringify(v) === JSON.stringify(x)) : false);
    env.set('stdlib.getMap', (xs, k, def) => {
        if (!Array.isArray(xs))
            return def;
        for (const pair of xs) {
            if (Array.isArray(pair) && pair.length >= 2 && JSON.stringify(pair[0]) === JSON.stringify(k))
                return pair[1];
        }
        return def;
    });
    env.set('stdlib.setMap', (xs, k, v) => {
        const out = [];
        let replaced = false;
        if (Array.isArray(xs)) {
            for (const pair of xs) {
                if (Array.isArray(pair) && pair.length >= 2 && JSON.stringify(pair[0]) === JSON.stringify(k)) {
                    out.push([k, v]);
                    replaced = true;
                }
                else
                    out.push(pair);
            }
        }
        if (!replaced)
            out.push([k, v]);
        return out;
    });
    env.set('stdlib.any', (xs, f) => Array.isArray(xs) && typeof f === 'function' ? xs.some((x) => Boolean(f(x))) : false);
    env.set('stdlib.all', (xs, f) => Array.isArray(xs) && typeof f === 'function' ? xs.every((x) => Boolean(f(x))) : false);
    env.set('stdlib.unique', (xs) => Array.isArray(xs) ? xs.filter((v, i, a) => a.findIndex(z => JSON.stringify(z) === JSON.stringify(v)) === i) : []);
    env.set('stdlib.union', (a, b) => {
        const aa = Array.isArray(a) ? a : [];
        const bb = Array.isArray(b) ? b : [];
        const combined = aa.concat(bb);
        return combined.filter((v, i, arr) => arr.findIndex(z => JSON.stringify(z) === JSON.stringify(v)) === i);
    });
    env.set('stdlib.intersect', (a, b) => {
        const aa = Array.isArray(a) ? a : [];
        const bb = Array.isArray(b) ? b : [];
        return aa.filter(x => bb.findIndex(z => JSON.stringify(z) === JSON.stringify(x)) >= 0).filter((v, i, arr) => arr.findIndex(z => JSON.stringify(z) === JSON.stringify(v)) === i);
    });
    env.set('stdlib.keys', (xs) => Array.isArray(xs) ? xs.map(p => Array.isArray(p) ? p[0] : null).filter(x => x !== null) : []);
    env.set('stdlib.values', (xs) => Array.isArray(xs) ? xs.map(p => Array.isArray(p) ? p[1] : null).filter(x => x !== null) : []);
    env.set('stdlib.lengthList', (xs) => Array.isArray(xs) ? xs.length : 0);
    env.set('stdlib.head', (xs) => Array.isArray(xs) && xs.length > 0 ? xs[0] : null);
    env.set('stdlib.tail', (xs) => Array.isArray(xs) && xs.length > 0 ? xs.slice(1) : []);
    env.set('stdlib.trim', (s) => typeof s === 'string' ? s.trim() : s);
    env.set('stdlib.split', (s, sep) => typeof s === 'string' && typeof sep === 'string' ? s.split(sep) : []);
    env.set('stdlib.join', (xs, sep) => Array.isArray(xs) && typeof sep === 'string' ? xs.join(sep) : '');
    env.set('stdlib.replace', (s, a, b) => typeof s === 'string' && typeof a === 'string' && typeof b === 'string' ? s.split(a).join(b) : s);
    env.set('stdlib.padLeft', (s, n, ch) => {
        const str = typeof s === 'string' ? s : String(s);
        const width = typeof n === 'number' ? n : Number(n);
        const fill = typeof ch === 'string' && ch.length > 0 ? ch[0] : ' ';
        if (!isFinite(width) || width <= str.length)
            return str;
        return fill.repeat(width - str.length) + str;
    });
    env.set('stdlib.padRight', (s, n, ch) => {
        const str = typeof s === 'string' ? s : String(s);
        const width = typeof n === 'number' ? n : Number(n);
        const fill = typeof ch === 'string' && ch.length > 0 ? ch[0] : ' ';
        if (!isFinite(width) || width <= str.length)
            return str;
        return str + fill.repeat(width - str.length);
    });
    env.set('stdlib.concat', (xs, ys) => (Array.isArray(xs) ? xs : []).concat(Array.isArray(ys) ? ys : []));
    env.set('stdlib.flatten', (xss) => Array.isArray(xss) ? xss.reduce((a, x) => a.concat(Array.isArray(x) ? x : [x]), []) : []);
    function wrapMessage(m) {
        if (m && typeof m === 'object' && 'value' in m)
            return m;
        return { value: m };
    }
    function processMailboxesUntil(predicate) {
        let progressed = true;
        let tick = 0;
        const seed = options?.schedulerSeed ?? '';
        while (progressed) {
            if (predicate && predicate())
                return;
            progressed = false;
            // deterministically order actor names per tick using seed
            const entries = Array.from(mailboxes.entries());
            entries.sort((a, b) => {
                const ha = hash32(a[0] + ':' + tick + ':' + seed);
                const hb = hash32(b[0] + ':' + tick + ':' + seed);
                return ha - hb;
            });
            for (const [name, queue] of entries) {
                if (!queue.length)
                    continue;
                const msgObj = wrapMessage(queue.shift());
                const actor = actors.get(name);
                if (!actor)
                    continue;
                // Param-style actor
                if (actor.body && actor.paramName) {
                    const prevEnv = new Map(env);
                    env.set(actor.paramName, msgObj.value);
                    effectStack.push(actor.effects);
                    try {
                        evalExpr(actor.body);
                    }
                    finally {
                        effectStack.pop();
                        env.clear();
                        for (const [k, v] of prevEnv)
                            env.set(k, v);
                    }
                    progressed = true;
                    continue;
                }
                // Handler-style actor
                if (actor.handlers && actor.state) {
                    let chosen = null;
                    for (const h of actor.handlers) {
                        const res = h.match(msgObj.value);
                        if (res.ok) {
                            chosen = { h, binds: res.binds };
                            break;
                        }
                    }
                    if (chosen) {
                        const prevEnv = new Map(env);
                        // load state into env and binds
                        for (const [k, v] of actor.state)
                            env.set(k, v);
                        for (const [k, v] of chosen.binds)
                            env.set(k, v);
                        effectStack.push(actor.effects);
                        try {
                            // guard check (must be pure, we just evaluate expression)
                            let guardOk = true;
                            const hAny = chosen.h;
                            if (hAny.guard) {
                                const hasEffectCall = (expr) => {
                                    if (!expr || typeof expr !== 'object')
                                        return false;
                                    if (expr.kind === 'EffectCall')
                                        return true;
                                    for (const k of Object.keys(expr)) {
                                        const v = expr[k];
                                        if (v && typeof v === 'object' && 'kind' in v) {
                                            if (hasEffectCall(v))
                                                return true;
                                        }
                                        if (Array.isArray(v)) {
                                            for (const it of v)
                                                if (it && typeof it === 'object' && 'kind' in it) {
                                                    if (hasEffectCall(it))
                                                        return true;
                                                }
                                        }
                                    }
                                    return false;
                                };
                                if (hasEffectCall(hAny.guard))
                                    guardOk = false;
                                else
                                    guardOk = Boolean(evalExpr(hAny.guard));
                            }
                            let result = null;
                            if (guardOk)
                                result = chosen.h.run(chosen.binds);
                            // write back state
                            for (const [k] of actor.state)
                                actor.state.set(k, env.get(k));
                            if (msgObj.sink && chosen.h.reply) {
                                msgObj.sink.done = true;
                                msgObj.sink.value = chosen.h.reply(msgObj.value, chosen.binds);
                            }
                        }
                        finally {
                            effectStack.pop();
                            env.clear();
                            for (const [k, v] of prevEnv)
                                env.set(k, v);
                        }
                        progressed = true;
                    }
                }
            }
            tick++;
        }
    }
    function truthy(b) { return Boolean(b); }
    function matchPattern(pat, val) {
        const binds = new Map();
        const isCtor = (v) => v && typeof v === 'object' && '$' in v && Array.isArray(v.values);
        const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
        function merge(a, b) {
            const out = new Map(a);
            for (const [k, v] of b) {
                if (out.has(k) && out.get(k) !== v)
                    return null;
                out.set(k, v);
            }
            return out;
        }
        function go(p, v) {
            switch (p.kind) {
                case 'Var': {
                    const name = p.name;
                    if (name === '_' || name === '*')
                        return { ok: true, binds: new Map() };
                    const m = new Map();
                    m.set(name, v);
                    return { ok: true, binds: m };
                }
                case 'LitNum':
                case 'LitFloat':
                case 'LitText':
                case 'LitBool':
                    return { ok: equal(evalExpr(p), v), binds: new Map() };
                case 'Ctor': {
                    if (!isCtor(v))
                        return { ok: false, binds: new Map() };
                    const vv = v;
                    if (vv.$ !== p.name)
                        return { ok: false, binds: new Map() };
                    if (p.args.length !== vv.values.length)
                        return { ok: false, binds: new Map() };
                    let acc = new Map();
                    for (let i = 0; i < p.args.length; i++) {
                        const r = go(p.args[i], vv.values[i]);
                        if (!r.ok)
                            return { ok: false, binds: new Map() };
                        const merged = merge(acc, r.binds);
                        if (!merged)
                            return { ok: false, binds: new Map() };
                        acc = merged;
                    }
                    return { ok: true, binds: acc };
                }
                case 'RecordLit': {
                    if (!v || typeof v !== 'object')
                        return { ok: false, binds: new Map() };
                    let acc = new Map();
                    for (const f of p.fields) {
                        const r = go(f.expr, v[f.name]);
                        if (!r.ok)
                            return { ok: false, binds: new Map() };
                        const merged = merge(acc, r.binds);
                        if (!merged)
                            return { ok: false, binds: new Map() };
                        acc = merged;
                    }
                    return { ok: true, binds: acc };
                }
                case 'TupleLit': {
                    if (!Array.isArray(v))
                        return { ok: false, binds: new Map() };
                    if (p.elements.length !== v.length)
                        return { ok: false, binds: new Map() };
                    let acc = new Map();
                    for (let i = 0; i < p.elements.length; i++) {
                        const r = go(p.elements[i], v[i]);
                        if (!r.ok)
                            return { ok: false, binds: new Map() };
                        const merged = merge(acc, r.binds);
                        if (!merged)
                            return { ok: false, binds: new Map() };
                        acc = merged;
                    }
                    return { ok: true, binds: acc };
                }
                case 'PatternOr': {
                    const left = go(p.left, v);
                    if (left.ok)
                        return left;
                    return go(p.right, v);
                }
                default:
                    return { ok: equal(evalExpr(p), v), binds: new Map() };
            }
        }
        const res = go(pat, val);
        return res;
    }
    function evalExpr(e) {
        trace.push({ sid: e.sid ?? 'unknown', note: e.kind });
        switch (e.kind) {
            case 'Program': {
                let last = null;
                for (const d of e.decls) {
                    // Top-level function declarations bind their name
                    if (d.kind === 'Fn' && d.name) {
                        const fnv = evalExpr(d);
                        const key = currentModule ? `${currentModule}.${d.name}` : d.name;
                        if (!env.has(key))
                            env.set(key, fnv);
                        last = fnv;
                    }
                    else if (d.kind === 'ModuleDecl') {
                        currentModule = d.name;
                        last = null;
                    }
                    else if (d.kind === 'EnumDecl') {
                        // no runtime binding needed for enum decls in MVP
                        last = null;
                    }
                    else if (d.kind === 'SchemaDecl' || d.kind === 'StoreDecl' || d.kind === 'QueryDecl') {
                        // schema is compile-time only (no op)
                        if (d.kind === 'StoreDecl') {
                            // If config is provided, attempt to load JSON array
                            if (d.config) {
                                const data = evalExpr({ kind: 'EffectCall', sid: 'eff:dbload', effect: 'db', op: 'load', args: [{ kind: 'LitText', sid: 'lit', value: d.config }] });
                                if (Array.isArray(data))
                                    stores.set(d.name, data);
                                else
                                    stores.set(d.name, []);
                            }
                            else
                                stores.set(d.name, []);
                        }
                        if (d.kind === 'QueryDecl') {
                            const key = currentModule ? `${currentModule}.${d.name}` : d.name;
                            // if store name exists and was loaded from sqlite, we can eval where/projection via adapter against store config
                            const storeDecl = ast.decls?.find((x) => x.kind === 'StoreDecl' && x.name === d.source);
                            const whereFn = d.predicate ? (row) => {
                                const prev = new Map(env);
                                env.clear();
                                for (const [k, v] of Object.entries(row))
                                    env.set(k, v);
                                let ok = true;
                                try {
                                    ok = Boolean(evalExpr(d.predicate));
                                }
                                finally {
                                    env.clear();
                                    for (const [k, v] of prev)
                                        env.set(k, v);
                                }
                                return ok;
                            } : undefined;
                            if (storeDecl && (0, sqlite_1.isSqliteConfig)(storeDecl.config)) {
                                const arr = (0, sqlite_1.loadSqlite)(storeDecl.config, whereFn, d.projection);
                                env.set(key, arr);
                            }
                            else {
                                const rows = stores.get(d.source) || [];
                                const results = [];
                                for (const row of rows) {
                                    let pass = true;
                                    if (whereFn)
                                        pass = whereFn(row);
                                    if (!pass)
                                        continue;
                                    if (d.projection && d.projection.length > 0) {
                                        const proj = {};
                                        for (const f of d.projection)
                                            proj[f] = row[f];
                                        results.push(proj);
                                    }
                                    else
                                        results.push(row);
                                }
                                env.set(key, results);
                            }
                        }
                        last = null;
                    }
                    else if (d.kind === 'ActorDecl') {
                        const key = currentModule ? `${currentModule}.${d.name}` : d.name;
                        actors.set(key, { paramName: d.param?.name, body: d.body, effects: d.effects });
                        mailboxes.set(key, []);
                        last = null;
                    }
                    else if (d.kind === 'ActorDeclNew') {
                        const key = currentModule ? `${currentModule}.${d.name}` : d.name;
                        const state = new Map();
                        for (const s of d.state)
                            state.set(s.name, evalExpr(s.init));
                        const handlers = d.handlers.map(h => ({
                            match: (msg) => matchPattern(h.pattern, msg),
                            guard: h.guard ? h.guard : undefined,
                            reply: h.replyType ? (_msg, binds) => {
                                const prev = new Map(env);
                                for (const [k, v] of binds)
                                    env.set(k, v);
                                try {
                                    return evalExpr(h.body);
                                }
                                finally {
                                    env.clear();
                                    for (const [k, v] of prev)
                                        env.set(k, v);
                                }
                            } : undefined,
                            run: (binds) => {
                                const prev = new Map(env);
                                for (const [k, v] of binds)
                                    env.set(k, v);
                                try {
                                    return evalExpr(h.body);
                                }
                                finally {
                                    env.clear();
                                    for (const [k, v] of prev)
                                        env.set(k, v);
                                }
                            }
                        }));
                        actors.set(key, { effects: d.effects, state, handlers });
                        mailboxes.set(key, []);
                        last = null;
                    }
                    else if (d.kind === 'Spawn') {
                        const key = d.actorName;
                        if (!mailboxes.has(key))
                            mailboxes.set(key, []);
                        last = key;
                    }
                    else if (d.kind === 'Send') {
                        const target = evalExpr(d.actor);
                        const mb = mailboxes.get(String(target));
                        if (mb)
                            mb.push(evalExpr(d.message));
                        last = null;
                    }
                    else {
                        last = evalExpr(d);
                    }
                }
                // Deterministic actor message processing: drain mailboxes
                processMailboxesUntil();
                return last;
            }
            case 'Let': {
                const v = evalExpr(e.expr);
                env.set(e.name, v);
                return v;
            }
            case 'Assign': {
                const v = evalExpr(e.expr);
                env.set(e.name, v);
                return v;
            }
            case 'LitText': return e.value;
            case 'LitFloat': return e.value;
            case 'LitNum': return e.value;
            case 'LitBool': return e.value;
            case 'Var': {
                // support qualified var lookup: foo.bar -> treat as flat key
                const key = e.name;
                if (!env.has(key))
                    return `(unbound ${e.name})`;
                return env.get(key);
            }
            case 'Fn': {
                // closure over current env snapshot
                const closureEnv = new Map(env);
                const fnWrapper = function (...args) {
                    const local = new Map(closureEnv);
                    e.params.forEach((p, i) => local.set(p.name, args[i]));
                    // Replace env temporarily
                    const prev = new Map(env);
                    env.clear();
                    for (const [k, v] of local)
                        env.set(k, v);
                    try {
                        return evalExpr(e.body);
                    }
                    finally {
                        env.clear();
                        for (const [k, v] of prev)
                            env.set(k, v);
                    }
                };
                fnWrapper.lumenEffects = e.effects;
                fnWrapper.lumenName = e.name ?? '<anon>';
                return fnWrapper;
            }
            case 'Call': {
                const callee = evalExpr(e.callee);
                const args = e.args.map(evalExpr);
                if (typeof callee === 'function') {
                    const fx = callee.lumenEffects;
                    if (fx && options?.deniedEffects && intersects(fx, options.deniedEffects)) {
                        const eff = Array.from(fx).find(x => options.deniedEffects.has(x));
                        return `(denied effect ${eff})`;
                    }
                    // Enforce actor-allowed effects if present
                    const allowed = effectStack.length ? effectStack[effectStack.length - 1] : null;
                    if (fx && allowed) {
                        for (const eff of fx)
                            if (!allowed.has(eff))
                                return `(denied effect ${eff})`;
                    }
                    return callee(...args);
                }
                return `(not-callable ${String(callee)})`;
            }
            case 'Ctor': {
                const values = e.args.map(evalExpr);
                return { $: e.name, values };
            }
            case 'Spawn': {
                const key = e.actorName;
                if (!mailboxes.has(key))
                    mailboxes.set(key, []);
                return key;
            }
            case 'EffectCall': {
                // Enforce runtime deny for effect
                const eff = e.effect;
                if (options?.deniedEffects && options.deniedEffects.has(eff))
                    return `(denied effect ${eff})`;
                const allowed = effectStack.length ? effectStack[effectStack.length - 1] : null;
                if (allowed && !allowed.has(eff))
                    return `(denied effect ${eff})`;
                // Minimal effect hooks
                if (e.effect === 'io' && e.op === 'print') {
                    // eslint-disable-next-line no-console
                    console.log(...e.args.map(evalExpr));
                    return null;
                }
                if (e.effect === 'net') {
                    const args = e.args.map(evalExpr);
                    if (e.op === 'get') {
                        if (options?.mockEffects)
                            return `MOCK:GET ${String(args[0])}`;
                        return `(net.get ${String(args[0])})`;
                    }
                }
                if (e.effect === 'time') {
                    if (e.op === 'now')
                        return options?.mockEffects ? 0 : `(time.now)`;
                    if (e.op === 'sleep')
                        return null;
                }
                if (e.effect === 'db') {
                    const args = e.args.map(evalExpr);
                    if (e.op === 'load') {
                        try {
                            const p = String(args[0]);
                            if ((0, sqlite_1.isSqliteConfig)(p))
                                return (0, sqlite_1.loadSqlite)(p);
                            const raw = require('fs').readFileSync(p, 'utf8');
                            return JSON.parse(raw);
                        }
                        catch {
                            return `(db.load error)`;
                        }
                    }
                }
                if (e.effect === 'http') {
                    const args = e.args.map(evalExpr);
                    if (e.op === 'get')
                        return (0, http_1.httpGet)(String(args[0]));
                    if (e.op === 'post')
                        return (0, http_1.httpPost)(String(args[0]), String(args[1] ?? ''));
                }
                if (e.effect === 'fs') {
                    const args = e.args.map(evalExpr);
                    if (e.op === 'read') {
                        try {
                            const p = String(args[0]);
                            return require('fs').readFileSync(p, 'utf8');
                        }
                        catch {
                            return `(fs.read error)`;
                        }
                    }
                    if (e.op === 'write') {
                        try {
                            const p = String(args[0]);
                            const data = String(args[1]);
                            require('fs').writeFileSync(p, data, 'utf8');
                            return null;
                        }
                        catch {
                            return `(fs.write error)`;
                        }
                    }
                }
                return `(effect ${e.effect}.${e.op})`;
            }
            case 'Ask': {
                const actorRef = evalExpr(e.actor);
                const message = evalExpr(e.message);
                const sink = { done: false };
                const mb = mailboxes.get(String(actorRef)) || [];
                mailboxes.set(String(actorRef), mb);
                mb.push({ value: message, sink });
                if (e.timeoutMs && e.timeoutMs > 0) {
                    const start = Date.now();
                    processMailboxesUntil(() => sink.done || (Date.now() - start) >= e.timeoutMs);
                    return sink.done ? (sink.value ?? null) : `(timeout ${e.timeoutMs})`;
                }
                else {
                    processMailboxesUntil(() => sink.done);
                    return sink.value ?? null;
                }
            }
            case 'Unary': {
                const v = evalExpr(e.expr);
                if (e.op === 'not')
                    return !truthy(v);
                if (e.op === 'neg')
                    return -v;
                return null;
            }
            case 'Binary': {
                const l = evalExpr(e.left);
                const r = evalExpr(e.right);
                switch (e.op) {
                    case '+': {
                        if (Array.isArray(l) && Array.isArray(r))
                            return l.concat(r);
                        return l + r;
                    }
                    case '-': return l - r;
                    case '*': return l * r;
                    case '/': return l / r;
                    case '%': return l % r;
                    case '==': return JSON.stringify(l) === JSON.stringify(r);
                    case '!=': return JSON.stringify(l) !== JSON.stringify(r);
                    case '<': return l < r;
                    case '<=': return l <= r;
                    case '>': return l > r;
                    case '>=': return l >= r;
                    case 'and': return truthy(l) && truthy(r);
                    case 'or': return truthy(l) || truthy(r);
                }
                return null;
            }
            case 'If': {
                const c = evalExpr(e.cond);
                return truthy(c) ? evalExpr(e.then) : evalExpr(e.else);
            }
            case 'While': {
                while (truthy(evalExpr(e.cond))) {
                    try {
                        evalExpr(e.body);
                    }
                    catch (x) {
                        if (x === LOOP_BREAK)
                            break;
                        else if (x === LOOP_CONTINUE)
                            continue;
                        else
                            throw x;
                    }
                }
                return null;
            }
            case 'For': {
                const it = evalExpr(e.iter);
                const arr = Array.isArray(it) ? it : [];
                for (const v of arr) {
                    env.set(e.name, v);
                    try {
                        evalExpr(e.body);
                    }
                    catch (x) {
                        if (x === LOOP_BREAK)
                            break;
                        else if (x === LOOP_CONTINUE)
                            continue;
                        else
                            throw x;
                    }
                }
                return null;
            }
            case 'Break': throw LOOP_BREAK;
            case 'Continue': throw LOOP_CONTINUE;
            case 'RecordLit': {
                const obj = {};
                for (const f of e.fields)
                    obj[f.name] = evalExpr(f.expr);
                return obj;
            }
            case 'TupleLit': {
                return e.elements.map(x => evalExpr(x));
            }
            case 'SetLit': {
                return e.elements.map(x => evalExpr(x));
            }
            case 'MapLit': {
                const out = [];
                for (const en of e.entries)
                    out.push([evalExpr(en.key), evalExpr(en.value)]);
                return out;
            }
            case 'Match': {
                const value = evalExpr(e.scrutinee);
                const hasEffectCall = (expr) => {
                    if (!expr || typeof expr !== 'object')
                        return false;
                    if (expr.kind === 'EffectCall')
                        return true;
                    for (const k of Object.keys(expr)) {
                        const v = expr[k];
                        if (v && typeof v === 'object' && 'kind' in v) {
                            if (hasEffectCall(v))
                                return true;
                        }
                        if (Array.isArray(v)) {
                            for (const it of v)
                                if (it && typeof it === 'object' && 'kind' in it) {
                                    if (hasEffectCall(it))
                                        return true;
                                }
                        }
                    }
                    return false;
                };
                for (const c of e.cases) {
                    const res = matchPattern(c.pattern, value);
                    if (res.ok) {
                        if (c.guard) {
                            const prev = new Map(env);
                            for (const [k, v] of res.binds)
                                env.set(k, v);
                            try {
                                if (hasEffectCall(c.guard)) {
                                    for (const [k] of res.binds)
                                        env.delete(k);
                                    continue;
                                }
                                const g = evalExpr(c.guard);
                                if (!g) {
                                    for (const [k] of res.binds)
                                        env.delete(k);
                                    continue;
                                }
                            }
                            finally {
                                env.clear();
                                for (const [k, v] of prev)
                                    env.set(k, v);
                            }
                        }
                        const prev = new Map(env);
                        for (const [k, v] of res.binds)
                            env.set(k, v);
                        try {
                            return evalExpr(c.body);
                        }
                        finally {
                            env.clear();
                            for (const [k, v] of prev)
                                env.set(k, v);
                        }
                    }
                }
                return null;
            }
            case 'Block': {
                let last = null;
                for (const s of e.stmts)
                    last = evalExpr(s);
                return last;
            }
            default: return null;
        }
    }
    const value = evalExpr(ast);
    return { value, trace };
}
function intersects(a, b) {
    for (const v of a)
        if (b.has(v))
            return true;
    return false;
}
