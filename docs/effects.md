# Effects & Policy (V1)

Built-in effects:
- io, fs, net, db, time, nondet, gpu, unchecked

Declaring effects:
- Functions that perform effectful operations must declare their effects with `raises`.

Example:
```
fn say(x) raises io = io.print(x)
fn fetch(url) raises net = net.get(url)
fn now() raises time = time.now()
```

Policy (lumen.json):
```
{
  "policy": {
    "deny": ["net"],
    "warn": ["fs", "time"]
  }
}
```

CLI integration:
- `run <file> --policy path --strict-warn` produces JSON with policy errors/warnings and enforces exit code when strict-warn.
- `check <path> --policy path --strict-warn` surfaces policy denies/warns across files.
- `run <file> --deny io,net` applies a runtime deny list of effects.
- `run <file> --mock-effects` enables deterministic mocks for effect backends:
  - net.get(url) => `MOCK:GET <url>`
  - time.now() => 0

Examples:
- See examples/effects/main.lum and examples/effects/fs.lum