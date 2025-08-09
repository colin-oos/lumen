#!/usr/bin/env bash
set -euo pipefail
LUMEN="node packages/cli/dist/index.js"

H1=$($LUMEN trace examples/actors/adder.lum --seed 123 --hash-only)
H2=$($LUMEN trace examples/actors/adder.lum --seed 123 --hash-only)

if [ "$H1" != "$H2" ]; then
  echo "Determinism failure: hashes differ"; exit 1
fi
echo "Deterministic trace OK"