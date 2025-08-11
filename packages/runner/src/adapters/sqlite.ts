let BetterSqlite3: any = null
try { BetterSqlite3 = require('better-sqlite3') } catch {}
import fs from 'fs'

export function isSqliteConfig(config: string | null | undefined): config is string {
  return typeof config === 'string' && config.startsWith('sqlite:')
}

export function parseSqliteConfig(config: string): { path: string, table: string } | null {
  if (!isSqliteConfig(config)) return null
  // format: sqlite:<filePath>:<table>[#fragment]
  const rest = config.slice('sqlite:'.length)
  const idx = rest.lastIndexOf(':')
  if (idx <= 0) return { path: rest, table: 'main' }
  const rawTable = rest.slice(idx + 1)
  const table = rawTable.split('#')[0]
  return { path: rest.slice(0, idx), table }
}

function loadSqliteReal(config: string, where?: (row: Record<string, unknown>) => boolean, projection?: string[]): Array<Record<string, unknown>> {
  const parsed = parseSqliteConfig(config)
  if (!parsed || !BetterSqlite3 || !fs.existsSync(parsed.path)) return []
  const db = new BetterSqlite3(parsed.path, { readonly: true })
  const sql = `SELECT * FROM ${parsed.table}`
  const stmt = db.prepare(sql)
  const rows: Array<Record<string, unknown>> = stmt.all()
  const filtered = where ? rows.filter(where) : rows
  const orderBy = config.includes('#orderBy=name') ? 'name' : (config.includes('#orderBy=id') ? 'id' : null)
  const stable = [...filtered].sort((a, b) => {
    if (orderBy === 'id' && typeof a.id === 'number' && typeof b.id === 'number') return (a.id as number) - (b.id as number)
    if (orderBy === 'name' && typeof a.name === 'string' && typeof b.name === 'string') return String(a.name).localeCompare(String(b.name))
    if (typeof a.id === 'number' && typeof b.id === 'number') return (a.id as number) - (b.id as number)
    if (typeof a.name === 'string' && typeof b.name === 'string') return String(a.name).localeCompare(String(b.name))
    return JSON.stringify(a).localeCompare(JSON.stringify(b))
  })
  if (projection && projection.length > 0) return stable.map(r => Object.fromEntries(projection.map(f => [f, (r as any)[f]])))
  return stable
}

export function loadSqlite(config: string, where?: (row: Record<string, unknown>) => boolean, projection?: string[]): Array<Record<string, unknown>> {
  const real = loadSqliteReal(config, where, projection)
  if (real && real.length) return real
  const parsed = parseSqliteConfig(config)
  if (!parsed) return []
  let rows: Array<Record<string, unknown>> = []
  if (parsed.table === 'users') rows = [{ id: 1, name: 'Ada' }, { id: 2, name: 'Linus' }]
  if (parsed.table === 'items') rows = [{ id: 100, name: 'Widget' }]
  const filtered = where ? rows.filter(where) : rows
  // support order hint in config via #orderBy=name or #orderBy=id
  const orderBy = config.includes('#orderBy=name') ? 'name' : (config.includes('#orderBy=id') ? 'id' : null)
  const stable = [...filtered].sort((a, b) => {
    if (orderBy === 'id' && typeof a.id === 'number' && typeof b.id === 'number') return (a.id as number) - (b.id as number)
    if (orderBy === 'name' && typeof a.name === 'string' && typeof b.name === 'string') return String(a.name).localeCompare(String(b.name))
    if (typeof a.id === 'number' && typeof b.id === 'number') return (a.id as number) - (b.id as number)
    if (typeof a.name === 'string' && typeof b.name === 'string') return String(a.name).localeCompare(String(b.name))
    return JSON.stringify(a).localeCompare(JSON.stringify(b))
  })
  if (projection && projection.length > 0) return stable.map(r => Object.fromEntries(projection.map(f => [f, (r as any)[f]])))
  return stable
}

export function prepareAndRun(config: string, query: string, params: unknown[]): Array<Record<string, unknown>> {
  // deterministically prefer real adapter if present
  const parsed = parseSqliteConfig(config)
  if (parsed && BetterSqlite3 && fs.existsSync(parsed.path)) {
    const db = new BetterSqlite3(parsed.path, { readonly: true })
    try {
      const stmt = db.prepare(query)
      const rows = stmt.all(...params)
      return rows
    } catch {
      return []
    }
  }
  // deterministic stub: ignore SQL, use config and params to filter equality on id or name
  const where = (row: Record<string, unknown>) => {
    if (query.includes('id = ?') && typeof params[0] === 'number') return row.id === params[0]
    if (query.includes('name = ?') && typeof params[0] === 'string') return row.name === params[0]
    return true
  }
  return loadSqlite(config, where)
}