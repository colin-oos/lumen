# Benchmarks

A small mailbox micro-benchmark is provided to get a feel for actor scheduling performance.

Run:
```
node --max-old-space-size=2048 ./node_modules/ts-node/dist/bin.js ./tests/bench-mailbox.ts
```

The output shows messages processed per millisecond for N=1000.