# Determinism

LUMEN aims for deterministic execution given the same program and inputs. Non-determinism is isolated behind effects, and scheduling can be controlled.

Controls:
- `lumen trace <file> --seed <S>`: mixes `<S>` into the trace hash for reproducible comparisons.
- `lumen trace <file> --scheduler-seed <S>`: controls actor mailbox processing order per tick.
- `lumen run <file> --scheduler-seed <S>`: applies the same deterministic scheduler ordering to execution.

Tests:
- Property tests check that event shapes remain consistent across seeds while hashes differ.