# LUMEN Prototype (v0.1) — Monorepo

This is a minimal scaffold to begin building the LUMEN language prototype in TypeScript/Node.

## Structure
- `packages/core-ir` — Core AST types, semantic IDs, and IR utilities
- `packages/parser`  — Minimal parser (stub) from LumenScript → IR
- `packages/fmt`     — Canonical formatter (IR → source)
- `packages/runner`  — Deterministic interpreter with effect hooks (stub)
- `packages/spec`    — Spec runner and property test scaffolding (stub)
- `packages/cli`     — CLI entry points (`lumen fmt`, `lumen run`, etc.)
- `packages/lsp`     — Minimal LSP scaffolding (diagnostics + hover) and CLI `serve`
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
- Parser: `let`, `fn [raises ...]`, numbers, booleans, strings, binary ops, calls, imports, modules, qualified names, effect calls (`io.print`, `fs.read`, `fs.write`), `match`, ADT constructors, handler-style actors.
- Formatter: canonical one-line forms for supported nodes.
- Runner: deterministic; env, closures, calls; effect hooks: `io.print`, `fs.read`, `fs.write` (gated by deny policy via `--deny` or `lumen.json`), `net.get`, `time.now` mocks enabled with `--mock-effects`.
- Checker: parse→format→parse round-trip, project-level effect propagation with call-chain diagnostics; flags `EffectCall`s; `--json` output; `--policy` with `deny`/`warn` and `--strict-warn`; match typing and ADT return validation; actor handler exhaustiveness and reply type checks.

## Effects & Policy
See `docs/effects.md` and `examples/policy`.

## Actors
Router and Supervisor examples in `examples/actors`. See `docs/actors.md`.

## Schema & Query
In-memory and SQLite-facade examples in `examples/newproj` and `examples/data/sqlite_query.lum`. See `docs/schema-query.md`.

## Tooling
- CLI: `docs/cli.md`
- Serve protocol: use `lumen serve` and send newline-delimited JSON requests
- LSP: `packages/lsp` provides diagnostics and hover helpers

## Tutorials
- Quickstart: docs/quickstart.md

# Quickstart Tutorial

- Hello world: `node packages/cli/dist/index.js run examples/hello/main.lum`
- Actors router: `node packages/cli/dist/index.js run examples/actors/router_adt.lum`
- Supervisor: `node packages/cli/dist/index.js run examples/actors/supervisor.lum`
- Adder with payloads: `node packages/cli/dist/index.js run examples/actors/adder.lum`
- Schema/query (in-memory): `node packages/cli/dist/index.js check examples/newproj/src/main.lum`
- Schema/query (sqlite facade): `node packages/cli/dist/index.js check examples/data/sqlite_query.lum`
- Effects policy: `node packages/cli/dist/index.js check examples/policy/main.lum --policy examples/policy/lumen.json --strict-warn`
- Serve protocol: `node packages/cli/dist/index.js serve` then send JSON requests per `docs/serve.md`