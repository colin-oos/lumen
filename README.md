# LUMEN

A small, deterministic, effect-gated language for building complex apps with confidence. LUMEN ships with:

- A practical syntax with expressions, pattern matching, ADTs, records/tuples, collections, and first-class functions
- Deterministic actor runtime (ask/send/handlers) with scheduler seeding, effect gating, and policy enforcement
- Schema/query sugar with a deterministic in-memory engine and an optional real SQLite adapter
- A batteries-included stdlib for Text/List/Set/Map, plus deterministic effect mocks for testing
- Tooling: formatter, type/effect checks, trace hashing, LSP (diagnostics/hover/symbols/definitions/references/rename/completions), TS type emission, and a test/spec runner

This repo is a monorepo implemented in TypeScript, with a CLI you can run locally.

## Quick start

- Install deps and build
```
npm ci
npm run build
```

- Run an example:
```
# Simple stdlib + loops
npm run lumen -- examples/loops/loops_with_stdlib.lum

# Actors
npm run lumen -- examples/actors/adder.lum

# Deterministic trace (with seed)
npm run lumen -- trace examples/actors/adder.lum --seed A --hash-only

# SQLite (mocked):
npm run lumen -- examples/data/sqlite_real_example.lum

# Real SQLite (optional)
npm run ci:install-sqlite
npm run gen:sqlite
npm run lumen -- examples/data/sqlite_real_example.lum
```

- Format a file:
```
npm run lumen -- fmt examples/actors/adder.lum
```

- Hover/symbols/defs via serve protocol:
See `docs/serve.md` for the newline-delimited JSON protocol.

## Learn LUMEN

- Start here: `docs/quickstart.md`
- Language tour: `docs/language.md`
- Standard library: `docs/stdlib.md`
- Determinism (trace and scheduler seeds): `docs/determinism.md`
- SQLite adapter (mock + real): `docs/sqlite.md`
- CLI commands and flags: `docs/cli.md`
- LSP/serve protocol: `docs/serve.md`
- Type emission (TS): `docs/emit.md`
- Benchmarks & CI sharding: `docs/benchmarks.md`, `docs/ci.md`

## Project layout

- `packages/*`: core packages (parser, runner, fmt, cli, lsp)
- `examples/*`: small programs demonstrating language features
- `tests/*`: TypeScript tests driving the CLI and runtime
- `docs/*`: human-focused documentation

## Status

The implementation is feature-complete for building complex apps. Determinism is a first-class concern; all non-determinism is behind effect gates with policy controls. See `docs/determinism.md`.

## License

MIT