"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getDiagnostics = getDiagnostics;
exports.getHover = getHover;
const parser_1 = require("@lumen/parser");
function getDiagnostics(source) {
    try {
        const ast = (0, parser_1.parse)(source);
        // For now, parser errors would throw in future; return empty diagnostics
        return [];
    }
    catch (e) {
        return [{ message: String(e) }];
    }
}
function getHover(source, symbol) {
    const ast = (0, parser_1.parse)(source);
    // Reuse simple hover approach from CLI: find enums/constructors and functions
    const lastSeg = symbol.includes('.') ? symbol.split('.').pop() : symbol;
    const result = {};
    if (ast.kind !== 'Program')
        return result;
    const enums = [];
    for (const d of ast.decls)
        if (d.kind === 'EnumDecl')
            enums.push({ name: d.name, variants: d.variants });
    for (const en of enums) {
        if (en.name === symbol || en.name === lastSeg)
            return { kind: 'enum', name: en.name };
        for (const v of en.variants)
            if (v.name === symbol || v.name === lastSeg)
                return { kind: 'constructor', name: v.name, enum: en.name, params: v.params };
    }
    return result;
}
