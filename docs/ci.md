# CI Test Sharding

To avoid running out of memory on constrained agents when executing the full test suite with ts-node, shard the tests into smaller groups.

Example npm scripts (in package.json):
```
"test:core": "node --max-old-space-size=1536 ./node_modules/ts-node/dist/bin.js ./tests/parser-roundtrip.ts && node --max-old-space-size=1536 ./node_modules/ts-node/dist/bin.js ./tests/adt-check.ts && node --max-old-space-size=1536 ./node_modules/ts-node/dist/bin.js ./tests/query-exec.ts",
"test:effects": "node --max-old-space-size=1536 ./node_modules/ts-node/dist/bin.js ./tests/effects-mock.ts && node --max-old-space-size=1536 ./node_modules/ts-node/dist/bin.js ./tests/http-policy.ts",
"test:actors": "node --max-old-space-size=1536 ./node_modules/ts-node/dist/bin.js ./tests/actor-trace.ts && node --max-old-space-size=1536 ./node_modules/ts-node/dist/bin.js ./tests/adder-trace.ts",
"test:lsp": "node --max-old-space-size=1536 ./node_modules/ts-node/dist/bin.js ./tests/serve-smoke.ts && node --max-old-space-size=1536 ./node_modules/ts-node/dist/bin.js ./tests/serve-symbols.ts",
"test:extras": "node --max-old-space-size=1536 ./node_modules/ts-node/dist/bin.js ./tests/emit-types.ts && node --max-old-space-size=1536 ./node_modules/ts-node/dist/bin.js ./tests/loops-stdlib.ts && node --max-old-space-size=1536 ./node_modules/ts-node/dist/bin.js ./tests/stdlib-extras.ts && node --max-old-space-size=1536 ./node_modules/ts-node/dist/bin.js ./tests/for-loop-control.ts && node --max-old-space-size=1536 ./node_modules/ts-node/dist/bin.js ./tests/trace-seed.ts && node --max-old-space-size=1536 ./node_modules/ts-node/dist/bin.js ./tests/determinism-seeded.ts && node --max-old-space-size=1536 ./node_modules/ts-node/dist/bin.js ./tests/property-trace.ts"
```

Then run them in parallel CI jobs.