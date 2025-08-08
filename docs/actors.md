# Actors (V2)

Forms:
- Param-style: actor Name(param: Type) [raises e1,e2] = expr
- Handler-style: actor Name { state name: Type = init; on Pattern [if Guard] [reply Type] -> expr }

Semantics:
- spawn Name -> actor ref (opaque string)
- send ref Msg -> enqueues message for actor
- ask ref Msg[, timeoutMs] -> enqueues request with reply sink; blocks scheduler loop until replied or timeout
- Deterministic scheduler: single-threaded, drains mailboxes in stable order
- Effects within actors are gated by the actor's declared effects

Patterns:
- Literals, '_' wildcard, constructors of ADTs (e.g., MyEnum.Ctor(...))
- First-match wins; guards must be pure (checker enforces)
- Exhaustiveness: when all handler patterns are constructors of the same enum, checker ensures all variants are covered (or wildcard)

Examples:
- Router (ADT-based dispatch): see examples/actors/router_adt.lum
- Supervisor (restart on Crash): see examples/actors/supervisor.lum