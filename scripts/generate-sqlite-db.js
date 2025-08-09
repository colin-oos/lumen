#!/usr/bin/env node
const fs = require('fs')
let Database = null
try { Database = require('better-sqlite3') } catch {}

const outPath = require('path').resolve(__dirname, '../examples/data/app.db')

if (!Database) {
  console.log('better-sqlite3 not installed; skipping DB generation')
  process.exit(0)
}

try { if (fs.existsSync(outPath)) fs.unlinkSync(outPath) } catch {}
const db = new Database(outPath)
db.exec('CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT)')
const stmt = db.prepare('INSERT INTO users (id, name) VALUES (?, ?)')
stmt.run(1, 'Ada')
stmt.run(2, 'Linus')
console.log('Generated', outPath)