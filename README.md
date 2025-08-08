# LUMEN Prototype (v0.1) — Monorepo

This is a minimal scaffold to begin building the LUMEN language prototype in TypeScript/Node.

## Structure
- `packages/core-ir` — Core AST types, semantic IDs, and IR utilities
- `packages/parser`  — Minimal parser (stub) from LumenScript → IR
- `packages/fmt`     — Canonical formatter (IR → source)
- `packages/runner`  — Deterministic interpreter with effect hooks (stub)
- `packages/spec`    — Spec runner and property test scaffolding (stub)
- `packages/cli`     — CLI entry points (`lumen fmt`, `lumen run`, etc.)
- `examples/`        — Toy examples to validate end-to-end flow
- `docs/`            — Design docs (Core IR, effects, etc.)

## Quick Start
```bash
# from repository root
npm install
npm run build
npm run test

# Run examples
node packages/cli/dist/index.js run examples/hello/main.lum
node packages/cli/dist/index.js run examples/modules/main.lum

# Check round-trip + effects
node packages/cli/dist/index.js check examples/hello
node packages/cli/dist/index.js check examples/modules --recursive --json

# Format
node packages/cli/dist/index.js fmt examples/hello --write
```

## Notes
- Parser: `let`, `fn [raises ...]`, numbers, booleans, strings, binary ops, calls, imports, modules, qualified names, effect calls (`io.print`, `fs.read`, `fs.write`).
- Formatter: canonical one-line forms for supported nodes.
- Runner: deterministic; env, closures, calls; effect hooks: `io.print`, `fs.read`, `fs.write` (gated by deny policy via `--deny` or `lumen.json`).
- Checker: parse→format→parse round-trip, project-level effect propagation with call-chain diagnostics; flags `EffectCall`s; `--json` output; `--policy` with `deny`/`warn` and `--strict-warn`.

## Effects & Policy
- Declare effects on functions with `raises`:

```lumen
fn fetch(url) raises net = http.get(url)
```

- Built-in effect calls:

```lumen
io.print("hello")
fs.write("/tmp/file.txt", "data")
let txt = fs.read("/tmp/file.txt")
```

- Policy file `lumen.json`:

```json
{
  "policy": {
    "deny": ["net"],
    "warn": ["fs"]
  }
}
```

- CLI flags:
  - `run --deny=io,net`
  - `check --json`
  - `check --policy path/to/lumen.json` and `--strict-warn`