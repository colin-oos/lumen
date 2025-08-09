"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.parse = parse;
const core_ir_1 = require("@lumen/core-ir");
// Very small hand-rolled parser upgraded to support:
// - comments: //, ///, /* */ (no nesting)
// - numbers: ints, floats, underscores
// - strings with escapes \" \n \t \\
// - if-then-else expressions
// - unary: not, unary -
// - binary ops with precedence: * / %  |  + -  |  comparisons  |  and or
// - match with optional 'case' keyword and guards
// - tuple [a,b], record { k: v }
// - let/mut, fn, actor, import (path or name with optional alias)
function stripComments(src) {
    // remove block comments
    let out = src.replace(/\/\*[\s\S]*?\*\//g, '');
    // remove doc comments /// and line comments //
    out = out.split('\n').map(line => {
        if (line.trim().startsWith('///'))
            return '';
        const idx = line.indexOf('//');
        if (idx >= 0)
            return line.slice(0, idx);
        return line;
    }).join('\n');
    return out;
}
// Parse a pattern string into an Expr, supporting top-level OR `|` combinations
function parsePattern(src) {
    let depth = 0;
    const parts = [];
    let buf = '';
    for (let i = 0; i < src.length; i++) {
        const ch = src[i];
        if (ch === '(' || ch === '[' || ch === '{')
            depth++;
        else if (ch === ')' || ch === ']' || ch === '}')
            depth--;
        else if (ch === '|' && depth === 0) {
            parts.push(buf.trim());
            buf = '';
            continue;
        }
        buf += ch;
    }
    if (buf.trim().length > 0)
        parts.push(buf.trim());
    if (parts.length === 1)
        return parseExprRD(parts[0]);
    let node = null;
    for (const p of parts) {
        const e = parseExprRD(p);
        if (!node)
            node = e;
        else
            node = { kind: 'PatternOr', sid: (0, core_ir_1.sid)('por'), left: node, right: e };
    }
    return node;
}
class Lexer {
    constructor(s) {
        this.s = s;
        this.i = 0;
    }
    peek() { return this.s[this.i] ?? ''; }
    next() { return this.s[this.i++] ?? ''; }
    eatWs() { while (/\s/.test(this.peek()))
        this.next(); }
    eof() { return this.i >= this.s.length; }
    eatKeyword(word) {
        this.eatWs();
        if (this.s.slice(this.i, this.i + word.length) === word) {
            const after = this.s[this.i + word.length] || ' ';
            if (!/[A-Za-z0-9_]/.test(after)) {
                this.i += word.length;
                return true;
            }
        }
        return false;
    }
}
function parseExprRD(src) {
    const assignMatch = src.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.+)$/);
    if (assignMatch) {
        return { kind: 'Assign', sid: (0, core_ir_1.sid)('assign'), name: assignMatch[1], expr: parseExprRD(assignMatch[2]) };
    }
    const askMatch = src.match(/^ask\s+([^\s]+)\s+([\s\S]+)$/);
    if (askMatch) {
        return { kind: 'Ask', sid: (0, core_ir_1.sid)('ask'), actor: parseExprRD(askMatch[1]), message: parseExprRD(askMatch[2]) };
    }
    const sendMatch = src.match(/^send\s+([^,\s]+)\s*(?:,\s*|\s+)([\s\S]+)$/);
    if (sendMatch) {
        return { kind: 'Send', sid: (0, core_ir_1.sid)('send'), actor: parseExprRD(sendMatch[1]), message: parseExprRD(sendMatch[2]) };
    }
    const spawnMatch = src.match(/^spawn\s+([^\s]+)$/);
    if (spawnMatch) {
        return { kind: 'Spawn', sid: (0, core_ir_1.sid)('spawn'), actorName: spawnMatch[1] };
    }
    const lx = new Lexer(src);
    lx.eatWs();
    const builtinEffects = new Set(['io', 'fs', 'net', 'db', 'time', 'nondet', 'gpu', 'unchecked', 'http']);
    function parseString() {
        // assumes current peek is '"'
        lx.next(); // consume opening
        let v = '';
        while (!lx.eof()) {
            const ch = lx.next();
            if (ch === '"')
                break;
            if (ch === '\\') {
                const n = lx.next();
                if (n === 'n')
                    v += '\n';
                else if (n === 't')
                    v += '\t';
                else if (n === '"')
                    v += '"';
                else if (n === '\\')
                    v += '\\';
                else
                    v += n;
            }
            else
                v += ch;
        }
        return { kind: 'LitText', sid: (0, core_ir_1.sid)('lit'), value: v };
    }
    function parseNumber() {
        let raw = '';
        let sawDot = false;
        while (/[0-9_\.]/.test(lx.peek())) {
            const ch = lx.next();
            if (ch === '.')
                sawDot = true;
            raw += ch;
        }
        const cleaned = raw.replace(/_/g, '');
        if (sawDot)
            return { kind: 'LitFloat', sid: (0, core_ir_1.sid)('lit'), value: Number(cleaned) };
        return { kind: 'LitNum', sid: (0, core_ir_1.sid)('lit'), value: Number(cleaned) };
    }
    function parsePrimary() {
        lx.eatWs();
        // if-expr: if cond then expr else expr
        if (lx.eatKeyword('if')) {
            const cond = parseOr();
            if (!lx.eatKeyword('then'))
                return { kind: 'LitText', sid: (0, core_ir_1.sid)('lit'), value: '(parse error: expected then)' };
            const thenE = parseOr();
            if (!lx.eatKeyword('else'))
                return { kind: 'LitText', sid: (0, core_ir_1.sid)('lit'), value: '(parse error: expected else)' };
            const elseE = parseOr();
            return { kind: 'If', sid: (0, core_ir_1.sid)('if'), cond, then: thenE, else: elseE };
        }
        // expression-level match: match <expr> { case pat [if g] -> expr; ... }
        if (lx.s.slice(lx['i'], lx['i'] + 5) === 'match' && /\b/.test(lx.s[lx['i'] + 5] || ' ')) {
            lx['i'] += 5;
            lx.eatWs();
            const scr = parseOr();
            lx.eatWs();
            if (lx.peek() === '{') {
                lx.next();
                const cases = [];
                while (!lx.eof() && lx.peek() !== '}') {
                    let depth = 0;
                    let buf = '';
                    while (!lx.eof()) {
                        const ch = lx.peek();
                        if (ch === '{')
                            depth++;
                        if (ch === '}') {
                            if (depth === 0)
                                break;
                            depth--;
                        }
                        if ((ch === ';' || ch === '\n') && depth === 0) {
                            lx.next();
                            break;
                        }
                        buf += lx.next();
                    }
                    const stmt = buf.trim();
                    if (stmt.length > 0) {
                        const trimmed = stmt.startsWith('case ') ? stmt.slice(5).trim() : stmt;
                        let cm = trimmed.match(/^(.+?)\s+if\s+(.+?)\s*->\s*(.+)$/);
                        if (cm)
                            cases.push({ pattern: parsePattern(cm[1]), guard: parseExprRD(cm[2]), body: parseExprRD(cm[3]) });
                        else {
                            cm = trimmed.match(/^(.+?)\s*->\s*(.+)$/);
                            if (cm)
                                cases.push({ pattern: parsePattern(cm[1]), body: parseExprRD(cm[2]) });
                        }
                    }
                    lx.eatWs();
                }
                if (lx.peek() === '}')
                    lx.next();
                return { kind: 'Match', sid: (0, core_ir_1.sid)('match'), scrutinee: scr, cases };
            }
        }
        if (lx.peek() === '"')
            return parseString();
        if (/[0-9]/.test(lx.peek()))
            return parseNumber();
        if (lx.s.slice(lx['i'], lx['i'] + 4) === 'true') {
            lx['i'] += 4;
            return { kind: 'LitBool', sid: (0, core_ir_1.sid)('lit'), value: true };
        }
        if (lx.s.slice(lx['i'], lx['i'] + 5) === 'false') {
            lx['i'] += 5;
            return { kind: 'LitBool', sid: (0, core_ir_1.sid)('lit'), value: false };
        }
        if (lx.peek() === '(') {
            lx.next();
            const e = parseOr();
            lx.eatWs();
            if (lx.peek() === ')')
                lx.next();
            return e;
        }
        if (lx.peek() === '{') {
            // Decide between RecordLit, MapLit and Block by scanning ahead for ':' vs '->' vs ';'
            let j = lx['i'] + 1;
            let depth = 0;
            let sawColon = false;
            let sawSemicolon = false;
            let sawArrow = false;
            while (j < lx.s.length) {
                const ch = lx.s[j];
                if (ch === '{')
                    depth++;
                else if (ch === '}') {
                    if (depth === 0)
                        break;
                    depth--;
                }
                else if (depth === 0) {
                    if (ch === ':') {
                        sawColon = true;
                        break;
                    }
                    if (ch === ';') {
                        sawSemicolon = true;
                        break;
                    }
                    if (ch === '-' && lx.s[j + 1] === '>') {
                        sawArrow = true;
                        break;
                    }
                }
                j++;
            }
            if ((sawColon && !sawSemicolon) && !sawArrow) {
                lx.next();
                const fields = [];
                lx.eatWs();
                if (lx.peek() !== '}') {
                    while (true) {
                        lx.eatWs();
                        let key = '';
                        while (/[A-Za-z_]/.test(lx.peek()))
                            key += lx.next();
                        lx.eatWs();
                        if (lx.peek() === ':')
                            lx.next();
                        lx.eatWs();
                        const value = parseOr();
                        fields.push({ name: key, expr: value });
                        lx.eatWs();
                        if (lx.peek() === ',') {
                            lx.next();
                            lx.eatWs();
                            continue;
                        }
                        break;
                    }
                }
                if (lx.peek() === '}')
                    lx.next();
                return { kind: 'RecordLit', sid: (0, core_ir_1.sid)('rec'), fields };
            }
            else if (sawArrow && !sawSemicolon) {
                // Map literal: { key -> value, ... }
                lx.next();
                const entries = [];
                lx.eatWs();
                if (lx.peek() !== '}') {
                    while (true) {
                        const key = parseOr();
                        lx.eatWs();
                        if (lx.peek() === '-' && lx.s[lx['i'] + 1] === '>') {
                            lx.next();
                            lx.next();
                        }
                        else { /* error-recovery */ }
                        lx.eatWs();
                        const value = parseOr();
                        entries.push({ key, value });
                        lx.eatWs();
                        if (lx.peek() === ',') {
                            lx.next();
                            lx.eatWs();
                            continue;
                        }
                        break;
                    }
                }
                if (lx.peek() === '}')
                    lx.next();
                return { kind: 'MapLit', sid: (0, core_ir_1.sid)('map'), entries };
            }
            else {
                // Block: { expr; expr; ... }
                lx.next();
                const stmts = [];
                while (!lx.eof() && lx.peek() !== '}') {
                    let depth2 = 0;
                    let buf = '';
                    while (!lx.eof()) {
                        const ch = lx.peek();
                        if (ch === '{')
                            depth2++;
                        if (ch === '}') {
                            if (depth2 === 0)
                                break;
                            depth2--;
                        }
                        if (ch === ';' && depth2 === 0) {
                            lx.next();
                            break;
                        }
                        buf += lx.next();
                    }
                    const stmt = buf.trim();
                    if (stmt.length > 0)
                        stmts.push(parseExprRD(stmt));
                    lx.eatWs();
                }
                if (lx.peek() === '}')
                    lx.next();
                return { kind: 'Block', sid: (0, core_ir_1.sid)('block'), stmts };
            }
        }
        if (lx.peek() === '[') {
            lx.next();
            const elements = [];
            lx.eatWs();
            if (lx.peek() !== ']') {
                while (true) {
                    const el = parseOr();
                    elements.push(el);
                    lx.eatWs();
                    if (lx.peek() === ',') {
                        lx.next();
                        lx.eatWs();
                        continue;
                    }
                    break;
                }
            }
            if (lx.peek() === ']')
                lx.next();
            return { kind: 'TupleLit', sid: (0, core_ir_1.sid)('tuple'), elements };
        }
        // identifier (possibly qualified with dots) or call
        let name = '';
        if (/[A-Za-z_]/.test(lx.peek())) {
            while (/[A-Za-z0-9_]/.test(lx.peek()))
                name += lx.next();
            // allow qualified: foo.bar.baz
            while (lx.peek() === '.') {
                name += lx.next();
                while (/[A-Za-z0-9_]/.test(lx.peek()))
                    name += lx.next();
            }
            lx.eatWs();
            if (lx.peek() === '(') {
                lx.next();
                const args = [];
                lx.eatWs();
                if (lx.peek() !== ')') {
                    while (true) {
                        const arg = parseOr();
                        args.push(arg);
                        lx.eatWs();
                        if (lx.peek() === ',') {
                            lx.next();
                            lx.eatWs();
                            continue;
                        }
                        break;
                    }
                }
                if (lx.peek() === ')')
                    lx.next();
                // Effect call if first segment is a builtin effect
                const dotIdx = name.indexOf('.');
                if (dotIdx > 0) {
                    const head = name.slice(0, dotIdx);
                    const op = name.slice(dotIdx + 1);
                    if (builtinEffects.has(head))
                        return { kind: 'EffectCall', sid: (0, core_ir_1.sid)('eff'), effect: head, op, args };
                }
                const lastSeg = name.includes('.') ? name.split('.').pop() || '' : name;
                if (/^[A-Z]/.test(lastSeg))
                    return { kind: 'Ctor', sid: (0, core_ir_1.sid)('ctor'), name, args };
                if (name === 'spawn' && args.length === 1 && args[0].kind === 'Var')
                    return { kind: 'Spawn', sid: (0, core_ir_1.sid)('spawn'), actorName: args[0].name };
                if (name === 'ask' && (args.length === 2 || args.length === 3)) {
                    const timeout = args.length === 3 && args[2].kind === 'LitNum' ? args[2].value : undefined;
                    return { kind: 'Ask', sid: (0, core_ir_1.sid)('ask'), actor: args[0], message: args[1], timeoutMs: timeout };
                }
                return { kind: 'Call', sid: (0, core_ir_1.sid)('call'), callee: { kind: 'Var', sid: (0, core_ir_1.sid)('var'), name }, args };
            }
            return { kind: 'Var', sid: (0, core_ir_1.sid)('var'), name };
        }
        return { kind: 'LitText', sid: (0, core_ir_1.sid)('lit'), value: '' };
    }
    function parseUnary() {
        lx.eatWs();
        if (lx.eatKeyword('not'))
            return { kind: 'Unary', sid: (0, core_ir_1.sid)('un'), op: 'not', expr: parseUnary() };
        if (lx.peek() === '-') {
            lx.next();
            return { kind: 'Unary', sid: (0, core_ir_1.sid)('un'), op: 'neg', expr: parseUnary() };
        }
        return parsePrimary();
    }
    function parseMul() {
        let left = parseUnary();
        while (true) {
            lx.eatWs();
            const ch = lx.peek();
            if (ch === '*' || ch === '/' || ch === '%') {
                const op = lx.next();
                const right = parseUnary();
                left = { kind: 'Binary', sid: (0, core_ir_1.sid)('bin'), op, left, right };
            }
            else
                break;
        }
        return left;
    }
    function parseAdd() {
        let left = parseMul();
        while (true) {
            lx.eatWs();
            const ch = lx.peek();
            if (ch === '+' || ch === '-') {
                const op = lx.next();
                const right = parseMul();
                left = { kind: 'Binary', sid: (0, core_ir_1.sid)('bin'), op, left, right };
            }
            else
                break;
        }
        return left;
    }
    function parseCompare() {
        let left = parseAdd();
        while (true) {
            lx.eatWs();
            const two = lx.s.slice(lx['i'], lx['i'] + 2);
            const one = lx.s.slice(lx['i'], lx['i'] + 1);
            let op = null;
            if (two === '==' || two === '!=' || two === '<=' || two === '>=') {
                op = two;
                lx['i'] += 2;
            }
            else if (one === '<' || one === '>') {
                op = one;
                lx['i'] += 1;
            }
            if (op) {
                const right = parseAdd();
                left = { kind: 'Binary', sid: (0, core_ir_1.sid)('bin'), op: op, left, right };
            }
            else
                break;
        }
        return left;
    }
    function parseAnd() {
        let left = parseCompare();
        while (true) {
            lx.eatWs();
            if (lx.eatKeyword('and')) {
                const right = parseCompare();
                left = { kind: 'Binary', sid: (0, core_ir_1.sid)('bin'), op: 'and', left, right };
            }
            else
                break;
        }
        return left;
    }
    function parseOr() {
        let left = parseAnd();
        while (true) {
            lx.eatWs();
            if (lx.eatKeyword('or')) {
                const right = parseAnd();
                left = { kind: 'Binary', sid: (0, core_ir_1.sid)('bin'), op: 'or', left, right };
            }
        }
        return left;
    }
    const expr = parseOr();
    return expr;
}
function parse(source) {
    const pre = stripComments(source);
    const rawLines = pre.split(/\n+/);
    const lines = rawLines.map(s => s.trim()).filter(s => s.length > 0);
    const decls = [];
    const reserved = new Set(['actor', 'and', 'as', 'assert', 'break', 'case', 'continue', 'data', 'effect', 'else', 'false', 'fn', 'from', 'import', 'in', 'let', 'match', 'module', 'mut', 'not', 'on', 'or', 'query', 'raises', 'return', 'schema', 'select', 'source', 'spawn', 'spec', 'state', 'stream', 'true', 'unit', 'view', 'where', 'with']);
    function isReservedName(name) { return reserved.has(name); }
    for (let idx = 0; idx < lines.length; idx++) {
        const ln = lines[idx];
        if (ln.startsWith('module ')) {
            const m = ln.match(/^module\s+([A-Za-z_][A-Za-z0-9_]*)$/);
            if (m) {
                decls.push({ kind: 'ModuleDecl', sid: (0, core_ir_1.sid)('module'), name: m[1], span: { start: 0, end: 0, line: idx + 1 } });
                continue;
            }
        }
        if (ln.startsWith('import ')) {
            // import "path"  |  import name [as alias]
            let m = ln.match(/^import\s+"([^"]+)"$/);
            if (m) {
                decls.push({ kind: 'ImportDecl', sid: (0, core_ir_1.sid)('import'), path: m[1], span: { start: 0, end: 0, line: idx + 1 } });
                continue;
            }
            m = ln.match(/^import\s+([A-Za-z_][A-Za-z0-9_]*)(?:\s+as\s+([A-Za-z_][A-Za-z0-9_]*))?$/);
            if (m) {
                decls.push({ kind: 'ImportDecl', sid: (0, core_ir_1.sid)('import'), path: m[1], name: m[1], alias: m[2], span: { start: 0, end: 0, line: idx + 1 } });
                continue;
            }
        }
        if (ln.startsWith('enum ')) {
            const m = ln.match(/^enum\s+([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.+)$/);
            if (m) {
                const name = m[1];
                if (isReservedName(name))
                    continue;
                const rhs = m[2];
                const variants = rhs.split('|').map(s => s.trim()).filter(Boolean).map(v => {
                    const mm = v.match(/^([A-Za-z_][A-Za-z0-9_]*)(?:\(([^)]*)\))?$/);
                    const vname = mm?.[1] || v;
                    const params = (mm?.[2] || '').trim() ? (mm[2].split(',').map(x => x.trim()).filter(Boolean)) : [];
                    return { name: vname, params };
                });
                decls.push({ kind: 'EnumDecl', sid: (0, core_ir_1.sid)('enum'), name, variants, span: { start: 0, end: 0, line: idx + 1 } });
                continue;
            }
        }
        // actor block form: actor Name { ... }
        if (/^actor\s+[A-Za-z_][A-Za-z0-9_]*\s*\{$/.test(ln)) {
            const name = ln.match(/^actor\s+([A-Za-z_][A-Za-z0-9_]*)\s*\{$/)[1];
            if (isReservedName(name)) {
                idx++;
                while (idx < lines.length && lines[idx] !== '}')
                    idx++;
                continue;
            }
            const state = [];
            const handlers = [];
            idx++;
            for (; idx < lines.length; idx++) {
                const line = lines[idx];
                if (line === '}')
                    break;
                if (line.startsWith('state ')) {
                    const sm = line.match(/^state\s+([A-Za-z_][A-Za-z0-9_]*)\s*:\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.+)$/);
                    if (sm) {
                        state.push({ name: sm[1], type: sm[2], init: parseExprRD(sm[3]) });
                        continue;
                    }
                }
                if (line.startsWith('on ')) {
                    let tmp = line;
                    tmp = tmp.replace(/^on\s+case\s+/, 'on ');
                    let hm = tmp.match(/^on\s+(.+?)\s+if\s+(.+?)\s+reply\s+([A-Za-z_][A-Za-z0-9_]*)\s*->\s*(.+)$/);
                    if (hm) {
                        handlers.push({ pattern: parsePattern(hm[1]), replyType: hm[3], body: parseExprRD(hm[4]), guard: parseExprRD(hm[2]) });
                        continue;
                    }
                    hm = tmp.match(/^on\s+(.+?)\s+reply\s+([A-Za-z_][A-Za-z0-9_]*)\s*->\s*(.+)$/);
                    if (hm) {
                        handlers.push({ pattern: parsePattern(hm[1]), replyType: hm[2], body: parseExprRD(hm[3]) });
                        continue;
                    }
                    hm = tmp.match(/^on\s+(.+?)\s+if\s+(.+?)\s*->\s*(.+)$/);
                    if (hm) {
                        handlers.push({ pattern: parsePattern(hm[1]), body: parseExprRD(hm[3]), guard: parseExprRD(hm[2]) });
                        continue;
                    }
                    hm = tmp.match(/^on\s+(.+)\s*->\s*(.+)$/);
                    if (hm) {
                        handlers.push({ pattern: parsePattern(hm[1]), body: parseExprRD(hm[2]) });
                        continue;
                    }
                }
            }
            decls.push({ kind: 'ActorDeclNew', sid: (0, core_ir_1.sid)('actorN'), name, state, handlers, effects: new Set(), span: { start: 0, end: 0, line: idx + 1 } });
            continue;
        }
        // mut decl
        if (ln.startsWith('mut ')) {
            const m = ln.match(/^mut\s+([A-Za-z_][A-Za-z0-9_]*)\s*:\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.+)$/);
            if (m) {
                if (isReservedName(m[1])) {
                    continue;
                }
                decls.push({ kind: 'Let', sid: (0, core_ir_1.sid)('let'), name: m[1], type: m[2] || undefined, expr: parseExprRD(m[3]), mutable: true, span: { start: 0, end: 0, line: idx + 1 } });
                continue;
            }
        }
        if (ln.startsWith('let ')) {
            // let name[: Type]? = expr
            const m = ln.match(/^let\s+([A-Za-z_][A-Za-z0-9_]*)(?:\s*:\s*([A-Za-z_][A-Za-z0-9_]*))?\s*=\s*(.+)$/);
            if (m) {
                if (isReservedName(m[1])) {
                    continue;
                }
                let rhs = m[3];
                if (/^match\b/.test(rhs) && (rhs.split('{').length - 1) > (rhs.split('}').length - 1)) {
                    let depth = (rhs.match(/\{/g) || []).length - (rhs.match(/\}/g) || []).length;
                    while (depth > 0 && idx + 1 < lines.length) {
                        idx++;
                        rhs += '\n' + lines[idx];
                        depth += (lines[idx].match(/\{/g) || []).length - (lines[idx].match(/\}/g) || []).length;
                    }
                }
                decls.push({ kind: 'Let', sid: (0, core_ir_1.sid)('let'), name: m[1], type: m[2] || undefined, expr: parseExprRD(rhs), span: { start: 0, end: 0, line: idx + 1 } });
                continue;
            }
        }
        if (ln.startsWith('fn ')) {
            // fn name(params[:Type, ...])[:Return]? [raises e1, e2] = expr
            const m = ln.match(/^fn\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(([^)]*)\)\s*(?::\s*([A-Za-z_][A-Za-z0-9_]*))?\s*(?:raises\s+([^=]+))?\s*=\s*(.+)$/);
            if (m) {
                if (isReservedName(m[1])) {
                    continue;
                }
                const params = m[2].trim() === '' ? [] : m[2].split(',').map(s => s.trim()).map(p => {
                    const pm = p.match(/^([A-Za-z_][A-Za-z0-9_]*)(?:\s*:\s*([A-Za-z_][A-Za-z0-9_]*))?$/);
                    return { name: pm?.[1] || p, type: pm?.[2] };
                });
                const returnType = m[3] || undefined;
                let bodySrc = m[5];
                if (/^match\b/.test(bodySrc) && (bodySrc.split('{').length - 1) > (bodySrc.split('}').length - 1)) {
                    let depth = (bodySrc.match(/\{/g) || []).length - (bodySrc.match(/\}/g) || []).length;
                    while (depth > 0 && idx + 1 < lines.length) {
                        idx++;
                        bodySrc += '\n' + lines[idx];
                        depth += (lines[idx].match(/\{/g) || []).length - (lines[idx].match(/\}/g) || []).length;
                    }
                }
                const body = parseExprRD(bodySrc);
                const effects = new Set();
                const raises = (m[4] ?? '').trim();
                if (raises)
                    for (const eff of raises.split(',').map(s => s.trim()).filter(Boolean))
                        effects.add(eff);
                decls.push({ kind: 'Fn', sid: (0, core_ir_1.sid)('fn'), name: m[1], params, returnType, body, effects, span: { start: 0, end: 0, line: idx + 1 } });
                continue;
            }
        }
        if (ln.startsWith('actor ')) {
            // actor Name[(param[:Type])]? [raises e1,e2] = expr
            const m = ln.match(/^actor\s+([A-Za-z_][A-Za-z0-9_]*)\s*(?:\(([^:)]+)(?::\s*([A-Za-z_][A-Za-z0-9_]*))?\))?\s*(?:raises\s+([^=]+))?\s*\=\s*(.+)$/);
            if (m) {
                if (isReservedName(m[1])) {
                    continue;
                }
                const name = m[1];
                const param = m[2] ? { name: m[2], type: m[3] || undefined } : null;
                const effects = new Set();
                const raises = (m[4] ?? '').trim();
                if (raises)
                    for (const eff of raises.split(',').map(s => s.trim()).filter(Boolean))
                        effects.add(eff);
                const body = parseExprRD(m[5]);
                decls.push({ kind: 'ActorDecl', sid: (0, core_ir_1.sid)('actor'), name, param, body, effects, span: { start: 0, end: 0, line: idx + 1 } });
                continue;
            }
        }
        if (ln.startsWith('spawn ')) {
            const m = ln.match(/^spawn\s+([A-Za-z_][A-Za-z0-9_.]*)$/);
            if (m) {
                if (isReservedName(m[1])) {
                    continue;
                }
                decls.push({ kind: 'Spawn', sid: (0, core_ir_1.sid)('spawn'), actorName: m[1], span: { start: 0, end: 0, line: idx + 1 } });
                continue;
            }
        }
        if (ln.startsWith('send ')) {
            let m = ln.match(/^send\s+([^,\s]+)\s*,\s*(.+)$/);
            if (!m)
                m = ln.match(/^send\s+([^\s]+)\s+(.+)$/);
            if (m) {
                decls.push({ kind: 'Send', sid: (0, core_ir_1.sid)('send'), actor: parseExprRD(m[1]), message: parseExprRD(m[2]), span: { start: 0, end: 0, line: idx + 1 } });
                continue;
            }
        }
        if (ln.startsWith('ask ')) {
            let m = ln.match(/^ask\s+([^,\s]+)\s*,\s*([^,\s]+)(?:\s*,\s*(\d+))?$/);
            if (!m)
                m = ln.match(/^ask\s+([^\s]+)\s+([^,\s]+)(?:\s*,\s*(\d+))?$/);
            if (m) {
                const actor = parseExprRD(m[1]);
                const msg = parseExprRD(m[2]);
                const timeout = m[3] ? Number(m[3]) : undefined;
                decls.push({ kind: 'Ask', sid: (0, core_ir_1.sid)('ask'), actor, message: msg, timeoutMs: timeout, span: { start: 0, end: 0, line: idx + 1 } });
                continue;
            }
        }
        if (ln.startsWith('match ')) {
            let mm = ln.match(/^match\s+(.+)\s*\{$/);
            if (mm) {
                const scr = parseExprRD(mm[1]);
                idx += 1;
                const cases = [];
                for (; idx < lines.length; idx++) {
                    const line = lines[idx];
                    if (line === '}')
                        break;
                    const trimmed = line.startsWith('case ') ? line.slice(5).trim() : line;
                    let cm = trimmed.match(/^(.+?)\s+if\s+(.+?)\s*->\s*(.+)$/);
                    if (cm) {
                        cases.push({ pattern: parsePattern(cm[1]), guard: parseExprRD(cm[2]), body: parseExprRD(cm[3]) });
                        continue;
                    }
                    cm = trimmed.match(/^(.+?)\s*->\s*(.+)$/);
                    if (cm) {
                        cases.push({ pattern: parsePattern(cm[1]), body: parseExprRD(cm[2]) });
                        continue;
                    }
                }
                decls.push({ kind: 'Match', sid: (0, core_ir_1.sid)('match'), scrutinee: scr, cases, span: { start: 0, end: 0, line: idx + 1 } });
                continue;
            }
            mm = ln.match(/^match\s+(.+)$/);
            if (mm) {
                const scr = parseExprRD(mm[1]);
                if (lines[idx + 1] && lines[idx + 1].trim() === '{') {
                    idx += 2;
                    const cases = [];
                    for (; idx < lines.length; idx++) {
                        const line = lines[idx];
                        if (line === '}')
                            break;
                        const trimmed = line.startsWith('case ') ? line.slice(5).trim() : line;
                        let cm = trimmed.match(/^(.+?)\s+if\s+(.+?)\s*->\s*(.+)$/);
                        if (cm) {
                            cases.push({ pattern: parsePattern(cm[1]), guard: parseExprRD(cm[2]), body: parseExprRD(cm[3]) });
                            continue;
                        }
                        cm = trimmed.match(/^(.+?)\s*->\s*(.+)$/);
                        if (cm) {
                            cases.push({ pattern: parsePattern(cm[1]), body: parseExprRD(cm[2]) });
                            continue;
                        }
                    }
                    decls.push({ kind: 'Match', sid: (0, core_ir_1.sid)('match'), scrutinee: scr, cases, span: { start: 0, end: 0, line: idx + 1 } });
                    continue;
                }
            }
        }
        if (ln.startsWith('schema ')) {
            const m = ln.match(/^schema\s+([A-Za-z_][A-Za-z0-9_]*)\s*\{$/);
            if (m) {
                const name = m[1];
                if (isReservedName(name)) {
                    idx++;
                    while (idx < lines.length && lines[idx] !== '}')
                        idx++;
                    continue;
                }
                idx += 1;
                const fields = {};
                for (; idx < lines.length; idx++) {
                    const line = lines[idx];
                    if (line === '}')
                        break;
                    const fm = line.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*:\s*([A-Za-z_][A-Za-z0-9_]*)\s*,?$/);
                    if (fm)
                        fields[fm[1]] = fm[2];
                }
                decls.push({ kind: 'SchemaDecl', sid: (0, core_ir_1.sid)('schema'), name, fields, span: { start: 0, end: 0, line: idx + 1 } });
                continue;
            }
        }
        if (ln.startsWith('spec ')) {
            const m = ln.match(/^spec\s+"([^"]+)"\s*\{$/);
            if (m) {
                const name = m[1];
                idx += 1;
                const asserts = [];
                for (; idx < lines.length; idx++) {
                    const line = lines[idx];
                    if (line === '}')
                        break;
                    const am = line.match(/^assert\s*\(\s*(.+)\s*,\s*"([^"]*)"\s*\)\s*;?$/);
                    if (am)
                        asserts.push({ expr: parseExprRD(am[1]), message: am[2] });
                }
                decls.push({ kind: 'SpecDecl', sid: (0, core_ir_1.sid)('spec'), name, asserts, span: { start: 0, end: 0, line: idx + 1 } });
                continue;
            }
        }
        if (ln.startsWith('source ')) {
            // source tasks: Store<User> with persist("sqlite:...")
            const m = ln.match(/^source\s+([A-Za-z_][A-Za-z0-9_]*)\s*:\s*Store<([A-Za-z_][A-Za-z0-9_]*)>\s*(?:with\s+(.+))?$/);
            if (m) {
                const name = m[1];
                if (isReservedName(name)) {
                    continue;
                }
                const schema = m[2];
                let config = null;
                const withExpr = (m[3] || '').trim();
                if (withExpr) {
                    const sm = withExpr.match(/^persist\(\s*"([^"]+)"\s*\)$/) || withExpr.match(/^"([^"]+)"$/);
                    if (sm)
                        config = sm[1];
                }
                decls.push({ kind: 'StoreDecl', sid: (0, core_ir_1.sid)('store'), name, schema, config, span: { start: 0, end: 0, line: idx + 1 } });
                continue;
            }
        }
        if (ln.startsWith('store ')) {
            // legacy store Name : Schema = "config"
            const m = ln.match(/^store\s+([A-Za-z_][A-Za-z0-9_]*)\s*:\s*([A-Za-z_][A-Za-z0-9_]*)\s*(?:=\s*"([^"]*)")?$/);
            if (m) {
                if (isReservedName(m[1])) {
                    continue;
                }
                decls.push({ kind: 'StoreDecl', sid: (0, core_ir_1.sid)('store'), name: m[1], schema: m[2], config: m[3] ?? null, span: { start: 0, end: 0, line: idx + 1 } });
                continue;
            }
        }
        if (ln.startsWith('query ')) {
            // Support both: single-line form and comprehension block form
            // 1) query Name from Store where <expr> select a,b
            let m = ln.match(/^query\s+([A-Za-z_][A-Za-z0-9_]*)\s+from\s+([A-Za-z_][A-Za-z0-9_]*)\s+where\s+(.+)\s+select\s+(.+)$/);
            if (!m)
                m = ln.match(/^query\s+([A-Za-z_][A-Za-z0-9_]*)\s+from\s+([A-Za-z_][A-Za-z0-9_]*)(?:\s+select\s+(.+))?$/);
            if (m) {
                if (isReservedName(m[1])) {
                    continue;
                }
                const name = m[1];
                const source = m[2];
                const where = m[3] && m[4] ? m[3] : (m[3] && !m[4] ? undefined : undefined);
                const select = m[4] || (m[3] && !m[4] ? m[3] : undefined);
                const predicate = where ? parseExprRD(where) : undefined;
                const projection = select ? select.split(',').map(s => s.trim()).filter(Boolean) : undefined;
                decls.push({ kind: 'QueryDecl', sid: (0, core_ir_1.sid)('query'), name, source, predicate, projection, span: { start: 0, end: 0, line: idx + 1 } });
                continue;
            }
            // 2) query Name() = from x in store.stream() [where expr] select expr
            const mc = ln.match(/^query\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(\)\s*=\s*from\s+([A-Za-z_][A-Za-z0-9_]*)\s+in\s+(.+?)\s*(?:where\s+(.+?))?\s*select\s+(.+)$/);
            if (mc) {
                if (isReservedName(mc[1])) {
                    continue;
                }
                const name = mc[1];
                const alias = mc[2];
                const srcExpr = mc[3];
                const whereExpr = mc[4];
                const selectExpr = mc[5];
                // try to reduce srcExpr to a store name optionally ending with .stream()
                let source = srcExpr.trim();
                const sm = source.match(/^([A-Za-z_][A-Za-z0-9_]*)(?:\.stream\(\))?$/);
                source = sm ? sm[1] : source;
                // very basic handling: if select is alias.field list split on ','; if 'alias' alone, projection undefined
                let projection;
                const trimmedSel = selectExpr.trim();
                if (trimmedSel === alias)
                    projection = undefined;
                else if (trimmedSel.startsWith(alias + '.'))
                    projection = [trimmedSel.slice(alias.length + 1)];
                else if (trimmedSel.includes(',')) {
                    const parts = trimmedSel.split(',').map(s => s.trim());
                    const fields = [];
                    for (const p of parts)
                        if (p.startsWith(alias + '.'))
                            fields.push(p.slice(alias.length + 1));
                    projection = fields.length ? fields : undefined;
                }
                const predicate = whereExpr ? parseExprRD(whereExpr.replace(new RegExp('^' + alias + '\\.', 'g'), '')) : undefined;
                decls.push({ kind: 'QueryDecl', sid: (0, core_ir_1.sid)('query'), name, source, predicate, projection, span: { start: 0, end: 0, line: idx + 1 } });
                continue;
            }
        }
        // Fallback: treat as bare expression declaration by synthesizing a let _N
        const name = `tmp_${decls.length}`;
        decls.push({ kind: 'Let', sid: (0, core_ir_1.sid)('let'), name, expr: parseExprRD(ln), span: { start: 0, end: 0, line: idx + 1 } });
    }
    return { kind: 'Program', sid: (0, core_ir_1.sid)('prog'), decls };
}
