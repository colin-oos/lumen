# Complex App Example

This example demonstrates LUMEN's end-to-end capabilities:
- Schema/source/query (including comprehension sugar and `source ... with persist(...)`)
- Actors for aggregation and services
- HTTP effect (mockable)
- Deterministic execution and policy-friendly design

## Source

File: `examples/apps/complex_app.lum`

- Declares a module and a schema `Event`.
- Defines a `source events: Store<Event> with persist("sqlite:...:events")`.
- Uses a query comprehension for `recent()` streaming query.
- Spawns an `Aggregator` actor and a `Service` actor that uses an HTTP fetch function.

## Running

- Print the formatted source:
```
node packages/cli/dist/index.js fmt examples/apps/complex_app.lum
```
- Check types/policy/roundtrip:
```
node packages/cli/dist/index.js check examples/apps/complex_app.lum --json
```
- Run with effect mocks:
```
node packages/cli/dist/index.js run examples/apps/complex_app.lum --mock-effects --policy examples/http/lumen.deny.json
```
- View a deterministic trace hash:
```
node packages/cli/dist/index.js trace examples/apps/complex_app.lum --hash-only
```
- Get symbol definitions and hover:
```
node packages/cli/dist/index.js defs examples/apps/complex_app.lum complex.Service
node packages/cli/dist/index.js hover examples/apps/complex_app.lum complex.Service
```

## Notes

- The SQLite adapter is a deterministic facade. Provide a real adapter hook if you wish; ensure stable ordering in tests.
- Effects are mockable; control via `--mock-effects` or environment-based maps for HTTP.
- See `docs/cli.md` and `docs/serve.md` for all commands.