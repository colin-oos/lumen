# Stdlib and Loops

The `stdlib` module provides minimal helpers across Text, List, Set, and Map.

- Text
  - `length(s): Int`
  - `uppercase(s): Text`
  - `lowercase(s): Text`
- List
  - `map(xs, f)`, `filter(xs, f)`, `reduce(xs, init, f)`
  - `lengthList(xs): Int`, `head(xs)`, `tail(xs)`
  - `any(xs, f): Bool`, `all(xs, f): Bool`, `unique(xs)`, `union(a,b)`, `intersect(a,b)`
- Set (modeled as list)
  - `hasSet(xs, x)`
- Map (modeled as list of pairs)
  - `getMap(xs, k, def)`, `setMap(xs, k, v)`, `keys(xs)`, `values(xs)`

Notes:
- Implementations are pure and built from LUMEN constructs (loops, if-expr, pattern match).
- For convenience, these functions are also injected into the runtime under the `stdlib.*` namespace, so you can call them without explicit imports in simple scripts.

## Loops

Syntax:
- `while cond { ... }`
- `for name in expr { ... }`
- `break`, `continue`

See:
- `examples/loops/loops_with_stdlib.lum`
- `examples/actors/stdlib_actor.lum`

Run loop tests:
```
node packages/cli/dist/index.js fmt examples/libs/stdlib.lum
npm run test | grep loops-stdlib
```