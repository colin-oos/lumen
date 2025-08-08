# LUMEN CLI Reference (v0.1)

Commands:

- fmt <path> [--write] [--recursive]
  - Format a file or directory. Prints to stdout unless --write is provided.

- run <file> [--deny e1,e2] [--policy path] [--strict-warn] [--mock-effects] [--no-cache]
  - Parse with imports and run. Policy denies and strict-warn enforced in JSON output.

- check <path> [--json] [--policy path] [--strict-warn] [--recursive] [--write]
  - Round-trip + effect/type/policy checks over a file or directory (with imports). JSON output includes errors, warnings, and types.

- init <dir>
  - Scaffold a new LUMEN project with src/main.lum and lumen.json.

- trace <file> [--no-cache]
  - Prints execution trace and a deterministic hash (t:<base36>) useful for regression testing.

- cache clear
  - Clears the content-addressed merged-program cache at .lumen-cache/

- hover <file> <symbol> [--json]
  - Prints enum/constructor/function info for a symbol in a file.

- serve
  - Start a simple newline-delimited JSON protocol on stdin/stdout.
  - Requests:
    - {"action":"hover","file":"path","symbol":"Name"}
    - {"action":"diagnostics","file":"path"}
    - {"action":"diagnostics","source":"lumen-source"}
    - {"action":"symbols","file":"path"}
  - Responses are JSON with ok and requested payload.