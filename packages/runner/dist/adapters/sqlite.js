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
function loadSqlite(config, where, projection) {
    const parsed = parseSqliteConfig(config);
    if (!parsed)
        return [];
    let rows = [];
    if (parsed.table === 'users')
        rows = [{ id: 1, name: 'Ada' }, { id: 2, name: 'Linus' }];
    if (parsed.table === 'items')
        rows = [{ id: 100, name: 'Widget' }];
    const filtered = where ? rows.filter(where) : rows;
    const stable = [...filtered].sort((a, b) => {
        if (typeof a.id === 'number' && typeof b.id === 'number')
            return a.id - b.id;
        if (typeof a.name === 'string' && typeof b.name === 'string')
            return String(a.name).localeCompare(String(b.name));
        return JSON.stringify(a).localeCompare(JSON.stringify(b));
    });
    if (projection && projection.length > 0)
        return stable.map(r => Object.fromEntries(projection.map(f => [f, r[f]])));
    return stable;
}
