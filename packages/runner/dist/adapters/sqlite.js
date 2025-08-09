"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isSqliteConfig = isSqliteConfig;
exports.parseSqliteConfig = parseSqliteConfig;
exports.loadSqlite = loadSqlite;
exports.prepareAndRun = prepareAndRun;
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
    // support order hint in config via #orderBy=name or #orderBy=id
    const orderBy = config.includes('#orderBy=name') ? 'name' : (config.includes('#orderBy=id') ? 'id' : null);
    const stable = [...filtered].sort((a, b) => {
        if (orderBy === 'id' && typeof a.id === 'number' && typeof b.id === 'number')
            return a.id - b.id;
        if (orderBy === 'name' && typeof a.name === 'string' && typeof b.name === 'string')
            return String(a.name).localeCompare(String(b.name));
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
function prepareAndRun(config, query, params) {
    // deterministic stub: ignore SQL, use config and params to filter equality on id or name
    const where = (row) => {
        if (query.includes('id = ?') && typeof params[0] === 'number')
            return row.id === params[0];
        if (query.includes('name = ?') && typeof params[0] === 'string')
            return row.name === params[0];
        return true;
    };
    return loadSqlite(config, where);
}
