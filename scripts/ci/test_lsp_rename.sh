#!/usr/bin/env bash
set -euo pipefail
LUMEN="node packages/cli/dist/index.js"
REQ='{"action":"rename","source":"fn foo() = 1\nfoo()","oldName":"foo","newName":"bar"}'
OUT=$(echo "$REQ" | $LUMEN serve)
LINE=$(echo "$OUT" | head -n1)
if ! echo "$LINE" | grep -q '"ok": true'; then echo "serve rename not ok"; echo "$OUT"; exit 1; fi
if ! echo "$LINE" | grep -q 'bar'; then echo "rename did not apply"; echo "$OUT"; exit 1; fi
echo "LSP rename OK"