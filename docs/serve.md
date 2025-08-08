# Serve Protocol (experimental)

Start server:
```
node packages/cli/dist/index.js serve
```

Send newline-delimited JSON requests on stdin, receive JSON responses on stdout.

Supported actions:

- diagnostics (merged-program when file provided)
```
{"action":"diagnostics","file":"examples/apps/calc_app.lum"}
```
- hover (merged-program when file provided)
```
{"action":"hover","file":"examples/apps/calc_app.lum","symbol":"option_result.Ok"}
```
- symbols
```
{"action":"symbols","file":"examples/data/sqlite_query.lum"}
```

Responses have `{ ok: boolean, ... }` and payloads per action:
- diagnostics: `{ diagnostics: [{ message }] }`
- hover: `{ hover: { kind, name, module?, returnType?, effects?, schema?, source?, projection? } }`
- symbols: `{ symbols: [{ kind, module, name, ... }] }`