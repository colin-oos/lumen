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
    serve                  Start simple LSP-like server on stdin/stdout (newline-delited JSON)
    test <path>            Run spec blocks in file or directory
    defs <file> <symbol>   Get definition location
`);
}
async function main() {
    let [, , cmd, maybeTarget, ...rest] = process.argv;
    if (!cmd) {
        usage();
        process.exit(1);
    }
    // Allow flags before the path, e.g., `fmt --write .`
    let target = maybeTarget;
    const allArgs = [maybeTarget, ...rest].filter(Boolean);
    const write = allArgs.includes('--write');
    const recursive = allArgs.includes('--recursive');
    if (!target || target.startsWith('-')) {
        const nonFlag = rest.find(a => a && !a.startsWith('-'));
        if (nonFlag) {
            const idx = rest.indexOf(nonFlag);
            if (idx !== -1)
                rest.splice(idx, 1);
            target = nonFlag;
        }
    }
    if (!target) {
        if (cmd === 'serve' || cmd === 'cache' || cmd === 'fmt' || cmd === 'check' || cmd === 'test')
            target = '.';
        else {
            usage();
            process.exit(1);
        }
    }
    const resolved = path_1.default.resolve(target);
    const isDir = fs_1.default.existsSync(resolved) && fs_1.default.lstatSync(resolved).isDirectory();
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
    if (cmd === 'emit') {
        const entry = resolved;
        const ast = loadWithImports(entry);
        if (rest.includes('--ts')) {
            const out = emitTypes(ast);
            console.log(out);
            return;
        }
        console.log('usage: lumen emit <file> --ts');
        return;
    }
    if (cmd === 'apply') {
        // Apply a simple EditScript by SID across .lum files recursively from CWD
        const jsonPath = resolved;
        if (!fs_1.default.existsSync(jsonPath)) {
            console.error('apply: JSON file not found');
            process.exit(1);
        }
        const spec = JSON.parse(fs_1.default.readFileSync(jsonPath, 'utf8'));
        if (!spec || !spec.targetSid || typeof spec.newBody !== 'string') {
            console.error('apply: invalid spec (expected { targetSid, newBody })');
            process.exit(1);
        }
        const files = collectLumFiles(process.cwd(), true);
        let applied = false;
        for (const f of files) {
            const src = fs_1.default.readFileSync(f, 'utf8');
            const ast = (0, parser_1.parse)(src);
            (0, core_ir_1.assignStableSids)(ast);
            let changed = false;
            function rewrite(e) {
                if (!e || typeof e !== 'object')
                    return;
                if (e.kind === 'Fn' && e.sid === spec.targetSid) {
                    e.body = (0, parser_1.parse)(spec.newBody);
                    (0, core_ir_1.assignStableSids)(e.body);
                    changed = true;
                }
                for (const k of Object.keys(e)) {
                    const v = e[k];
                    if (v && typeof v === 'object' && 'kind' in v)
                        rewrite(v);
                    if (Array.isArray(v))
                        for (const it of v)
                            if (it && typeof it === 'object' && 'kind' in it)
                                rewrite(it);
                }
            }
            rewrite(ast);
            if (changed) {
                const out = (0, fmt_1.format)(ast);
                fs_1.default.writeFileSync(f, out, 'utf8');
                applied = true;
                break;
            }
        }
        if (!applied) {
            console.error('apply: targetSid not found');
            process.exit(2);
        }
        console.log('apply OK');
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
    if (cmd === 'defs') {
        const file = resolved;
        const symbol = rest[0];
        if (!symbol) {
            console.error('usage: lumen defs <file> <symbol>');
            process.exit(1);
        }
        const def = getDefinitionFromProject(file, symbol);
        console.log(JSON.stringify(def, null, 2));
        return;
    }
    if (cmd === 'serve') {
        // Simple newline-delimited JSON protocol
        // Request: { action: 'hover'|'diagnostics'|'symbols'|'definitions', file?: string, source?: string, symbol?: string }
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
                            const files = Array.from(new Set([file, ...collectImportsTransitive(file)])).map(p => ({ path: p, ast: (0, parser_1.parse)(fs_1.default.readFileSync(p, 'utf8')) }));
                            const effErrors = checkEffectsProject(files);
                            const typeReport = checkTypesProject(files);
                            const policyPath = findPolicyFile(file);
                            const policy = policyPath && fs_1.default.existsSync(policyPath) ? JSON.parse(fs_1.default.readFileSync(policyPath, 'utf8')) : null;
                            const policyReport = policy ? checkPolicyDetailed(files, policy) : { errors: [], warnings: [] };
                            const diagnostics = {
                                types: { errors: typeReport.errors, diags: typeReport.diags },
                                effects: { errors: effErrors },
                                policy: { errors: policyReport.errors, warnings: policyReport.warnings },
                                counts: { errors: typeReport.errors.length + effErrors.length + policyReport.errors.length, warnings: policyReport.warnings.length }
                            };
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
                    else if (req.action === 'definitions' || req.action === 'definition' || req.action === 'defs') {
                        const file = req.file ? path_1.default.resolve(req.file) : null;
                        const sym = String(req.symbol || '');
                        const def = file ? getDefinitionFromProject(file, sym) : {};
                        process.stdout.write(JSON.stringify({ ok: true, definition: def }) + '\n');
                    }
                    else if (req.action === 'references') {
                        const sym = String(req.symbol || '');
                        const refs = (lspHover && require('@lumen/lsp').getReferences) ? require('@lumen/lsp').getReferences(src, sym) : [];
                        process.stdout.write(JSON.stringify({ ok: true, references: refs }) + '\n');
                    }
                    else if (req.action === 'completions') {
                        const prefix = String(req.prefix || '');
                        const comps = (lspHover && require('@lumen/lsp').getCompletions) ? require('@lumen/lsp').getCompletions(prefix) : [];
                        process.stdout.write(JSON.stringify({ ok: true, completions: comps }) + '\n');
                    }
                    else if (req.action === 'rename') {
                        const oldName = String(req.oldName || '');
                        const newName = String(req.newName || '');
                        let renameFn = null;
                        try {
                            renameFn = require('@lumen/lsp').rename;
                        }
                        catch { }
                        if (!renameFn) {
                            try {
                                renameFn = require('../lsp/dist/index.js').rename;
                            }
                            catch { }
                        }
                        if (!renameFn) {
                            // fallback simple textual rename
                            const lines = src.split(/\n/);
                            const edits = [];
                            for (let i = 0; i < lines.length; i++) {
                                const idx = lines[i].indexOf(oldName);
                                if (idx >= 0)
                                    edits.push({ line: i + 1, column: idx + 1, length: oldName.length });
                            }
                            const newSource = src.replace(new RegExp(oldName, 'g'), newName);
                            process.stdout.write(JSON.stringify({ ok: true, rename: { edits, newSource } }) + '\n');
                        }
                        else {
                            const rn = renameFn(src, oldName, newName);
                            process.stdout.write(JSON.stringify({ ok: true, rename: rn }) + '\n');
                        }
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
        const schedIdx = rest.indexOf('--scheduler-seed');
        const schedulerSeed = schedIdx >= 0 ? String(rest[schedIdx + 1] || '') : undefined;
        const res = (0, runner_1.run)(ast, schedulerSeed ? { schedulerSeed } : undefined);
        const seedIdx = rest.indexOf('--seed');
        const seed = seedIdx >= 0 ? String(rest[seedIdx + 1] || '') : '';
        const hash = hashTrace(res.trace, seed);
        const expectFlagIdx = rest.indexOf('--expect');
        let expectHash = null;
        if (expectFlagIdx >= 0)
            expectHash = rest[expectFlagIdx + 1] || null;
        const hashOnly = rest.includes('--hash-only');
        if (hashOnly)
            console.log(hash);
        else
            console.log(JSON.stringify({ hash, trace: res.trace }, null, 2));
        if (expectHash && expectHash !== hash)
            process.exit(3);
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
        const schedIdx = rest.indexOf('--scheduler-seed');
        const schedulerSeed = schedIdx >= 0 ? String(rest[schedIdx + 1] || '') : undefined;
        if (policyPath && fs_1.default.existsSync(policyPath)) {
            const policy = JSON.parse(fs_1.default.readFileSync(policyPath, 'utf8'));
            const fromPolicy = (policy?.policy?.deny ?? []);
            denyList = Array.from(new Set([
                ...denyList,
                ...fromPolicy,
            ]));
        }
        const deniedEffects = new Set(denyList);
        const runOpts = {};
        if (deniedEffects.size > 0)
            runOpts.deniedEffects = deniedEffects;
        if (mockEffects)
            runOpts.mockEffects = true;
        if (schedulerSeed)
            runOpts.schedulerSeed = schedulerSeed;
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
        const sidSnapIdx = rest.indexOf('--sid-snapshot');
        if (sidSnapIdx >= 0) {
            const snapPath = rest[sidSnapIdx + 1] ? path_1.default.resolve(rest[sidSnapIdx + 1]) : process.cwd();
            const files = fs_1.default.lstatSync(snapPath).isDirectory() ? collectLumFiles(snapPath, true) : [snapPath];
            const nodes = [];
            for (const f of files) {
                const src = fs_1.default.readFileSync(f, 'utf8');
                const ast = (0, parser_1.parse)(src);
                (0, core_ir_1.assignStableSids)(ast);
                function collect(e) {
                    if (!e || typeof e !== 'object')
                        return;
                    // collect SIDs for top-level decls
                    if (e.kind === 'Fn' || e.kind === 'ActorDecl' || e.kind === 'ActorDeclNew' || e.kind === 'EnumDecl' || e.kind === 'QueryDecl' || e.kind === 'StoreDecl' || e.kind === 'SchemaDecl') {
                        nodes.push({ sid: e.sid, kind: e.kind, name: e.name ?? undefined, file: f });
                    }
                    for (const k of Object.keys(e)) {
                        const v = e[k];
                        if (v && typeof v === 'object' && 'kind' in v)
                            collect(v);
                        if (Array.isArray(v))
                            for (const it of v)
                                if (it && typeof it === 'object' && 'kind' in it)
                                    collect(it);
                    }
                }
                collect(ast);
            }
            console.log(JSON.stringify({ nodes }, null, 2));
            return;
        }
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
            const payload = { ok: ok && allErrors.length === 0 && (!strictWarn || policyReport.warnings.length === 0) && typeReport.errors.length === 0, files: files, errors: allErrors, policy: policyReport, types: { errors: typeReport.errors, diags: typeReport.diags } };
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
    if (cmd === 'test') {
        const files = isDir ? collectLumFiles(resolved, true) : [resolved];
        const results = [];
        for (const f of files) {
            const src = fs_1.default.readFileSync(f, 'utf8');
            const ast = (0, parser_1.parse)(src);
            (0, core_ir_1.assignStableSids)(ast);
            if (ast.kind !== 'Program')
                continue;
            for (const d of ast.decls) {
                if (d.kind === 'SpecDecl') {
                    const failures = [];
                    for (const a of (d.asserts || [])) {
                        try {
                            const exprAst = { kind: 'Program', sid: 'prog:inline', decls: [a.expr] };
                            const out = (0, runner_1.run)(exprAst);
                            const pass = Boolean(out.value);
                            if (!pass)
                                failures.push(a.message || 'assert failed');
                        }
                        catch (e) {
                            failures.push(a.message || String(e));
                        }
                    }
                    results.push({ file: f, name: d.name, ok: failures.length === 0, failures });
                }
            }
        }
        const ok = results.every(r => r.ok);
        console.log(JSON.stringify({ ok, results }, null, 2));
        if (!ok)
            process.exit(5);
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
function emitTypes(ast) {
    if (ast.kind !== 'Program')
        return '';
    const lines = [];
    const enumToCtors = new Map();
    const ctorToEnum = new Map();
    const schemaMap = new Map();
    const storeToSchema = new Map();
    function tsType(t) {
        if (!t)
            return 'unknown';
        if (t === 'Int')
            return 'number';
        if (t === 'Text')
            return 'string';
        if (t === 'Bool')
            return 'boolean';
        if (t === 'Unit')
            return 'null';
        return 'unknown';
    }
    function inferParamTypes(fn) {
        const names = (fn.params || []).map((p) => p.name);
        const inferred = Object.fromEntries(names.map((n) => [n, null]));
        function walk(e) {
            if (!e || typeof e !== 'object')
                return;
            if (e.kind === 'Binary') {
                if (e.left?.kind === 'Var' && names.includes(e.left.name))
                    inferred[e.left.name] = inferred[e.left.name] || 'Int';
                if (e.right?.kind === 'Var' && names.includes(e.right.name))
                    inferred[e.right.name] = inferred[e.right.name] || 'Int';
            }
            for (const k of Object.keys(e)) {
                const v = e[k];
                if (v && typeof v === 'object' && 'kind' in v)
                    walk(v);
                if (Array.isArray(v))
                    for (const it of v)
                        if (it && typeof it === 'object' && 'kind' in it)
                            walk(it);
            }
        }
        walk(fn.body);
        return names.map((n) => inferred[n]);
    }
    for (const d of ast.decls) {
        if (d.kind === 'EnumDecl') {
            enumToCtors.set(d.name, d.variants);
            for (const v of d.variants)
                ctorToEnum.set(v.name, { enumName: d.name, params: v.params || [] });
        }
        if (d.kind === 'SchemaDecl')
            schemaMap.set(d.name, d.fields);
        if (d.kind === 'StoreDecl')
            storeToSchema.set(d.name, d.schema);
    }
    for (const [name, variants] of enumToCtors) {
        const parts = variants.map(v => `{ $: '${v.name}', values: [${(v.params || []).map(tsType).join(', ')}] }`);
        lines.push(`type ${name} = ${parts.join(' | ')}`);
    }
    for (const [name, fields] of schemaMap) {
        const body = Object.entries(fields).map(([k, v]) => `  ${k}: ${tsType(v)}`).join('\n');
        lines.push(`interface ${name} {\n${body}\n}`);
    }
    for (const d of ast.decls) {
        if (d.kind === 'QueryDecl') {
            const srcSchemaName = storeToSchema.get(d.source);
            if (!srcSchemaName)
                continue;
            const proj = d.projection || [];
            if (proj.length > 0) {
                const keys = proj.map((p) => `'${p}'`).join(' | ');
                lines.push(`type ${d.name} = Array<Pick<${srcSchemaName}, ${keys}>>`);
            }
            else {
                lines.push(`type ${d.name} = Array<${srcSchemaName}>`);
            }
        }
        if (d.kind === 'ActorDeclNew') {
            const actorName = d.name;
            const ctorNames = new Set();
            const enumNames = new Set();
            for (const h of d.handlers) {
                if (h.pattern && h.pattern.kind === 'Ctor') {
                    ctorNames.add(h.pattern.name);
                    const meta = ctorToEnum.get(h.pattern.name);
                    if (meta)
                        enumNames.add(meta.enumName);
                }
            }
            if (ctorNames.size > 0) {
                if (enumNames.size === 1) {
                    const en = Array.from(enumNames)[0];
                    lines.push(`type ${actorName}Msg = ${en}`);
                }
                else {
                    const parts = [];
                    for (const cn of ctorNames) {
                        const meta = ctorToEnum.get(cn);
                        const params = meta ? meta.params : [];
                        parts.push(`{ $: '${cn}', values: [${params.map(tsType).join(', ')}] }`);
                    }
                    lines.push(`type ${actorName}Msg = ${parts.join(' | ')}`);
                }
            }
        }
        if (d.kind === 'Fn' && d.name) {
            const name = d.name;
            const inferred = inferParamTypes(d);
            const params = (d.params || []).map((p, i) => tsType(p.type) !== 'unknown' ? tsType(p.type) : (inferred[i] ? tsType(inferred[i]) : 'unknown')).join(', ');
            const ret = tsType(d.returnType);
            lines.push(`type ${name}Fn = (${params}) => ${ret}`);
        }
    }
    return lines.join('\n\n') + '\n';
}
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
function hashTrace(trace, seed = '') {
    let h = 2166136261 >>> 0;
    // incorporate seed
    for (let i = 0; i < seed.length; i++) {
        h ^= seed.charCodeAt(i);
        h = Math.imul(h, 16777619) >>> 0;
    }
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
    const keysA = Object.keys(a).filter(k => k !== 'sid' && k !== 'span');
    const keysB = Object.keys(b).filter(k => k !== 'sid' && k !== 'span');
    const keySet = new Set([...keysA, ...keysB]);
    for (const k of keySet) {
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
function getDefinitionFromProject(entryFile, symbol) {
    const base = path_1.default.resolve(entryFile);
    const files = Array.from(new Set([base, ...collectImportsTransitive(base)]));
    const defs = [];
    for (const f of files) {
        const src = fs_1.default.readFileSync(f, 'utf8');
        const ast = (0, parser_1.parse)(src);
        if (ast.kind !== 'Program')
            continue;
        let mod = null;
        for (const d of ast.decls) {
            if (d.kind === 'ModuleDecl') {
                mod = d.name;
                continue;
            }
            const make = (kind, name) => defs.push({ kind, name: mod ? `${mod}.${name}` : name, file: f, line: d.span?.line });
            if (d.kind === 'EnumDecl')
                make('enum', d.name);
            if (d.kind === 'Fn' && d.name)
                make('function', d.name);
            if (d.kind === 'StoreDecl')
                make('store', d.name);
            if (d.kind === 'QueryDecl')
                make('query', d.name);
            if (d.kind === 'ActorDecl' || d.kind === 'ActorDeclNew')
                make('actor', d.name);
        }
    }
    const lastSeg = symbol.includes('.') ? symbol.split('.').pop() : symbol;
    const match = defs.find(d => d.name === symbol || d.name.endsWith('.' + lastSeg));
    if (!match)
        return {};
    return { kind: match.kind, name: match.name, file: match.file, line: match.line };
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
        if (e.kind === 'LitFloat')
            return 'Float';
        if (e.kind === 'LitText')
            return 'Text';
        if (e.kind === 'LitBool')
            return 'Bool';
        return 'Unknown';
    }
    const errors = [];
    const diags = [];
    const fnSigs = new Map();
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
        if (t === 'Float')
            return 'Float';
        if (t === 'Text')
            return 'Text';
        if (t === 'Bool')
            return 'Bool';
        if (t === 'Unit')
            return 'Unit';
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
    function push(file, line, message) {
        errors.push(`${file}: ${message}`);
        diags.push({ file, line, message });
    }
    function checkExpr(e, env, file, line) {
        switch (e.kind) {
            case 'LitNum':
            case 'LitFloat':
            case 'LitText':
            case 'LitBool':
                return typeOfLiteral(e);
            case 'Var':
                return env.get(e.name) ?? 'Unknown';
            case 'Ctor': {
                const meta = ctorToEnum.get(e.name);
                const argTypes = e.args.map(a => checkExpr(a, env, file, line));
                if (meta) {
                    if (meta.params.length !== argTypes.length)
                        push(file, line, `constructor ${e.name} arity ${argTypes.length} but expected ${meta.params.length}`);
                    else {
                        for (let i = 0; i < meta.params.length; i++) {
                            if (meta.params[i] !== 'Unknown' && argTypes[i] !== 'Unknown' && meta.params[i] !== argTypes[i])
                                push(file, line, `constructor ${e.name} arg ${i + 1} type ${argTypes[i]} but expected ${meta.params[i]}`);
                        }
                    }
                    return `ADT:${meta.enumName}`;
                }
                return 'Unknown';
            }
            case 'RecordLit': {
                for (const f of e.fields)
                    checkExpr(f.expr, env, file, line);
                return 'Unknown';
            }
            case 'TupleLit': {
                for (const el of e.elements)
                    checkExpr(el, env, file, line);
                return 'Unknown';
            }
            case 'SetLit': {
                for (const el of e.elements)
                    checkExpr(el, env, file, line);
                return 'Unknown';
            }
            case 'MapLit': {
                for (const en of e.entries) {
                    checkExpr(en.key, env, file, line);
                    checkExpr(en.value, env, file, line);
                }
                return 'Unknown';
            }
            case 'Match': {
                const _t = checkExpr(e.scrutinee, env, file, line);
                let branchT = 'Unknown';
                const ctors = new Set();
                let enumNameForCases = null;
                let onlyCtors = true;
                let allBranchesBaseType = null;
                for (const c of e.cases) {
                    if (c.guard)
                        checkExpr(c.guard, env, file, line);
                    const bt = checkExpr(c.body, env, file, line);
                    if (bt === 'Int' || bt === 'Float' || bt === 'Text' || bt === 'Bool' || bt === 'Unit') {
                        allBranchesBaseType = allBranchesBaseType === null ? bt : (allBranchesBaseType === bt ? bt : 'Unknown');
                    }
                    else if (typeof bt === 'string' && bt.startsWith('ADT:')) {
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
                    else if (c.pattern?.kind === 'PatternOr') {
                        const left = c.pattern.left;
                        const right = c.pattern.right;
                        if (left?.kind === 'Ctor' && right?.kind === 'Ctor') {
                            const ml = ctorToEnum.get(left.name);
                            const mr = ctorToEnum.get(right.name);
                            if (ml && mr && ml.enumName === mr.enumName) {
                                ctors.add(left.name);
                                ctors.add(right.name);
                                enumNameForCases = enumNameForCases ?? ml.enumName;
                            }
                            else
                                onlyCtors = false;
                        }
                        else
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
                        push(file, line, `match not exhaustive for ${enumNameForCases}; missing: ${missing.join(', ')}`);
                    branchT = `ADT:${enumNameForCases}`;
                }
                else if (allBranchesBaseType && allBranchesBaseType !== 'Unknown') {
                    branchT = allBranchesBaseType;
                }
                return branchT;
            }
            case 'Let': {
                const t = checkExpr(e.expr, env, file, e.span?.line);
                const declT = parseTypeName(e.type);
                if (e.type && declT !== 'Unknown' && t !== 'Unknown' && declT !== t)
                    push(file, e.span?.line, `type mismatch in let ${e.name}: declared ${declT} but got ${t}`);
                env.set(e.name, declT !== 'Unknown' ? declT : t);
                return env.get(e.name) ?? 'Unknown';
            }
            case 'Unary': {
                const t = checkExpr(e.expr, env, file, line);
                if (e.op === 'not') {
                    if (t !== 'Bool' && t !== 'Unknown')
                        push(file, line, `unary not expects Bool, got ${t}`);
                    return 'Bool';
                }
                if (e.op === 'neg') {
                    if ((t !== 'Int' && t !== 'Float') && t !== 'Unknown')
                        push(file, line, `unary - expects numeric, got ${t}`);
                    return t;
                }
                return 'Unknown';
            }
            case 'Binary': {
                const lt = checkExpr(e.left, env, file, line);
                const rt = checkExpr(e.right, env, file, line);
                const numericOps = ['+', '-', '*', '/', '%'];
                const cmpOps = ['==', '!=', '<', '<=', '>', '>='];
                const boolOps = ['and', 'or'];
                if (numericOps.includes(e.op)) {
                    if ((lt !== 'Int' && lt !== 'Float') || (rt !== 'Int' && rt !== 'Float')) {
                        if (lt !== 'Unknown' && rt !== 'Unknown')
                            push(file, line, `binary ${e.op} expects numeric, got ${lt} and ${rt}`);
                    }
                    return (lt === 'Float' || rt === 'Float') ? 'Float' : 'Int';
                }
                if (cmpOps.includes(e.op)) {
                    if (lt !== rt && lt !== 'Unknown' && rt !== 'Unknown') {
                        if (!((lt === 'Int' && rt === 'Float') || (lt === 'Float' && rt === 'Int')))
                            push(file, line, `comparison ${e.op} between ${lt} and ${rt}`);
                    }
                    return 'Bool';
                }
                if (boolOps.includes(e.op)) {
                    if ((lt !== 'Bool' || rt !== 'Bool') && (lt !== 'Unknown' && rt !== 'Unknown'))
                        push(file, line, `boolean ${e.op} expects Bool, got ${lt} and ${rt}`);
                    return 'Bool';
                }
                return 'Unknown';
            }
            case 'EffectCall': {
                const rt = effectReturnType(e.effect, e.op);
                for (const a of e.args)
                    checkExpr(a, env, file, line);
                return rt;
            }
            case 'Call': {
                const name = e.callee.kind === 'Var' ? e.callee.name : '';
                const candidates = name.includes('.') ? [name] : [name, ...files.map(f => getModuleName(f.ast)).filter(Boolean).map(m => `${m}.${name}`)];
                const sig = candidates.map(n => fnSigs.get(n)).find(Boolean);
                const argTypes = e.args.map((a) => checkExpr(a, env, file, line));
                if (sig) {
                    if (sig.params.length !== argTypes.length)
                        push(file, line, `call ${name} arity ${argTypes.length} but expected ${sig.params.length}`);
                    else {
                        for (let i = 0; i < sig.params.length; i++) {
                            if (sig.params[i] !== 'Unknown' && argTypes[i] !== 'Unknown' && sig.params[i] !== argTypes[i])
                                push(file, line, `call ${name} arg ${i + 1} type ${argTypes[i]} but expected ${sig.params[i]}`);
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
                    last = checkExpr(s, local, file, line);
                return last;
            }
            case 'If': {
                const ct = checkExpr(e.cond, env, file, line);
                if (ct !== 'Bool' && ct !== 'Unknown')
                    push(file, line, `if condition must be Bool, got ${ct}`);
                const tt = checkExpr(e.then, env, file, line);
                const et = checkExpr(e.else, env, file, line);
                if (tt === et)
                    return tt;
                if ((tt === 'Int' && et === 'Float') || (tt === 'Float' && et === 'Int'))
                    return 'Float';
                return 'Unknown';
            }
            case 'Fn': {
                const local = new Map(env);
                for (const p of e.params)
                    local.set(p.name, parseTypeName(p.type));
                const bodyT = checkExpr(e.body, local, file, e.span?.line);
                const retT = parseTypeName(e.returnType);
                if (e.returnType) {
                    if (retT !== 'Unknown' && bodyT !== 'Unknown' && retT !== bodyT)
                        push(file, e.span?.line, `function ${e.name ?? '<anon>'} returns ${bodyT} but declared ${retT}`);
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
                            push(file, e.span?.line, `function ${e.name ?? '<anon>'} declared ${retT} but returns constructor from different enum`);
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
                    push(f.path, d.span?.line, `query ${d.name} references unknown store ${d.source}`);
                const schema = store ? schemas.get(store.schema) : null;
                if (!schema) {
                    if (store)
                        push(f.path, d.span?.line, `query ${d.name} references store ${d.source} with unknown schema ${store.schema}`);
                }
                else {
                    const proj = (d.projection || []);
                    for (const p of proj)
                        if (!(p in schema))
                            push(f.path, d.span?.line, `query ${d.name} selects unknown field ${p}`);
                    if (d.predicate) {
                        const envPred = new Map();
                        for (const [k, v] of Object.entries(schema))
                            envPred.set(k, parseTypeName(v));
                        const _t = checkExpr(d.predicate, envPred, f.path, d.span?.line);
                    }
                }
            }
            else {
                checkExpr(d, env, f.path, d.span?.line);
            }
        }
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
                        onlyCtors = false;
                        enumName = null;
                        break;
                    }
                    else if (h.pattern?.kind === 'PatternOr') {
                        const left = h.pattern.left, right = h.pattern.right;
                        if (left?.kind === 'Ctor' && right?.kind === 'Ctor') {
                            const ml = ctorToEnum.get(left.name);
                            const mr = ctorToEnum.get(right.name);
                            if (ml && mr && ml.enumName === mr.enumName) {
                                ctors.add(left.name);
                                ctors.add(right.name);
                            }
                            else
                                onlyCtors = false;
                        }
                        else
                            onlyCtors = false;
                    }
                    else {
                        onlyCtors = false;
                    }
                }
                if (onlyCtors && enumName) {
                    const variants = enumToVariants.get(enumName) || [];
                    const missing = variants.map(v => v.name).filter(vn => !ctors.has(vn));
                    if (missing.length > 0)
                        push(files.find(ff => ff.ast === d)?.path || '', d.span?.line, `actor ${d.name} handlers not exhaustive for ${enumName}; missing: ${missing.join(', ')}`);
                }
            }
        }
        for (const d of f.ast.decls) {
            if (d.kind === 'ActorDeclNew') {
                for (const h of d.handlers) {
                    if (h.replyType) {
                        const envLocal = new Map();
                        const bt = checkExpr(h.body, envLocal, f.path, d.span?.line);
                        const rt = parseTypeName(h.replyType);
                        if (rt !== 'Unknown' && bt !== 'Unknown' && rt !== bt)
                            push(f.path, d.span?.line, `actor ${d.name} handler reply type ${h.replyType} mismatches body type ${bt}`);
                    }
                }
            }
        }
    }
    return { errors, diags };
}
