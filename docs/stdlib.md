# Stdlib and Loops

The `stdlib` module provides minimal helpers across Text, List, Set, and Map.

- Text
  - `length(s): Int`
  - `uppercase(s): Text`
  - `lowercase(s): Text`
- List
  - `map(xs, f)`, `filter(xs, f)`, `reduce(xs, init, f)`
- Set (modeled as list)
  - `hasSet(xs, x)`
- Map (modeled as list of pairs)
  - `getMap(xs, k, def)`, `setMap(xs, k, v)`

Notes:
- Implementations are pure and built from LUMEN constructs (loops, if-expr, pattern match).
- For convenience, these functions are also injected into the runtime under the `stdlib.*` namespace, so you can call them without explicit imports in simple scripts.

## Loops

Syntax:
- `while cond { ... }`
- `for name in expr { ... }`
- `break`, `continue`

Example:
```
let sum = 0
let i = 0
while i < 5 { i = i + 1; sum = sum + i; }

let acc = 0
for x in [1,2,3] { acc = acc + x; }
```

See `examples/loops/loops_with_stdlib.lum` for a combined example.

Run loop tests:
```
node packages/cli/dist/index.js fmt examples/libs/stdlib.lum
npm run test | grep loops-stdlib
```