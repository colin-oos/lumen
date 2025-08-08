#!/usr/bin/env node
"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const parser_1 = require("@lumen/parser");
const fmt_1 = require("@lumen/fmt");
const core_ir_1 = require("@lumen/core-ir");
const runner_1 = require("@lumen/runner");
function usage() {
    console.log(`lumen <cmd> [args]
  cmds:
    fmt <path> [--write] [--recursive]  Format file or directory (prints to stdout unless --write)
    run <file> [--deny e1,e2]      Parse (with imports) and run (runner)
    check <path> [--json] [--policy <file>] [--strict-warn]  Round-trip + effect check for file or directory
    init <dir>             Scaffold a new LUMEN project
`);
}
async function main() {
    const [, , cmd, target, ...rest] = process.argv;
    if (!cmd || !target) {
        usage();
        process.exit(1);
    }
    const resolved = path_1.default.resolve(target);
    const isDir = fs_1.default.existsSync(resolved) && fs_1.default.lstatSync(resolved).isDirectory();
    const write = rest.includes('--write');
    const recursive = rest.includes('--recursive');
    const runOnFiles = (files, fn) => {
        for (const f of files)
            fn(f);
    };
    if (cmd === 'fmt') {
        const files = isDir
            ? collectLumFiles(resolved, recursive)
            : [resolved];
        runOnFiles(files, (f) => {
            const src = fs_1.default.readFileSync(f, 'utf8');
            const ast = (0, parser_1.parse)(src);
            (0, core_ir_1.assignStableSids)(ast);
            const out = (0, fmt_1.format)(ast);
            if (write)
                fs_1.default.writeFileSync(f, out, 'utf8');
            else
                console.log(out);
        });
        return;
    }
    if (cmd === 'run') {
        const entry = resolved;
        const ast = loadWithImports(entry);
        (0, core_ir_1.assignStableSids)(ast);
        // collect deny list from flag and policy
        const denyFlag = rest.find(a => a.startsWith('--deny'));
        let denyList = [];
        if (denyFlag) {
            const parts = denyFlag.includes('=') ? denyFlag.split('=')[1] : rest[rest.indexOf('--deny') + 1];
            if (parts)
                denyList = parts.split(',').map(s => s.trim()).filter(Boolean);
        }
        const policyPath = findPolicyFile(entry);
        if (policyPath && fs_1.default.existsSync(policyPath)) {
            const policy = JSON.parse(fs_1.default.readFileSync(policyPath, 'utf8'));
            const fromPolicy = (policy?.policy?.deny ?? []);
            denyList = Array.from(new Set([...denyList,
                ...fromPolicy,
            ]));
        }
        const deniedEffects = new Set(denyList);
        const res = (0, runner_1.run)(ast, deniedEffects.size > 0 ? { deniedEffects } : undefined);
        console.log(JSON.stringify(res, null, 2));
        return;
    }
    if (cmd === 'check') {
        // Collect files: if a single file, include its transitive imports; if a dir, traverse dir
        const files = isDir
            ? collectLumFiles(resolved, recursive)
            : Array.from(new Set([resolved, ...collectImportsTransitive(resolved)]));
        let ok = true;
        const writeBack = [];
        const parsed = files.map(f => ({ path: f, src: fs_1.default.readFileSync(f, 'utf8') }))
            .map(({ path: p, src }) => ({ path: p, ast: (0, parser_1.parse)(src), formatted: '', ast2: null }));
        // Round-trip
        for (const item of parsed) {
            (0, core_ir_1.assignStableSids)(item.ast);
            (0, core_ir_1.assignStableSids)(item.ast);
            item.formatted = (0, fmt_1.format)(item.ast);
            item.ast2 = (0, parser_1.parse)(item.formatted);
            (0, core_ir_1.assignStableSids)(item.ast2);
            (0, core_ir_1.assignStableSids)(item.ast2);
            if (!structurallySimilar(item.ast, item.ast2)) {
                console.error(`Round-trip mismatch: ${item.path}`);
                ok = false;
            }
            if (write)
                writeBack.push({ path: item.path, content: item.formatted });
        }
        // Effect analysis across files
        const json = rest.includes('--json');
        const strictWarn = rest.includes('--strict-warn');
        const policyPathFlagIdx = rest.indexOf('--policy');
        const policyPath = policyPathFlagIdx >= 0 ? path_1.default.resolve(rest[policyPathFlagIdx + 1]) : findPolicyFile(resolved);
        const policy = policyPath && fs_1.default.existsSync(policyPath) ? JSON.parse(fs_1.default.readFileSync(policyPath, 'utf8')) : null;
        const effErrors = checkEffectsProject(parsed.map(p => ({ path: p.path, ast: p.ast })));
        const typeReport = checkTypesProject(parsed.map(p => ({ path: p.path, ast: p.ast })));
        const policyReport = policy ? checkPolicyDetailed(parsed.map(p => ({ path: p.path, ast: p.ast })), policy) : { errors: [], warnings: [] };
        if (json) {
            const payload = { ok: ok && effErrors.length === 0 && policyReport.errors.length === 0 && (!strictWarn || policyReport.warnings.length === 0) && typeReport.errors.length === 0, files: files, errors: effErrors, policy: policyReport, types: typeReport };
            console.log(JSON.stringify(payload, null, 2));
            if (!payload.ok)
                process.exit(2);
            return;
        }
        else {
            for (const w of policyReport.warnings)
                console.warn(`warn: ${w}`);
            for (const e of typeReport.errors) {
                console.error(e);
                ok = false;
            }
            for (const e of [...effErrors, ...policyReport.errors]) {
                console.error(e);
                ok = false;
            }
            if (strictWarn && policyReport.warnings.length > 0)
                ok = false;
        }
        if (!ok)
            process.exit(2);
        if (write)
            for (const w of writeBack)
                fs_1.default.writeFileSync(w.path, w.content, 'utf8');
        console.log('OK');
        return;
    }
    if (cmd === 'init') {
        const dest = resolved;
        if (!fs_1.default.existsSync(dest))
            fs_1.default.mkdirSync(dest, { recursive: true });
        const srcDir = path_1.default.join(dest, 'src');
        if (!fs_1.default.existsSync(srcDir))
            fs_1.default.mkdirSync(srcDir, { recursive: true });
        const mainPath = path_1.default.join(srcDir, 'main.lum');
        if (!fs_1.default.existsSync(mainPath)) {
            fs_1.default.writeFileSync(mainPath, `// LUMEN starter\nlet greeting = "Hello from LUMEN"\n\nfn main() = greeting\n\nmain()\n`, 'utf8');
        }
        const cfgPath = path_1.default.join(dest, 'lumen.json');
        if (!fs_1.default.existsSync(cfgPath)) {
            fs_1.default.writeFileSync(cfgPath, JSON.stringify({ policy: { deny: [] } }, null, 2), 'utf8');
        }
        console.log(`Initialized LUMEN project at ${dest}`);
        return;
    }
    usage();
}
main().catch(e => { console.error(e); process.exit(1); });
// Helpers
function structurallySimilar(a, b) {
    // Compare kinds and structure of Program decls ignoring sid
    if (a?.kind !== b?.kind)
        return false;
    if (a.kind === 'Program' && b.kind === 'Program') {
        if (a.decls.length !== b.decls.length)
            return false;
        for (let i = 0; i < a.decls.length; i++) {
            if (!structurallySimilar(a.decls[i], b.decls[i]))
                return false;
        }
        return true;
    }
    const keysA = Object.keys(a).filter(k => k !== 'sid');
    const keysB = Object.keys(b).filter(k => k !== 'sid');
    if (keysA.length !== keysB.length)
        return false;
    for (const k of keysA) {
        if (!structEqual(a[k], b[k]))
            return false;
    }
    return true;
}
function structEqual(a, b) {
    if (Array.isArray(a) && Array.isArray(b)) {
        if (a.length !== b.length)
            return false;
        for (let i = 0; i < a.length; i++)
            if (!structEqual(a[i], b[i]))
                return false;
        return true;
    }
    if (a && typeof a === 'object' && b && typeof b === 'object')
        return structurallySimilar(a, b);
    return a === b;
}
function checkEffects(ast) {
    // Build function table: name -> Set effects
    const fnTable = new Map();
    if (ast.kind === 'Program') {
        for (const d of ast.decls) {
            if (d.kind === 'Fn' && d.name) {
                const set = new Set();
                for (const v of d.effects)
                    set.add(v);
                fnTable.set(d.name, set);
            }
        }
    }
    const errors = [];
    function walk(e, currentFn) {
        switch (e.kind) {
            case 'Program':
                for (const d of e.decls)
                    walk(d, null);
                break;
            case 'Fn': {
                const set = new Set();
                for (const v of e.effects)
                    set.add(v);
                walk(e.body, { name: e.name ?? '<anon>', effects: set });
                break;
            }
            case 'Call': {
                if (e.callee.kind === 'Var') {
                    const calleeEffects = fnTable.get(e.callee.name);
                    if (calleeEffects && currentFn) {
                        for (const ce of calleeEffects) {
                            if (!currentFn.effects.has(ce)) {
                                errors.push(`effects: function ${currentFn.name} missing '${ce}' but calls ${e.callee.name}`);
                            }
                        }
                    }
                }
                for (const a of e.args)
                    walk(a, currentFn);
                break;
            }
            default:
                // descend simple fields
                for (const k of Object.keys(e)) {
                    const v = e[k];
                    if (v && typeof v === 'object' && 'kind' in v)
                        walk(v, currentFn);
                    if (Array.isArray(v))
                        for (const it of v)
                            if (it && typeof it === 'object' && 'kind' in it)
                                walk(it, currentFn);
                }
        }
    }
    walk(ast, null);
    return errors;
}
function collectLumFiles(dir, recursive) {
    const out = [];
    for (const ent of fs_1.default.readdirSync(dir, { withFileTypes: true })) {
        const p = path_1.default.join(dir, ent.name);
        if (ent.isDirectory()) {
            if (recursive)
                out.push(...collectLumFiles(p, true));
        }
        else if (p.endsWith('.lum'))
            out.push(p);
    }
    return out;
}
// Cross-file effect analysis: build a function table across all files and check nested calls
function checkEffectsProject(files) {
    const table = new Map();
    // First pass: collect named fns and their declared effects
    for (const f of files) {
        if (f.ast.kind !== 'Program')
            continue;
        const moduleName = getModuleName(f.ast);
        for (const d of f.ast.decls) {
            if (d.kind === 'Fn' && d.name) {
                const set = new Set();
                for (const v of d.effects)
                    set.add(v);
                const key = moduleName ? `${moduleName}.${d.name}` : d.name;
                table.set(key, { effects: set, path: f.path });
            }
        }
    }
    const errors = [];
    function walk(e, currentFn) {
        switch (e.kind) {
            case 'Program':
                for (const d of e.decls)
                    walk(d, null);
                break;
            case 'Fn': {
                const set = new Set();
                for (const v of e.effects)
                    set.add(v);
                const ctx = { name: e.name ?? '<anon>', effects: set, path: '', chain: [e.name ?? '<anon>'] };
                walk(e.body, ctx);
                break;
            }
            case 'Call': {
                if (e.callee.kind === 'Var') {
                    const name = e.callee.name;
                    const possibleNames = name.includes('.') ? [name] : [name, ...prefixWithModule(files, name)];
                    const calleeMeta = possibleNames.map(n => table.get(n)).find(Boolean);
                    if (calleeMeta && currentFn) {
                        for (const ce of calleeMeta.effects) {
                            if (!currentFn.effects.has(ce)) {
                                const chain = [...(currentFn.chain || []), e.callee.name].join(' -> ');
                                errors.push(`${currentFn.path || ''}: effects: function ${currentFn.name} missing '${ce}' (call chain: ${chain})`.trim());
                            }
                        }
                        // Recurse into callee body by simulating a call chain context, to catch deeper chains
                        const nextCtx = { name: currentFn.name, effects: currentFn.effects, path: currentFn.path, chain: [...(currentFn.chain || []), e.callee.name] };
                        // Find callee AST and walk its body under the same effect set
                        const calleeFile = files.find(f => f.path === calleeMeta.path);
                        if (calleeFile) {
                            for (const d of (calleeFile.ast.decls || [])) {
                                if (d.kind === 'Fn' && (d.name === e.callee.name || `${getModuleName(calleeFile.ast)}.${d.name}` === possibleNames[1]))
                                    walk(d.body, nextCtx);
                            }
                        }
                    }
                }
                for (const a of e.args)
                    walk(a, currentFn);
                break;
            }
            case 'EffectCall': {
                if (currentFn) {
                    const eff = e.effect;
                    if (!currentFn.effects.has(eff)) {
                        const chain = (currentFn.chain || []).join(' -> ');
                        errors.push(`${currentFn.path || ''}: effects: function ${currentFn.name} missing '${eff}' (effect call${chain ? ` in ${chain}` : ''})`.trim());
                    }
                }
                for (const a of e.args)
                    walk(a, currentFn);
                break;
            }
            default:
                for (const k of Object.keys(e)) {
                    const v = e[k];
                    if (v && typeof v === 'object' && 'kind' in v)
                        walk(v, currentFn);
                    if (Array.isArray(v))
                        for (const it of v)
                            if (it && typeof it === 'object' && 'kind' in it)
                                walk(it, currentFn);
                }
        }
    }
    for (const f of files)
        walk(f.ast, null);
    return Array.from(new Set(errors));
}
// Import expansion helpers
function collectImportsTransitive(entry, visited = new Set()) {
    if (visited.has(entry))
        return [];
    visited.add(entry);
    const dir = path_1.default.dirname(entry);
    const src = fs_1.default.readFileSync(entry, 'utf8');
    const ast = (0, parser_1.parse)(src);
    const imports = [];
    if (ast.kind === 'Program') {
        for (const d of ast.decls) {
            if (d.kind === 'ImportDecl') {
                const p = path_1.default.resolve(dir, d.path);
                imports.push(p);
                imports.push(...collectImportsTransitive(p, visited));
            }
        }
    }
    return imports;
}
function loadWithImports(entry, visited = new Set()) {
    const files = Array.from(new Set([entry, ...collectImportsTransitive(entry)]));
    const decls = [];
    for (const f of files) {
        const src = fs_1.default.readFileSync(f, 'utf8');
        const ast = (0, parser_1.parse)(src);
        if (ast.kind === 'Program') {
            for (const d of ast.decls)
                if (d.kind !== 'ImportDecl')
                    decls.push(d);
        }
    }
    return { kind: 'Program', sid: 'prog:merged', decls };
}
function findPolicyFile(start) {
    const stat = fs_1.default.existsSync(start) ? fs_1.default.lstatSync(start) : null;
    const base = stat && stat.isDirectory() ? start : path_1.default.dirname(start);
    const p = path_1.default.join(base, 'lumen.json');
    return fs_1.default.existsSync(p) ? p : null;
}
function checkPolicyDetailed(files, policy) {
    const denies = (policy?.policy?.deny ?? []);
    const allows = (policy?.policy?.allow ?? []);
    const warnEffects = (policy?.policy?.warn ?? []);
    const errors = [];
    const warnings = [];
    function walk(e, file, moduleName) {
        if (!e || typeof e !== 'object')
            return;
        if (e.kind === 'Fn') {
            const effs = Array.from(e.effects ?? []);
            for (const d of denies)
                if (effs.includes(d))
                    errors.push(`${file}: policy denies effect '${d}' in function ${moduleName ? moduleName + '.' : ''}${e.name ?? '<anon>'}`);
            for (const w of warnEffects)
                if (effs.includes(w))
                    warnings.push(`${file}: policy warns on effect '${w}' in function ${moduleName ? moduleName + '.' : ''}${e.name ?? '<anon>'}`);
            walk(e.body, file, moduleName);
            return;
        }
        if (e.kind === 'Program') {
            const mod = getModuleName(e);
            for (const d of e.decls)
                walk(d, file, mod);
            return;
        }
        for (const k of Object.keys(e)) {
            const v = e[k];
            if (v && typeof v === 'object' && 'kind' in v)
                walk(v, file, moduleName);
            if (Array.isArray(v))
                for (const it of v)
                    if (it && typeof it === 'object' && 'kind' in it)
                        walk(it, file, moduleName);
        }
    }
    for (const f of files)
        walk(f.ast, f.path, null);
    return { errors, warnings };
}
function getModuleName(ast) {
    if (ast.kind !== 'Program')
        return null;
    for (const d of ast.decls)
        if (d.kind === 'ModuleDecl')
            return d.name;
    return null;
}
function prefixWithModule(files, name) {
    const out = [];
    for (const f of files) {
        const m = getModuleName(f.ast);
        if (m)
            out.push(`${m}.${name}`);
    }
    return out;
}
// Very small type checker for literals/ident/let/fn/call/binary/block
function checkTypesProject(files) {
    function typeOfLiteral(e) {
        if (e.kind === 'LitNum')
            return 'Int';
        if (e.kind === 'LitText')
            return 'Text';
        if (e.kind === 'LitBool')
            return 'Bool';
        return 'Unknown';
    }
    const errors = [];
    // simple env per file; fn table for arity checking
    const fnSigs = new Map();
    function parseTypeName(t) {
        if (!t)
            return 'Unknown';
        if (t === 'Int')
            return 'Int';
        if (t === 'Text')
            return 'Text';
        if (t === 'Bool')
            return 'Bool';
        return 'Unknown';
    }
    function effectReturnType(eff, op) {
        if (eff === 'io' && op === 'print')
            return 'Unit';
        if (eff === 'fs' && op === 'read')
            return 'Text';
        if (eff === 'fs' && op === 'write')
            return 'Unit';
        return 'Unknown';
    }
    // First pass: collect function signatures
    for (const f of files) {
        if (f.ast.kind !== 'Program')
            continue;
        const mod = getModuleName(f.ast);
        for (const d of f.ast.decls) {
            if (d.kind === 'Fn' && d.name) {
                const params = d.params.map(p => parseTypeName(p.type));
                const ret = parseTypeName(d.returnType);
                fnSigs.set(mod ? `${mod}.${d.name}` : d.name, { params, ret, path: f.path });
            }
        }
    }
    // Second pass: check bodies
    function checkExpr(e, env, file) {
        switch (e.kind) {
            case 'LitNum':
            case 'LitText':
            case 'LitBool':
                return typeOfLiteral(e);
            case 'Var':
                return env.get(e.name) ?? 'Unknown';
            case 'Let': {
                const t = checkExpr(e.expr, env, file);
                const declT = parseTypeName(e.type);
                if (e.type && declT !== 'Unknown' && t !== 'Unknown' && declT !== t) {
                    errors.push(`${file}: type mismatch in let ${e.name}: declared ${declT} but got ${t}`);
                }
                env.set(e.name, declT !== 'Unknown' ? declT : t);
                return env.get(e.name) ?? 'Unknown';
            }
            case 'Binary': {
                const lt = checkExpr(e.left, env, file);
                const rt = checkExpr(e.right, env, file);
                if ((lt !== 'Int' || rt !== 'Int') && (lt !== 'Unknown' && rt !== 'Unknown')) {
                    errors.push(`${file}: binary ${e.op} expects Int, got ${lt} and ${rt}`);
                }
                return 'Int';
            }
            case 'EffectCall': {
                const rt = effectReturnType(e.effect, e.op);
                for (const a of e.args)
                    checkExpr(a, env, file);
                return rt;
            }
            case 'Call': {
                const name = e.callee.kind === 'Var' ? e.callee.name : '';
                const candidates = name.includes('.') ? [name] : [name, ...prefixWithModule(files, name)];
                const sig = candidates.map(n => fnSigs.get(n)).find(Boolean);
                const argTypes = e.args.map((a) => checkExpr(a, env, file));
                if (sig) {
                    if (sig.params.length !== argTypes.length)
                        errors.push(`${file}: call ${name} arity ${argTypes.length} but expected ${sig.params.length}`);
                    else {
                        for (let i = 0; i < sig.params.length; i++) {
                            if (sig.params[i] !== 'Unknown' && argTypes[i] !== 'Unknown' && sig.params[i] !== argTypes[i]) {
                                errors.push(`${file}: call ${name} arg ${i + 1} type ${argTypes[i]} but expected ${sig.params[i]}`);
                            }
                        }
                    }
                    return sig.ret;
                }
                return 'Unknown';
            }
            case 'Block': {
                const local = new Map(env);
                let last = 'Unknown';
                for (const s of e.stmts)
                    last = checkExpr(s, local, file);
                return last;
            }
            case 'Fn': {
                const local = new Map(env);
                for (const p of e.params)
                    local.set(p.name, parseTypeName(p.type));
                const bodyT = checkExpr(e.body, local, file);
                const retT = parseTypeName(e.returnType);
                if (e.returnType && retT !== 'Unknown' && bodyT !== 'Unknown' && retT !== bodyT) {
                    errors.push(`${file}: function ${e.name ?? '<anon>'} returns ${bodyT} but declared ${retT}`);
                }
                return 'Unknown';
            }
            default:
                return 'Unknown';
        }
    }
    for (const f of files) {
        const env = new Map();
        if (f.ast.kind !== 'Program')
            continue;
        for (const d of f.ast.decls)
            checkExpr(d, env, f.path);
    }
    return { errors };
}
