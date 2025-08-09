#!/usr/bin/env bash
set -euo pipefail
LUMEN="node packages/cli/dist/index.js"

TMP1=$(mktemp)
TMP2=$(mktemp)
# Fallback: use check over repo root; replace with a snapshot flag if available
$LUMEN check . --json > "$TMP1"
$LUMEN fmt .
$LUMEN check . --json > "$TMP2"

diff -u "$TMP1" "$TMP2" || { echo "SID/round-trip changed"; exit 1; }
echo "SID round-trip stable"