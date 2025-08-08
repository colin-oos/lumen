"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isSqliteConfig = isSqliteConfig;
exports.parseSqliteConfig = parseSqliteConfig;
exports.loadSqlite = loadSqlite;
function isSqliteConfig(config) {
    return typeof config === 'string' && config.startsWith('sqlite:');
}
function parseSqliteConfig(config) {
    if (!isSqliteConfig(config))
        return null;
    // format: sqlite:<filePath>:<table>
    const rest = config.slice('sqlite:'.length);
    const idx = rest.lastIndexOf(':');
    if (idx <= 0)
        return { path: rest, table: 'main' };
    return { path: rest.slice(0, idx), table: rest.slice(idx + 1) };
}
function loadSqlite(config) {
    const parsed = parseSqliteConfig(config);
    if (!parsed)
        return [];
    // Deterministic mock per table name
    if (parsed.table === 'users')
        return [{ id: 1, name: 'Ada' }, { id: 2, name: 'Linus' }];
    if (parsed.table === 'items')
        return [{ id: 100, name: 'Widget' }];
    return [];
}
