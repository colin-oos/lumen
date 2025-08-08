"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getDiagnostics = getDiagnostics;
exports.getHover = getHover;
const parser_1 = require("@lumen/parser");
function getDiagnostics(source) {
    const ast = (0, parser_1.parse)(source);
    const errors = [];
    const enumNames = new Set();
    const ctorToEnum = new Map();
    const enumToVariants = new Map();
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
    if (ast.kind === 'Program') {
        for (const d of ast.decls) {
            if (d.kind === 'EnumDecl') {
                enumNames.add(d.name);
                enumToVariants.set(d.name, d.variants.map(v => ({ name: v.name })));
                for (const v of d.variants)
                    ctorToEnum.set(v.name, { enumName: d.name, params: v.params.map(parseTypeName) });
            }
        }
        function checkExpr(e, env) {
            switch (e.kind) {
                case 'LitNum': return 'Int';
                case 'LitText': return 'Text';
                case 'LitBool': return 'Bool';
                case 'Var': return env.get(e.name) ?? 'Unknown';
                case 'Ctor': {
                    const meta = ctorToEnum.get(e.name);
                    if (!meta)
                        return 'Unknown';
                    return `ADT:${meta.enumName}`;
                }
                case 'Binary': {
                    const lt = checkExpr(e.left, env);
                    const rt = checkExpr(e.right, env);
                    if ((lt !== 'Int' || rt !== 'Int') && (lt !== 'Unknown' && rt !== 'Unknown'))
                        errors.push(`binary ${e.op} expects Int, got ${lt} and ${rt}`);
                    return 'Int';
                }
                case 'Let': {
                    const t = checkExpr(e.expr, env);
                    const declT = parseTypeName(e.type);
                    if (e.type && declT !== 'Unknown' && t !== 'Unknown' && declT !== t)
                        errors.push(`type mismatch in let ${e.name}: declared ${declT} but got ${t}`);
                    env.set(e.name, declT !== 'Unknown' ? declT : t);
                    return env.get(e.name) ?? 'Unknown';
                }
                case 'Match': {
                    let enumName = null;
                    let baseType = null;
                    for (const c of e.cases) {
                        const bt = checkExpr(c.body, env);
                        if (bt === 'Int' || bt === 'Text' || bt === 'Bool' || bt === 'Unit')
                            baseType = baseType === null ? bt : (baseType === bt ? bt : 'Unknown');
                        else if (typeof bt === 'string' && bt.startsWith('ADT:'))
                            enumName = enumName ?? bt.slice(4);
                    }
                    if (enumName)
                        return `ADT:${enumName}`;
                    if (baseType && baseType !== 'Unknown')
                        return baseType;
                    return 'Unknown';
                }
                case 'Fn': {
                    const local = new Map(env);
                    for (const p of e.params)
                        local.set(p.name, parseTypeName(p.type));
                    const bodyT = checkExpr(e.body, local);
                    const retT = parseTypeName(e.returnType);
                    if (e.returnType && retT !== 'Unknown' && bodyT !== 'Unknown' && retT !== bodyT)
                        errors.push(`function ${e.name ?? '<anon>'} returns ${bodyT} but declared ${retT}`);
                    return 'Unknown';
                }
                default: return 'Unknown';
            }
        }
        const env = new Map();
        for (const d of ast.decls)
            checkExpr(d, env);
    }
    return errors.map(message => ({ message }));
}
function getHover(source, symbol) {
    const ast = (0, parser_1.parse)(source);
    const lastSeg = symbol.includes('.') ? symbol.split('.').pop() : symbol;
    const result = {};
    if (ast.kind !== 'Program')
        return result;
    const enums = [];
    let currentModule = null;
    for (const d of ast.decls) {
        if (d.kind === 'ModuleDecl')
            currentModule = d.name;
        if (d.kind === 'EnumDecl')
            enums.push({ name: d.name, variants: d.variants });
    }
    for (const en of enums) {
        if (en.name === symbol || en.name === lastSeg)
            return { kind: 'enum', name: en.name, module: currentModule || undefined };
        for (const v of en.variants)
            if (v.name === symbol || v.name === lastSeg)
                return { kind: 'constructor', name: v.name, enum: en.name, params: v.params };
    }
    return result;
}
