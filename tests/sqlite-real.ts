import fs from 'fs'
import path from 'path'
import { parse } from '@lumen/parser'
import { assignStableSids } from '@lumen/core-ir'
import { run } from '@lumen/runner'

function ensure(cond: boolean, msg: string) { if (!cond) { console.error(msg); process.exit(1) } }

let hasSqlite = false
try { require('better-sqlite3'); hasSqlite = true } catch {}

if (!hasSqlite) {
  console.log('sqlite-real skipped (better-sqlite3 not installed)')
  process.exit(0)
}

// Generate DB
try { require('child_process').execSync('node scripts/generate-sqlite-db.js', { stdio: 'inherit', cwd: path.resolve(__dirname, '..') }) } catch {}

const dbPath = path.resolve(__dirname, '../examples/data/app.db')
ensure(fs.existsSync(dbPath), 'app.db not generated')

const src = `
module demo
schema User { id: Int, name: Text }
store Users: User = "sqlite:${dbPath}:users#orderBy=id"
query ActiveUsers from Users select id,name
ActiveUsers
`.trim()

const ast = parse(src)
assignStableSids(ast)
const res = run(ast)
const rows = res.value as any[]
ensure(Array.isArray(rows) && rows.length >= 2, 'sqlite-real rows failed')
ensure(rows[0].id === 1 && rows[0].name === 'Ada', 'sqlite-real first row mismatch')
console.log('sqlite-real OK')