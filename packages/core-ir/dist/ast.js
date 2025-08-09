"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.call = exports.fnExpr = exports.letBind = exports.variable = exports.litBool = exports.litText = exports.litNum = void 0;
exports.sid = sid;
exports.program = program;
exports.assignStableSids = assignStableSids;
function sid(prefix = 'sid') {
    // simple stable-ish SID generator stub (replace with crypto/random + stable mapping)
    return `${prefix}:${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
}
function program(decls) {
    return { kind: 'Program', sid: sid('prog'), decls };
}
// Constructors (ergonomic helpers)
const litNum = (n) => ({ kind: 'LitNum', sid: sid('lit'), value: n });
exports.litNum = litNum;
const litText = (t) => ({ kind: 'LitText', sid: sid('lit'), value: t });
exports.litText = litText;
const litBool = (b) => ({ kind: 'LitBool', sid: sid('lit'), value: b });
exports.litBool = litBool;
const variable = (name) => ({ kind: 'Var', sid: sid('var'), name });
exports.variable = variable;
const letBind = (name, expr) => ({ kind: 'Let', sid: sid('let'), name, expr });
exports.letBind = letBind;
const fnExpr = (name, params, body, effects = new Set()) => ({ kind: 'Fn', sid: sid('fn'), name, params, body, effects });
exports.fnExpr = fnExpr;
const call = (callee, args) => ({ kind: 'Call', sid: sid('call'), callee, args });
exports.call = call;
// Stable SID assignment
function hashString(input) {
    let h = 5381;
    for (let i = 0; i < input.length; i++)
        h = ((h << 5) + h) ^ input.charCodeAt(i);
    return (h >>> 0).toString(36);
}
function nodeSignature(e) {
    switch (e.kind) {
        case 'LitNum': return `LitNum:${e.value}`;
        case 'LitFloat': return `LitFloat:${e.value}`;
        case 'LitText': return `LitText:${e.value}`;
        case 'LitBool': return `LitBool:${e.value}`;
        case 'Var': return `Var:${e.name}`;
        case 'Let': return `Let:${e.name}:${e.expr.sid ?? '?'}`;
        case 'Fn': {
            const eff = Array.from(e.effects.values()).sort().join('|');
            const paramsSig = e.params.map(p => `${p.name}:${p.type ?? ''}`).join('|');
            return `Fn:${e.name ?? ''}(${paramsSig}):${e.body.sid ?? '?'}:${eff}`;
        }
        case 'Call': return `Call:${e.callee.sid ?? '?'}(${e.args.map(a => a.sid ?? '?').join(',')})`;
        case 'Unary': return `Unary:${e.op}:${e.expr.sid ?? '?'}`;
        case 'Binary': return `Binary:${e.op}:${e.left.sid ?? '?'}:${e.right.sid ?? '?'}`;
        case 'If': return `If:${e.cond.sid ?? '?'}:${e.then.sid ?? '?'}:${e.else.sid ?? '?'}`;
        case 'EffectCall': return `EffectCall:${e.effect}:${e.op}(${e.args.map(a => a.sid ?? '?').join(',')})`;
        case 'RecordLit': return `RecordLit:{${e.fields.map(f => `${f.name}:${f.expr.sid ?? '?'}`).join(',')}}`;
        case 'TupleLit': return `TupleLit:(${e.elements.map(a => a.sid ?? '?').join(',')})`;
        case 'PatternOr': return `PatternOr:${e.left.sid ?? '?'}|${e.right.sid ?? '?'}`;
        case 'Match': return `Match:${e.scrutinee.sid ?? '?'}:${e.cases.length}`;
        case 'SchemaDecl': return `SchemaDecl:${e.name}:${Object.entries(e.fields).map(([k, v]) => `${k}:${v}`).join(',')}`;
        case 'StoreDecl': return `StoreDecl:${e.name}:${e.schema}:${e.config ?? ''}`;
        case 'QueryDecl': return `QueryDecl:${e.name}:${e.source}:${e.predicate?.sid ?? ''}:${(e.projection || []).join(',')}`;
        case 'ImportDecl': return `ImportDecl:${e.path}:${e.alias ?? ''}`;
        case 'ModuleDecl': return `ModuleDecl:${e.name}`;
        case 'EnumDecl': return `EnumDecl:${e.name}:${e.variants.map(v => `${v.name}(${v.params.join(',')})`).join('|')}`;
        case 'Ctor': return `Ctor:${e.name}(${e.args.map(a => a.sid ?? '?').join(',')})`;
        case 'Block': return `Block:${e.stmts.map(s => s.sid ?? '?').join(',')}`;
        case 'Assign': return `Assign:${e.name}:${e.expr.sid ?? '?'}`;
        case 'ActorDecl': return `ActorDecl:${e.name}:${e.param?.name ?? ''}:${e.body.sid ?? '?'}`;
        case 'ActorDeclNew': return `ActorDeclNew:${e.name}:${e.state.map(s => s.name).join('|')}:${e.handlers.length}`;
        case 'Spawn': return `Spawn:${e.actorName}`;
        case 'Send': return `Send:${e.actor.sid ?? '?'}:${e.message.sid ?? '?'}`;
        case 'Ask': return `Ask:${e.actor.sid ?? '?'}:${e.message.sid ?? '?'}:${e.timeoutMs ?? ''}`;
        case 'SpecDecl': return `SpecDecl:${e.name}:${e.asserts.length}`;
        case 'Program': return `Program:${e.decls.map(d => d.sid ?? '?').join(',')}`;
        default: return 'Unknown';
    }
}
function assignStableSids(e) {
    // Post-order traversal to ensure child sids exist first
    switch (e.kind) {
        case 'Program':
            for (const d of e.decls)
                assignStableSids(d);
            break;
        case 'Let':
            assignStableSids(e.expr);
            break;
        case 'Assign':
            assignStableSids(e.expr);
            break;
        case 'Fn':
            assignStableSids(e.body);
            break;
        case 'Call':
            assignStableSids(e.callee);
            for (const a of e.args)
                assignStableSids(a);
            break;
        case 'Unary':
            assignStableSids(e.expr);
            break;
        case 'Binary':
            assignStableSids(e.left);
            assignStableSids(e.right);
            break;
        case 'If':
            assignStableSids(e.cond);
            assignStableSids(e.then);
            assignStableSids(e.else);
            break;
        case 'Block':
            for (const s of e.stmts)
                assignStableSids(s);
            break;
        case 'EffectCall':
            for (const a of e.args)
                assignStableSids(a);
            break;
        case 'RecordLit':
            for (const f of e.fields)
                assignStableSids(f.expr);
            break;
        case 'TupleLit':
            for (const a of e.elements)
                assignStableSids(a);
            break;
        case 'PatternOr':
            assignStableSids(e.left);
            assignStableSids(e.right);
            break;
        case 'Match':
            assignStableSids(e.scrutinee);
            for (const c of e.cases) {
                if (c.pattern)
                    assignStableSids(c.pattern);
                if (c.guard)
                    assignStableSids(c.guard);
                if (c.body)
                    assignStableSids(c.body);
            }
            break;
        case 'SchemaDecl': break;
        case 'StoreDecl': break;
        case 'QueryDecl':
            if (e.predicate)
                assignStableSids(e.predicate);
            break;
        case 'Ctor':
            for (const a of e.args)
                assignStableSids(a);
            break;
        case 'ActorDecl':
            assignStableSids(e.body);
            break;
        case 'ActorDeclNew':
            for (const s of e.state)
                assignStableSids(s.init);
            for (const h of e.handlers) {
                if (h.pattern)
                    assignStableSids(h.pattern);
                if (h.guard)
                    assignStableSids(h.guard);
                if (h.body)
                    assignStableSids(h.body);
            }
            break;
        case 'Send':
            assignStableSids(e.actor);
            assignStableSids(e.message);
            break;
        case 'Ask':
            assignStableSids(e.actor);
            assignStableSids(e.message);
            break;
        case 'SpecDecl':
            for (const a of e.asserts)
                assignStableSids(a.expr);
            break;
        default: break;
    }
    const sig = nodeSignature(e);
    const h = hashString(sig);
    e.sid = `${e.kind.toLowerCase()}:${h}`;
}
