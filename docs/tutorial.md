# LUMEN End-to-End Tutorial

This tutorial walks through the core language features and tooling to build a small, deterministic app with actors, data queries, effects, and tooling support (serve/emit).

Prereqs:
- Node 18+
- `npm install && npm run build`

## 1) Initialize a project
```
node packages/cli/dist/index.js init examples/newproj
```
This creates `examples/newproj/src/main.lum` and `lumen.json`.

## 2) Modules and imports
Create a library module (see `examples/libs/util.lum`):
```
module util
fn add(a: Int, b: Int) = a + b
```
Register short-name imports in `lumen.pkg.json`:
```
{
  "deps": {
    "util": "examples/libs/util.lum"
  }
}
```
Use it in your program:
```
import "util"
let x = util.add(2, 3)
```

## 3) Enums and actor messages
Define an ADT for messages and a handler-style actor (see `examples/actors/adder.lum`):
```
enum Msg = Add(Int) | Get

actor Adder {
  state total: Int = 0
  on Add(1) -> { total = total + 1; }
  on Add(2) -> { total = total + 2; }
  on Get() reply Int -> total
}
```
Run it:
```
node packages/cli/dist/index.js run examples/actors/adder.lum
```

## 4) Schema and queries
Define a schema, store, and query (see `examples/newproj/src/main.lum` and `examples/data/sqlite_query.lum`):
```
schema User { id: Int name: Text }
store users : User = "./examples/newproj/users.json"
query active from users where id + 0 select id, name
```
Check typing and projection rules:
```
node packages/cli/dist/index.js check examples/newproj/src/main.lum
node packages/cli/dist/index.js check examples/data/sqlite_query.lum
```

## 5) Effects and policy
Declare effects in functions and enforce policy (see `examples/policy`):
```
fn netFetch(url) raises net = net.get(url)
fn now() raises time = time.now()
```
Policy file `lumen.json`:
```
{
  "policy": { "deny": ["net"], "warn": ["time"] }
}
```
Run checks with policy enforcement:
```
node packages/cli/dist/index.js check examples/policy/main.lum --policy examples/policy/lumen.json --strict-warn
```
Mock effects at runtime deterministically:
```
node packages/cli/dist/index.js run examples/policy/main.lum --mock-effects
```

## 6) HTTP interop (mocked)
Use the `http` effect (see `examples/http/service.lum`):
```
fn fetch(url) raises http = http.get(url)
actor Service { ... }
```
Provide response maps via env or file:
```
export LUMEN_HTTP_MOCK=$(pwd)/http-mock.json
# http-mock.json: { "GET https://example.com/ping": "PONG" }
```
Run checks:
```
node packages/cli/dist/index.js check examples/http/service.lum
```

## 7) Tooling: serve/hover/diagnostics/symbols
Start server:
```
node packages/cli/dist/index.js serve
```
Send requests (newline-delimited JSON):
```
{"action":"symbols","file":"examples/data/sqlite_query.lum"}
{"action":"hover","file":"examples/apps/calc_app.lum","symbol":"option_result.Ok"}
{"action":"diagnostics","file":"examples/apps/calc_app.lum"}
```
You’ll receive JSON responses with symbols, hover info, and structured diagnostics (types/effects/policy).

## 8) Emit TypeScript types
Generate TS types from schemas, enums, queries, and actors:
```
node packages/cli/dist/index.js emit examples/data/sqlite_items.lum --ts
node packages/cli/dist/index.js emit examples/actors/router_adt.lum --ts
```
This emits TS type aliases and interfaces, including discriminated unions for ADTs, `Pick`-based projection types for queries, per-actor message unions, and function signatures (with basic param inference).

## 9) Determinism and traces
Compute and compare execution traces:
```
node packages/cli/dist/index.js trace examples/actors/adder.lum --hash-only
# Expect a hash like t:1b1hoc; assert in CI via --expect
node packages/cli/dist/index.js trace examples/actors/adder.lum --expect t:1b1hoc
```

You now have an end-to-end flow: actors + data + effects + policy + tooling. See `docs/*` and `examples/*` for more.