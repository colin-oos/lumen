# Quickstart

Welcome to LUMEN. This guide gets you from zero to running examples and writing your first program.

## Install and build
```
git clone <this repo>
cd lumen-proto
npm ci
npm run build
```

## Run your first program
Create `hello.lum`:
```
module hello
fn greet(name: Text) raises io = io.print("Hello,", name)

// evaluate the expression below
if true then greet("LUMEN") else 0
```
Run it:
```
npm run lumen -- hello.lum
```

## Use the stdlib
```
module demo
import "examples/libs/stdlib.lum"

let xs = [1,2,3,4]
let ys = stdlib.map(xs, fn(x: Int): Int = x * 2)
let evens = stdlib.filter(ys, fn(x: Int): Bool = x % 2 == 0)
let sum = stdlib.reduce(evens, 0, fn(a: Int, x: Int): Int = a + x)
sum
```
Run it:
```
npm run lumen -- demo.lum
```

## Actors
```
module actors

enum Msg = Add(Int, Int) | Get
actor Adder(msg) = match msg {
  case Add(a,b) -> 0
  case Get reply Int -> 0
}

let a = spawn Adder
send a, Add(1,2)
ask a, Get
```
Trace with a seed:
```
npm run lumen -- trace actors.lum --seed A
```

## Queries
```
schema User { id: Int, name: Text }
store Users: User = ""
query All from Users select id,name
All
```
SQLite (optional):
```
npm run ci:install-sqlite
npm run gen:sqlite
npm run lumen -- examples/data/sqlite_real_example.lum
```

## Next steps
- Language tour: `docs/language.md`
- Standard library: `docs/stdlib.md`
- CLI commands: `docs/cli.md`
- Determinism controls: `docs/determinism.md`
- LSP/serve: `docs/serve.md`
- SQLite adapter: `docs/sqlite.md`