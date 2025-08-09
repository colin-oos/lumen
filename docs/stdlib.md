# Stdlib and Loops

The `stdlib` module provides minimal helpers across Text, List, Set, and Map.

File: `examples/libs/stdlib.lum`

- Text
  - `length(s: Text): Int`
  - `uppercase(s: Text): Text`
  - `lowercase(s: Text): Text`
- List[Int]
  - `map(xs, f)`, `filter(xs, f)`, `reduce(xs, init, f)`
- Set[Int] (modeled as list)
  - `hasSet(xs, x)`
- Map[Int,Int] (modeled as list of pairs)
  - `getMap(xs, k, def)`, `setMap(xs, k, v)`

Note: These are pure implementations built from LUMEN constructs (for loops, if-expr, etc.).

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

Run loop tests:
```
node packages/cli/dist/index.js fmt examples/libs/stdlib.lum
npm run test | grep loops-stdlib
```