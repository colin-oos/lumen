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
let lspDiagnostics = null;
let lspHover = null;
try {
    // prefer compiled lsp dist
    const lsp = require('@lumen/lsp');
    lspDiagnostics = lsp.getDiagnostics;
    lspHover = lsp.getHover;
}
catch {
    try {
        // fallback to local build path
        const lsp = require('../lsp/dist/index.js');
        lspDiagnostics = lsp.getDiagnostics;
        lspHover = lsp.getHover;
    }
    catch { }
}
let DISABLE_CACHE = false;
function usage() {
    console.log(`lumen <cmd> [args]
  cmds:
    fmt <path> [--write] [--recursive]  Format file or directory (prints to stdout unless --write)
    run <file> [--deny e1,e2]      Parse (with imports) and run (runner)
    check <path> [--json] [--policy <file>] [--strict-warn]  Round-trip + effect check for file or directory
    init <dir>             Scaffold a new LUMEN project
    serve                  Start simple LSP-like server on stdin/stdout (newline-delimited JSON)
`);
}
async function main() {
    let [, , cmd, target, ...rest] = process.argv;
    if (!cmd) {
        usage();
        process.exit(1);
    }
    if (!target) {
        if (cmd === 'serve' || cmd === 'cache')
            target = '.';
        else {
            usage();
            process.exit(1);
        }
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
    if (cmd === 'cache') {
        const action = (rest[0] || '').toLowerCase();
        const cacheDir = path_1.default.resolve(process.cwd(), '.lumen-cache');
        if (action === 'clear') {
            try {
                if (fs_1.default.existsSync(cacheDir)) {
                    for (const f of fs_1.default.readdirSync(cacheDir))
                        fs_1.default.unlinkSync(path_1.default.join(cacheDir, f));
                    console.log('cache cleared');
                }
                else
                    console.log('no cache');
            }
            catch (e) {
                console.error(String(e));
                process.exit(1);
            }
            return;
        }
        console.log('usage: lumen cache clear');
        return;
    }
    if (cmd === 'hover') {
        const file = resolved;
        const symbol = rest[0];
        const asJson = rest.includes('--json');
        if (!symbol) {
            console.error('usage: lumen hover <file> <symbol> [--json]');
            process.exit(1);
        }
        const ast = loadWithImports(file);
        const info = hoverInfo(ast, symbol);
        if (asJson)
            console.log(JSON.stringify(info, null, 2));
        else {
            if (!info.kind)
                console.log('not found');
            else if (info.kind === 'function')
                console.log(`function ${info.name}${info.module ? ' (' + info.module + ')' : ''} -> ${info.returnType ?? ''} effects: ${(info.effects || []).join(',')}`);
            else if (info.kind === 'enum')
                console.log(`enum ${info.name}${info.module ? ' (' + info.module + ')' : ''}`);
            else if (info.kind === 'constructor')
                console.log(`constructor ${info.name} of ${info.enum}`);
            else if (info.kind === 'store')
                console.log(`store ${info.name} : ${info.schema}`);
            else if (info.kind === 'query')
                console.log(`query ${info.name} from ${info.source}`);
            else
                console.log(`${info.kind}: ${info.name}`);
        }
        return;
    }
    if (cmd === 'serve') {
        // Simple newline-delimited JSON protocol
        // Request: { action: 'hover'|'diagnostics', file?: string, source?: string, symbol?: string }
        // Response: JSON per line
        let buffer = '';
        process.stdin.setEncoding('utf8');
        process.stdin.on('data', chunk => {
            buffer += chunk;
            let idx;
            while ((idx = buffer.indexOf('\n')) >= 0) {
                const line = buffer.slice(0, idx).trim();
                buffer = buffer.slice(idx + 1);
                if (!line)
                    continue;
                try {
                    const req = JSON.parse(line);
                    const src = req.source ?? (req.file ? fs_1.default.readFileSync(path_1.default.resolve(req.file), 'utf8') : '');
                    if (req.action === 'diagnostics') {
                        // If file provided, use merged AST + checks; else fallback to LSP single-file diags
                        if (req.file) {
                            const file = path_1.default.resolve(req.file);
                            const ast = loadWithImports(file);
                            const policyPath = findPolicyFile(file);
                            const files = Array.from(new Set([file, ...collectImportsTransitive(file)])).map(p => ({ path: p, ast: (0, parser_1.parse)(fs_1.default.readFileSync(p, 'utf8')) }));
                            const effErrors = checkEffectsProject(files);
                            const typeReport = checkTypesProject(files);
                            const policy = policyPath && fs_1.default.existsSync(policyPath) ? JSON.parse(fs_1.default.readFileSync(policyPath, 'utf8')) : null;
                            const policyReport = policy ? checkPolicyDetailed(files, policy) : { errors: [], warnings: [] };
                            const diagnostics = [
                                ...typeReport.errors.map(m => ({ message: m })),
                                ...effErrors.map(m => ({ message: m })),
                                ...policyReport.errors.map(m => ({ message: m })),
                                ...policyReport.warnings.map(m => ({ message: `warn: ${m}` }))
                            ];
                            process.stdout.write(JSON.stringify({ ok: true, diagnostics }) + '\n');
                        }
                        else {
                            const diags = lspDiagnostics ? lspDiagnostics(src) : [];
                            process.stdout.write(JSON.stringify({ ok: true, diagnostics: diags }) + '\n');
                        }
                    }
                    else if (req.action === 'hover') {
                        const sym = String(req.symbol || '');
                        let info = {};
                        if (req.file) {
                            const file = path_1.default.resolve(req.file);
                            const ast = loadWithImports(file);
                            info = hoverInfo(ast, sym);
                        }
                        else {
                            info = lspHover ? lspHover(src, sym) : {};
                        }
                        process.stdout.write(JSON.stringify({ ok: true, hover: info }) + '\n');
                    }
                    else if (req.action === 'symbols') {
                        const file = req.file ? path_1.default.resolve(req.file) : null;
                        const ast = file ? loadWithImports(file) : (0, parser_1.parse)(src);
                        const symbols = [];
                        if (ast.kind === 'Program') {
                            let mod = null;
                            for (const d of ast.decls) {
                                if (d.kind === 'ModuleDecl') {
                                    mod = d.name;
                                    continue;
                                }
                                if (d.kind === 'EnumDecl')
                                    symbols.push({ kind: 'enum', module: mod || null, name: d.name });
                                if (d.kind === 'Fn' && d.name)
                                    symbols.push({ kind: 'function', module: mod || null, name: d.name, params: d.params, returnType: d.returnType || null, effects: Array.from(d.effects || []) });
                                if (d.kind === 'StoreDecl')
                                    symbols.push({ kind: 'store', module: mod || null, name: d.name, schema: d.schema });
                                if (d.kind === 'QueryDecl')
                                    symbols.push({ kind: 'query', module: mod || null, name: d.name, source: d.source, projection: d.projection || [] });
                            }
                        }
                        process.stdout.write(JSON.stringify({ ok: true, symbols }) + '\n');
                    }
                    else {
                        process.stdout.write(JSON.stringify({ ok: false, error: 'unknown action' }) + '\n');
                    }
                }
                catch (e) {
                    process.stdout.write(JSON.stringify({ ok: false, error: String(e) }) + '\n');
                }
            }
        });
        return;
    }
    if (cmd === 'trace') {
        const entry = resolved;
        DISABLE_CACHE = rest.includes('--no-cache');
        const ast = loadWithImports(entry);
        (0, core_ir_1.assignStableSids)(ast);
        const res = (0, runner_1.run)(ast);
        const hash = hashTrace(res.trace);
        console.log(JSON.stringify({ hash, trace: res.trace }, null, 2));
        return;
    }
    if (cmd === 'run') {
        const entry = resolved;
        DISABLE_CACHE = rest.includes('--no-cache');
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
        const mockEffects = rest.includes('--mock-effects');
        const policyPathFlagIdx = rest.indexOf('--policy');
        const policyPath = policyPathFlagIdx >= 0 ? path_1.default.resolve(rest[policyPathFlagIdx + 1]) : findPolicyFile(entry);
        const strictWarn = rest.includes('--strict-warn');
        if (policyPath && fs_1.default.existsSync(policyPath)) {
            const policy = JSON.parse(fs_1.default.readFileSync(policyPath, 'utf8'));
            const fromPolicy = (policy?.policy?.deny ?? []);
            denyList = Array.from(new Set([...denyList,
                ...fromPolicy,
            ]));
        }
        const deniedEffects = new Set(denyList);
        const runOpts = {};
        if (deniedEffects.size > 0)
            runOpts.deniedEffects = deniedEffects;
        if (mockEffects)
            runOpts.mockEffects = true;
        const res = (0, runner_1.run)(ast, Object.keys(runOpts).length ? runOpts : undefined);
        const policy = policyPath && fs_1.default.existsSync(policyPath) ? JSON.parse(fs_1.default.readFileSync(policyPath, 'utf8')) : null;
        const policyReport = policy ? checkPolicyDetailed([{ path: entry, ast }], policy) : { errors: [], warnings: [] };
        const ok = policyReport.errors.length === 0 && (!strictWarn || policyReport.warnings.length === 0);
        const out = { ok, value: res.value, trace: res.trace, policy: policyReport, deniedEffects: Array.from(deniedEffects) };
        console.log(JSON.stringify(out, null, 2));
        if (!ok)
            process.exit(2);
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
        const projectFiles = parsed.map(p => ({ path: p.path, ast: p.ast }));
        const effErrors = checkEffectsProject(projectFiles);
        const guardErrors = checkGuardPurityProject(projectFiles);
        const typeReport = checkTypesProject(parsed.map(p => ({ path: p.path, ast: p.ast })));
        const policyReport = policy ? checkPolicyDetailed(parsed.map(p => ({ path: p.path, ast: p.ast })), policy) : { errors: [], warnings: [] };
        if (json) {
            const allErrors = [...effErrors, ...guardErrors, ...policyReport.errors];
            const payload = { ok: ok && allErrors.length === 0 && (!strictWarn || policyReport.warnings.length === 0) && typeReport.errors.length === 0, files: files, errors: allErrors, policy: policyReport, types: typeReport };
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
            for (const e of [...effErrors, ...guardErrors, ...policyReport.errors]) {
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
function hoverInfo(ast, symbol) {
    const lastSeg = symbol.includes('.') ? symbol.split('.').pop() : symbol;
    const result = {};
    if (ast.kind !== 'Program')
        return result;
    // collect enums and variants
    const enums = [];
    let currentModule = null;
    for (const d of ast.decls) {
        if (d.kind === 'ModuleDecl')
            currentModule = d.name;
        if (d.kind === 'EnumDecl')
            enums.push({ name: d.name, module: currentModule || undefined, variants: d.variants });
    }
    for (const en of enums) {
        if (en.name === symbol || en.name === lastSeg)
            return { kind: 'enum', name: en.name, module: en.module, variants: en.variants };
        for (const v of en.variants)
            if (v.name === symbol || v.name === lastSeg)
                return { kind: 'constructor', name: v.name, enum: en.name, params: v.params };
    }
    // collect functions with types/effects
    const fns = [];
    currentModule = null;
    for (const d of ast.decls) {
        if (d.kind === 'ModuleDecl')
            currentModule = d.name;
        if (d.kind === 'Fn' && d.name)
            fns.push({ name: d.name, module: currentModule || undefined, params: d.params, returnType: d.returnType, effects: d.effects });
    }
    for (const fn of fns) {
        const full = fn.module ? `${fn.module}.${fn.name}` : fn.name;
        if (fn.name === symbol || full === symbol)
            return { kind: 'function', name: full, module: fn.module || null, params: fn.params, returnType: fn.returnType, effects: Array.from(fn.effects) };
    }
    // stores and queries
    currentModule = null;
    for (const d of ast.decls) {
        if (d.kind === 'ModuleDecl')
            currentModule = d.name;
        if (d.kind === 'StoreDecl') {
            const full = currentModule ? `${currentModule}.${d.name}` : d.name;
            if (d.name === symbol || full === symbol)
                return { kind: 'store', name: full, module: currentModule || null, schema: d.schema };
        }
        if (d.kind === 'QueryDecl') {
            const full = currentModule ? `${currentModule}.${d.name}` : d.name;
            if (d.name === symbol || full === symbol)
                return { kind: 'query', name: full, module: currentModule || null, source: d.source, projection: d.projection || [] };
        }
    }
    return result;
}
function hashTrace(trace) {
    let h = 2166136261 >>> 0;
    for (const ev of trace) {
        const s = `${ev.sid}:${ev.note}`;
        for (let i = 0; i < s.length; i++) {
            h ^= s.charCodeAt(i);
            h = Math.imul(h, 16777619) >>> 0;
        }
    }
    return `t:${h.toString(36)}`;
}
function hashFiles(files, policyPath) {
    let h = 2166136261 >>> 0;
    const sorted = [...files].sort();
    for (const f of sorted) {
        const s = f + '|' + require('fs').readFileSync(f, 'utf8');
        for (let i = 0; i < s.length; i++) {
            h ^= s.charCodeAt(i);
            h = Math.imul(h, 16777619) >>> 0;
        }
    }
    if (policyPath && fs_1.default.existsSync(policyPath)) {
        const ps = policyPath + '|' + fs_1.default.readFileSync(policyPath, 'utf8');
        for (let i = 0; i < ps.length; i++) {
            h ^= ps.charCodeAt(i);
            h = Math.imul(h, 16777619) >>> 0;
        }
    }
    return `p:${h.toString(36)}`;
}
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
// Guards must be pure: no EffectCall and no calls to functions with effects
function checkGuardPurityProject(files) {
    const table = new Map();
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
    function walkGuard(expr, currentFile, moduleName) {
        if (!expr || typeof expr !== 'object')
            return;
        if (expr.kind === 'EffectCall') {
            errors.push(`${currentFile}: guard must be pure (found effect ${expr.effect}.${expr.op})`);
            return;
        }
        if (expr.kind === 'Call' && expr.callee?.kind === 'Var') {
            const name = expr.callee.name;
            const candidates = name.includes('.') ? [name] : [name, ...(moduleName ? [`${moduleName}.${name}`] : [])];
            const meta = candidates.map(n => table.get(n)).find(Boolean);
            if (meta && meta.effects.size > 0) {
                errors.push(`${currentFile}: guard must be pure (function ${name} has effects: ${Array.from(meta.effects).join(', ')})`);
            }
        }
        for (const k of Object.keys(expr)) {
            const v = expr[k];
            if (v && typeof v === 'object' && 'kind' in v)
                walkGuard(v, currentFile, moduleName);
            if (Array.isArray(v))
                for (const it of v)
                    if (it && typeof it === 'object' && 'kind' in it)
                        walkGuard(it, currentFile, moduleName);
        }
    }
    for (const f of files) {
        const ast = f.ast;
        if (ast.kind !== 'Program')
            continue;
        const moduleName = getModuleName(ast);
        for (const d of ast.decls) {
            if (d.kind === 'ActorDeclNew') {
                for (const h of d.handlers)
                    if (h.guard)
                        walkGuard(h.guard, f.path, moduleName);
            }
        }
    }
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
                const p = resolveImportPath(entry, d.path);
                imports.push(p);
                imports.push(...collectImportsTransitive(p, visited));
            }
        }
    }
    return imports;
}
function loadWithImports(entry, visited = new Set()) {
    const files = Array.from(new Set([entry, ...collectImportsTransitive(entry)]));
    // simple content hash for merged program
    const policyPath = findPolicyFile(entry);
    const key = hashFiles(files, policyPath || undefined);
    const cacheDir = path_1.default.resolve(process.cwd(), '.lumen-cache');
    const cachePath = path_1.default.join(cacheDir, `${key}.json`);
    if (!DISABLE_CACHE && fs_1.default.existsSync(cachePath)) {
        try {
            return JSON.parse(fs_1.default.readFileSync(cachePath, 'utf8'));
        }
        catch { }
    }
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
    const merged = { kind: 'Program', sid: 'prog:merged', decls };
    try {
        if (!DISABLE_CACHE) {
            if (!fs_1.default.existsSync(cacheDir))
                fs_1.default.mkdirSync(cacheDir, { recursive: true });
            fs_1.default.writeFileSync(cachePath, JSON.stringify(merged), 'utf8');
        }
    }
    catch { }
    return merged;
}
function findPolicyFile(start) {
    const stat = fs_1.default.existsSync(start) ? fs_1.default.lstatSync(start) : null;
    const base = stat && stat.isDirectory() ? start : path_1.default.dirname(start);
    const p = path_1.default.join(base, 'lumen.json');
    return fs_1.default.existsSync(p) ? p : null;
}
// Override import resolution to consult lumen.pkg.json deps if present
function resolveImportPath(from, spec) {
    const baseDir = fs_1.default.lstatSync(from).isDirectory() ? from : path_1.default.dirname(from);
    if (spec.startsWith('.'))
        return path_1.default.resolve(baseDir, spec);
    const pkgPath = path_1.default.resolve(process.cwd(), 'lumen.pkg.json');
    if (fs_1.default.existsSync(pkgPath)) {
        try {
            const pkg = JSON.parse(fs_1.default.readFileSync(pkgPath, 'utf8'));
            const map = pkg?.deps || {};
            if (spec in map)
                return path_1.default.resolve(process.cwd(), map[spec]);
        }
        catch { }
    }
    return path_1.default.resolve(baseDir, spec);
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
    // ADT constructor table: CtorName -> { enumName, params: Type[] }
    const adtCtors = new Map();
    const ctorToEnum = new Map();
    const enumToVariants = new Map();
    const schemas = new Map();
    const stores = new Map();
    const enumNames = new Set();
    function parseTypeName(t) {
        if (!t)
            return 'Unknown';
        if (t === 'Int')
            return 'Int';
        if (t === 'Text')
            return 'Text';
        if (t === 'Bool')
            return 'Bool';
        if (enumNames.has(t))
            return `ADT:${t}`;
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
            if (d.kind === 'EnumDecl') {
                enumToVariants.set(d.name, d.variants.map(v => ({ name: v.name })));
                enumNames.add(d.name);
                for (const v of d.variants) {
                    const params = v.params.map(parseTypeName);
                    ctorToEnum.set(v.name, { enumName: d.name, params });
                }
            }
            if (d.kind === 'SchemaDecl')
                schemas.set(d.name, d.fields);
            if (d.kind === 'StoreDecl')
                stores.set(d.name, { schema: d.schema, path: f.path });
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
            case 'Ctor': {
                const meta = ctorToEnum.get(e.name);
                const argTypes = e.args.map(a => checkExpr(a, env, file));
                if (meta) {
                    if (meta.params.length !== argTypes.length)
                        errors.push(`${file}: constructor ${e.name} arity ${argTypes.length} but expected ${meta.params.length}`);
                    else {
                        for (let i = 0; i < meta.params.length; i++) {
                            if (meta.params[i] !== 'Unknown' && argTypes[i] !== 'Unknown' && meta.params[i] !== argTypes[i]) {
                                errors.push(`${file}: constructor ${e.name} arg ${i + 1} type ${argTypes[i]} but expected ${meta.params[i]}`);
                            }
                        }
                    }
                    return `ADT:${meta.enumName}`;
                }
                return 'Unknown';
            }
            case 'RecordLit': {
                for (const f of e.fields)
                    checkExpr(f.expr, env, file);
                return 'Unknown';
            }
            case 'TupleLit': {
                for (const el of e.elements)
                    checkExpr(el, env, file);
                return 'Unknown';
            }
            case 'Match': {
                const _t = checkExpr(e.scrutinee, env, file);
                let branchT = 'Unknown';
                // collect constructors for exhaustiveness and infer result type
                const ctors = new Set();
                let enumNameForCases = null;
                let onlyCtors = true;
                let allBranchesBaseType = null;
                for (const c of e.cases) {
                    if (c.guard)
                        checkExpr(c.guard, env, file);
                    const bt = checkExpr(c.body, env, file);
                    // infer base type consensus
                    if (bt === 'Int' || bt === 'Text' || bt === 'Bool' || bt === 'Unit') {
                        allBranchesBaseType = allBranchesBaseType === null ? bt : (allBranchesBaseType === bt ? bt : 'Unknown');
                    }
                    else if (typeof bt === 'string' && bt.startsWith('ADT:')) {
                        // track ADT result type
                        const en = bt.slice(4);
                        enumNameForCases = enumNameForCases ?? en;
                        if (enumNameForCases !== en)
                            allBranchesBaseType = 'Unknown';
                    }
                    else {
                        allBranchesBaseType = 'Unknown';
                    }
                    if (c.pattern?.kind === 'Ctor') {
                        const meta = ctorToEnum.get(c.pattern.name);
                        if (meta) {
                            ctors.add(c.pattern.name);
                            enumNameForCases = enumNameForCases ?? meta.enumName;
                            if (enumNameForCases !== meta.enumName)
                                onlyCtors = false;
                        }
                        else
                            onlyCtors = false;
                    }
                    else if (c.pattern?.kind === 'Var' && (c.pattern.name === '_' || c.pattern.name === '*')) {
                        onlyCtors = false;
                    }
                    else {
                        onlyCtors = false;
                    }
                }
                if (onlyCtors && enumNameForCases) {
                    const variants = enumToVariants.get(enumNameForCases) || [];
                    const missing = variants.map(v => v.name).filter(vn => !ctors.has(vn));
                    if (missing.length > 0)
                        errors.push(`${file}: match not exhaustive for ${enumNameForCases}; missing: ${missing.join(', ')}`);
                    branchT = `ADT:${enumNameForCases}`;
                }
                else if (allBranchesBaseType && allBranchesBaseType !== 'Unknown') {
                    branchT = allBranchesBaseType;
                }
                return branchT;
            }
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
                if (e.returnType) {
                    if (retT !== 'Unknown' && bodyT !== 'Unknown' && retT !== bodyT) {
                        // if return is ADT:Enum and body is ADT:Enum, allow if same
                        errors.push(`${file}: function ${e.name ?? '<anon>'} returns ${bodyT} but declared ${retT}`);
                    }
                    // additionally, if declared ADT, ensure body forms are constructors of that ADT (best-effort)
                    if (typeof retT === 'string' && retT.startsWith('ADT:')) {
                        const en = retT.slice(4);
                        const violates = { ok: false };
                        const verify = (expr) => {
                            if (!expr || typeof expr !== 'object')
                                return;
                            if (expr.kind === 'Ctor') {
                                const meta = ctorToEnum.get(expr.name);
                                if (!meta || meta.enumName !== en)
                                    violates.ok = true;
                                return;
                            }
                            for (const k of Object.keys(expr)) {
                                const v = expr[k];
                                if (v && typeof v === 'object' && 'kind' in v)
                                    verify(v);
                                if (Array.isArray(v))
                                    for (const it of v)
                                        if (it && typeof it === 'object' && 'kind' in it)
                                            verify(it);
                            }
                        };
                        verify(e.body);
                        if (violates.ok)
                            errors.push(`${file}: function ${e.name ?? '<anon>'} declared ${retT} but returns constructor from different enum`);
                    }
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
        for (const d of f.ast.decls) {
            if (d.kind === 'QueryDecl') {
                const store = stores.get(d.source);
                if (!store)
                    errors.push(`${f.path}: query ${d.name} references unknown store ${d.source}`);
                const schema = store ? schemas.get(store.schema) : null;
                if (!schema) {
                    if (store)
                        errors.push(`${f.path}: query ${d.name} references store ${d.source} with unknown schema ${store.schema}`);
                }
                else {
                    // validate projection fields
                    const proj = (d.projection || []);
                    for (const p of proj)
                        if (!(p in schema))
                            errors.push(`${f.path}: query ${d.name} selects unknown field ${p}`);
                    // basic predicate variable usage: allow only field names and literals/operators
                    if (d.predicate) {
                        // Build env with field types and type-check predicate
                        const env = new Map();
                        for (const [k, v] of Object.entries(schema))
                            env.set(k, parseTypeName(v));
                        const _t = checkExpr(d.predicate, env, f.path);
                    }
                }
            }
            else {
                checkExpr(d, env, f.path);
            }
        }
        // Exhaustiveness for handler-style actors when patterns are constructors of same enum
        for (const d of f.ast.decls) {
            if (d.kind === 'ActorDeclNew') {
                const ctors = new Set();
                let enumName = null;
                let onlyCtors = true;
                for (const h of d.handlers) {
                    if (h.pattern?.kind === 'Ctor') {
                        const meta = ctorToEnum.get(h.pattern.name);
                        if (meta) {
                            ctors.add(h.pattern.name);
                            enumName = enumName ?? meta.enumName;
                            if (enumName !== meta.enumName)
                                onlyCtors = false;
                        }
                        else
                            onlyCtors = false;
                    }
                    else if (h.pattern?.kind === 'Var' && (h.pattern.name === '_' || h.pattern.name === '*')) {
                        // wildcard -> treat as exhaustive
                        onlyCtors = false;
                        enumName = null;
                        break;
                    }
                    else {
                        onlyCtors = false;
                    }
                }
                if (onlyCtors && enumName) {
                    const variants = enumToVariants.get(enumName) || [];
                    const missing = variants.map(v => v.name).filter(vn => !ctors.has(vn));
                    if (missing.length > 0)
                        errors.push(`${f.path}: actor ${d.name} handlers not exhaustive for ${enumName}; missing: ${missing.join(', ')}`);
                }
            }
        }
        // Additionally, validate that router handlers' reply annotations (if any) are consistent with body types (basic)
        for (const d of f.ast.decls) {
            if (d.kind === 'ActorDeclNew') {
                for (const h of d.handlers) {
                    if (h.replyType) {
                        const envLocal = new Map();
                        const bt = checkExpr(h.body, envLocal, f.path);
                        const rt = parseTypeName(h.replyType);
                        if (rt !== 'Unknown' && bt !== 'Unknown' && rt !== bt) {
                            errors.push(`${f.path}: actor ${d.name} handler reply type ${h.replyType} mismatches body type ${bt}`);
                        }
                    }
                }
            }
        }
    }
    function validatePredicateUses(expr, schema) {
        let ok = true;
        const visit = (e) => {
            if (!e || typeof e !== 'object')
                return;
            if (e.kind === 'Var') {
                if (!(e.name in schema))
                    ok = false;
                return;
            }
            for (const k of Object.keys(e)) {
                const v = e[k];
                if (v && typeof v === 'object' && 'kind' in v)
                    visit(v);
                if (Array.isArray(v))
                    for (const it of v)
                        if (it && typeof it === 'object' && 'kind' in it)
                            visit(it);
            }
        };
        visit(expr);
        return ok;
    }
    return { errors };
}
