# Quickstart Tutorial

1) Build and test:
```
npm install
npm run build
npm run test
```

2) Run examples:
```
# hello
node packages/cli/dist/index.js run examples/hello/main.lum

# actors
node packages/cli/dist/index.js run examples/actors/router_adt.lum
node packages/cli/dist/index.js run examples/actors/supervisor.lum
node packages/cli/dist/index.js run examples/actors/adder.lum

# schema/query
node packages/cli/dist/index.js check examples/newproj/src/main.lum
node packages/cli/dist/index.js check examples/data/sqlite_query.lum

# effects policy
node packages/cli/dist/index.js check examples/policy/main.lum --policy examples/policy/lumen.json --strict-warn

# http interop
node packages/cli/dist/index.js check examples/http/service.lum
```

3) Serve (LSP-like):
```
node packages/cli/dist/index.js serve
{"action":"symbols","file":"examples/data/sqlite_query.lum"}
```

4) Emit types:
```
node packages/cli/dist/index.js emit examples/data/sqlite_items.lum --ts
```

See `docs/` for detailed guides on CLI, actors, schema/query, effects, HTTP, and serve protocol.