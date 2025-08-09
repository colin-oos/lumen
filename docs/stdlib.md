# Standard Library

LUMEN ships a small stdlib focused on pure, deterministic helpers. Many are also provided by the runtime for convenience.

Tip: Import via `import "examples/libs/stdlib.lum"` or call as `stdlib.*` (runtime-injected).

## Text
- length(s): Int — length of string
- uppercase(s): Text; lowercase(s): Text
- startsWith(s, prefix): Bool; endsWith(s, suffix): Bool; contains(s, sub): Bool
- trim(s): Text; split(s, sep): [Text]; join(xs, sep): Text; replace(s, a, b): Text
- padLeft(s, n, ch): Text; padRight(s, n, ch): Text

Example:
```
let parts = stdlib.split("a,b,c", ",")
stdlib.join(parts, ";")  // "a;b;c"
```

## Lists
- map(xs, f), filter(xs, f), reduce(xs, init, f)
- lengthList(xs): Int; head(xs); tail(xs)
- concat(xs, ys), flatten(xss)
- unique(xs), union(a,b), intersect(a,b)

Example:
```
let xs = [1,2,3,4]
let ys = stdlib.map(xs, fn(x: Int): Int = x * 2)
let evens = stdlib.filter(ys, fn(x: Int): Bool = x % 2 == 0)
stdlib.reduce(evens, 0, fn(a: Int, x: Int): Int = a + x)  // 6
```

## Sets (modeled as lists)
- hasSet(xs, x)

## Maps (modeled as list of pairs)
- keys(xs), values(xs)
- getMap(xs, k, def), setMap(xs, k, v)

Notes:
- Runtime-injected functions in the interpreter back Text and List operations for performance and correctness.
- All helpers are deterministic and side-effect free.