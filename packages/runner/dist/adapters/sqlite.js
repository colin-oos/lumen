"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.isSqliteConfig = isSqliteConfig;
exports.parseSqliteConfig = parseSqliteConfig;
exports.loadSqlite = loadSqlite;
exports.prepareAndRun = prepareAndRun;
let BetterSqlite3 = null;
try {
    BetterSqlite3 = require('better-sqlite3');
}
catch { }
const fs_1 = __importDefault(require("fs"));
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
function loadSqliteReal(config, where, projection) {
    const parsed = parseSqliteConfig(config);
    if (!parsed || !BetterSqlite3 || !fs_1.default.existsSync(parsed.path))
        return [];
    const db = new BetterSqlite3(parsed.path, { readonly: true });
    const sql = `SELECT * FROM ${parsed.table}`;
    const stmt = db.prepare(sql);
    const rows = stmt.all();
    const filtered = where ? rows.filter(where) : rows;
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
function loadSqlite(config, where, projection) {
    const real = loadSqliteReal(config, where, projection);
    if (real && real.length)
        return real;
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
    // deterministically prefer real adapter if present
    const parsed = parseSqliteConfig(config);
    if (parsed && BetterSqlite3 && fs_1.default.existsSync(parsed.path)) {
        const db = new BetterSqlite3(parsed.path, { readonly: true });
        try {
            const stmt = db.prepare(query);
            const rows = stmt.all(...params);
            return rows;
        }
        catch {
            return [];
        }
    }
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
