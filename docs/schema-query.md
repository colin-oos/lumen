# Schema & Query (MVP)

Syntax:
- schema Name { field: Type, ... }
- store name : Schema = "path-or-uri"
- query name from store [where expr] [select a,b]

Types:
- Base types: Int, Text, Bool, Unit
- Queries are validated against the store's schema: projection fields must exist; where predicate is type-checked using schema field types (e.g., id + 1 is valid if id: Int)

Execution:
- In-memory: if the store path is a JSON array file, rows are loaded and the query applies predicate and projection in the runner.
- SQLite facade: if the store config starts with sqlite:, a deterministic mock adapter is used with server-side where/projection.

Examples:
- See examples/newproj/src/main.lum and examples/data/sqlite_query.lum