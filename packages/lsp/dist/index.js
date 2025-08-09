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
                case 'LitFloat': return 'Float';
                case 'LitText': return 'Text';
                case 'LitBool': return 'Bool';
                case 'Var': return env.get(e.name) ?? 'Unknown';
                case 'Ctor': {
                    const meta = ctorToEnum.get(e.name);
                    if (!meta)
                        return 'Unknown';
                    return `ADT:${meta.enumName}`;
                }
                case 'Unary': {
                    const t = checkExpr(e.expr, env);
                    if (e.op === 'not') {
                        if (t !== 'Bool' && t !== 'Unknown')
                            errors.push(`unary not expects Bool, got ${t}`);
                        return 'Bool';
                    }
                    if (e.op === 'neg') {
                        if ((t !== 'Int' && t !== 'Float') && t !== 'Unknown')
                            errors.push(`unary - expects numeric, got ${t}`);
                        return t;
                    }
                    return 'Unknown';
                }
                case 'Binary': {
                    const lt = checkExpr(e.left, env);
                    const rt = checkExpr(e.right, env);
                    const numericOps = ['+', '-', '*', '/', '%'];
                    const cmpOps = ['==', '!=', '<', '<=', '>', '>='];
                    const boolOps = ['and', 'or'];
                    if (numericOps.includes(e.op)) {
                        if ((lt !== 'Int' && lt !== 'Float') || (rt !== 'Int' && rt !== 'Float')) {
                            if (lt !== 'Unknown' && rt !== 'Unknown')
                                errors.push(`binary ${e.op} expects numeric, got ${lt} and ${rt}`);
                        }
                        return (lt === 'Float' || rt === 'Float') ? 'Float' : 'Int';
                    }
                    if (cmpOps.includes(e.op)) {
                        if (lt !== rt && lt !== 'Unknown' && rt !== 'Unknown') {
                            if (!((lt === 'Int' && rt === 'Float') || (lt === 'Float' && rt === 'Int')))
                                errors.push(`comparison ${e.op} between ${lt} and ${rt}`);
                        }
                        return 'Bool';
                    }
                    if (boolOps.includes(e.op)) {
                        if ((lt !== 'Bool' || rt !== 'Bool') && (lt !== 'Unknown' && rt !== 'Unknown'))
                            errors.push(`boolean ${e.op} expects Bool, got ${lt} and ${rt}`);
                        return 'Bool';
                    }
                    return 'Unknown';
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
                        if (bt === 'Int' || bt === 'Float' || bt === 'Text' || bt === 'Bool' || bt === 'Unit')
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
                case 'If': {
                    const ct = checkExpr(e.cond, env);
                    if (ct !== 'Bool' && ct !== 'Unknown')
                        errors.push(`if condition must be Bool, got ${ct}`);
                    const tt = checkExpr(e.then, env);
                    const et = checkExpr(e.else, env);
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
