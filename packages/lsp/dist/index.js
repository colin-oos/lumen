"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getDiagnostics = getDiagnostics;
exports.getHover = getHover;
exports.getReferences = getReferences;
exports.getCompletions = getCompletions;
function getDiagnostics(source) {
    // existing lightweight checks
    const lines = source.split(/\n+/);
    const diags = [];
    for (let i = 0; i < lines.length; i++) {
        const ln = lines[i];
        if (/^fn\s+\w+\s*\(.*\)\s*=\s*$/.test(ln))
            diags.push({ line: i + 1, message: 'function missing body expression' });
    }
    return diags;
}
function getHover(source, symbol) {
    // minimal stub
    if (source.includes(`enum ${symbol} `))
        return { kind: 'enum', name: symbol };
    if (new RegExp(`fn\\s+${symbol}\\b`).test(source))
        return { kind: 'function', name: symbol };
    return {};
}
function getReferences(source, symbol) {
    const refs = [];
    const lines = source.split(/\n/);
    for (let i = 0; i < lines.length; i++) {
        const idx = lines[i].indexOf(symbol);
        if (idx >= 0)
            refs.push({ line: i + 1, column: idx + 1 });
    }
    return refs;
}
function getCompletions(prefix) {
    const keywords = ['let', 'mut', 'fn', 'actor', 'enum', 'if', 'then', 'else', 'match', 'case', 'while', 'for', 'break', 'continue', 'import', 'module'];
    return keywords.filter(k => k.startsWith(prefix));
}
