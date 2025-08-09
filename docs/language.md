# LUMEN Language Tour

This document introduces the LUMEN language with small, runnable examples. All examples work with the CLI: `npm run lumen -- <file>`.

## Modules and imports
```
module app
import "../libs/stdlib.lum"
```

## Values and types
- Base: Int, Float, Bool, Text, Unit
- Records: `{ name: "Ada", id: 1 }`
- Tuples/Lists: `[1, 2, 3]`
- ADTs (enums):
```
enum Result = Ok(Int) | Err(Text)
```

## Functions
```
fn add(a: Int, b: Int): Int = a + b
add(1, 2)
```
Anonymous functions:
```
fn(x: Int): Int = x * 2
```
Effects:
```
fn greet(name: Text) raises io = io.print("Hello", name)
```

## Control flow
If-expressions:
```
let x = 3
if x < 0 then -1 else 1
```
Loops:
```
let acc = 0
for n in [1,2,3] { acc = acc + n; }

let i = 0
while i < 3 { i = i + 1; }
```
Break/continue are supported inside loops.

## Pattern matching
```
enum Msg = Sum(Int, Int) | Ping

match Sum(1,2) {
  case Sum(a,b) -> a + b
  case Ping -> 0
}
```
Or-patterns and guards are supported.

## Collections
- Lists: `[1,2,3]`
- Records: `{ x: 1, y: 2 }`
- Maps: `{ "k1" -> 1, "k2" -> 2 }`

## Actors
Two styles:
- Param-style actor: `actor Name(msg) = expr`
- Handler-style actor:
```
actor Acc {
  state total: Int = 0
  on Sum(a,b) -> total = total + a + b
  on Ping reply Int -> total
}
```
Spawn and messaging:
```
let a = spawn Acc
send a, Sum(1,2)
ask a, Ping
```
Deterministic scheduling is controlled with `--scheduler-seed`.

## Effects and policy
Effects are gated and checked; runtime denies can be applied via CLI flags or a `lumen.json` policy.
```
{
  "policy": { "deny": ["net"], "warn": ["fs", "time"] }
}
```
Calls like `io.print`, `fs.read`, `net.get`, `time.now` are recognized. Deterministic mocks are available (`--mock-effects`).

## Schema and queries
```
schema User { id: Int, name: Text }
store Users: User = "sqlite:./examples/data/app.db:users#orderBy=id"
query ActiveUsers from Users select id,name
ActiveUsers
```
In-memory store is available when no DB is provided. The SQLite adapter provides deterministic ordering; a real adapter is used when `better-sqlite3` is installed.

See `docs/stdlib.md` for standard library and `docs/cli.md` for commands.