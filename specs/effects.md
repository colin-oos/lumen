# Effects (v0.1 Draft)

Purpose:
- Make side effects explicit and machine-checkable
- Power deterministic runs and capability enforcement
- Provide AI with safe refactor boundaries

Built-ins (initial):
- `io`, `fs`, `net`, `db`, `time`, `nondet`, `gpu`, `unchecked`

Custom effects are allowed and propagate like built-ins.
