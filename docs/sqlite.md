# SQLite Adapter

LUMEN provides a deterministic SQLite adapter with an optional real backend:

- Real adapter: uses `better-sqlite3` if available and database file exists.
- Deterministic mock: built-in data for simple tables (`users`, `items`) with stable ordering.

## Usage

- Store config: `sqlite:/path/to/app.db:users#orderBy=id`
- The `#orderBy=id` or `#orderBy=name` order hints ensure stable ordering.
- Prepared query (stub) API from runtime:
  - `prepareAndRun(config, sql, params)` returns result rows (real if available, mock otherwise).

Example store and query:
```
store Users: User = "sqlite:./examples/data/app.db:users#orderBy=id"
query ActiveUsers from Users select id,name
```

When using the real adapter, ensure `better-sqlite3` is installed:
```
npm install better-sqlite3
```

If the DB file is missing or the package is absent, the deterministic mock is used.