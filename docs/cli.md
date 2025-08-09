# CLI Reference

Use via `npm run lumen -- <cmd> ...` or `node packages/cli/dist/index.js <cmd> ...`.

## Commands

### run
Execute a program (merging transitive imports).
```
npm run lumen -- run examples/actors/adder.lum [--deny e1,e2] [--mock-effects] [--policy lumen.json] [--strict-warn] [--scheduler-seed S]
```
Output (JSON): value, trace, policy report, denied effects.

### fmt
Format a file or directory.
```
npm run lumen -- fmt <path> [--write] [--recursive]
```

### check
Round-trip stability + type/effect/policy checks.
```
npm run lumen -- check <path> [--json] [--policy lumen.json] [--strict-warn]
```

### trace
Run and print a deterministic trace; optionally hash.
```
npm run lumen -- trace <file> [--hash-only] [--expect HASH] [--seed S] [--scheduler-seed S]
```

### emit
Emit TypeScript types.
```
npm run lumen -- emit <file> --ts
```

### serve
Start a simple LSP-like server over stdin/stdout using newline-delimited JSON.
```
npm run lumen -- serve
```
See `docs/serve.md` for requests: diagnostics, hover, symbols, definitions, references, completions, rename.

### test
Execute `spec` blocks in a file or directory.
```
npm run lumen -- test <path>
```

### defs
Find definition of a symbol across transitive imports.
```
npm run lumen -- defs <file> <symbol>
```

### cache
Clear build cache.
```
npm run lumen -- cache clear
```

## Common flags
- `--deny e1,e2` or policy file to gate effects
- `--mock-effects` to use deterministic mocks for time/net/etc.
- `--seed` (trace) and `--scheduler-seed` (trace/run) to control determinism

## Examples
- Run with policy (deny net):
```
npm run lumen -- run examples/http/service.lum --policy examples/policy/lumen.json --strict-warn
```
- Hash a trace with seed:
```
npm run lumen -- trace examples/actors/adder.lum --seed ABC --hash-only
```
- Generate TS types:
```
npm run lumen -- emit examples/data/sqlite_real_example.lum --ts
```