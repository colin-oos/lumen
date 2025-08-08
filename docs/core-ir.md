# Core IR (v0.1 Draft)

Goals:
- Small, typed AST with **semantic IDs** (SIDs) for every node
- Deterministic evaluation model with effect hooks
- Round-trip stable between human syntax and IR

Node set (initial):
- Literals: `LitNum`, `LitText`, `LitBool`
- `Var`, `Let`, `Fn`, `Call`, `Binary`
- `EffectCall` (e.g., `io.print`, `fs.read`, `fs.write`)
- `SchemaDecl`, `StoreDecl`, `QueryDecl`
- `ImportDecl`, `ModuleDecl`
- `ActorDecl`, `Spawn`, `Send`, `Receive` (planned)
- `Program` (root)

Notes:
- `Let` is a top-level binding with `name` and `expr` only (no `body`).
- `Fn` contains `name | null`, `params: string[]`, `body: Expr`, `effects: Set<Effect>`.
- `ImportDecl` includes relative file path; `ModuleDecl` sets the current module for qualified names.

Effects:
- Built-ins: `io, fs, net, db, time, nondet, gpu, unchecked`
- Custom effects allowed; treated as strings