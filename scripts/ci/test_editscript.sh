#!/usr/bin/env bash
set -euo pipefail
LUMEN="node packages/cli/dist/index.js"

# Create a small program with a known function
mkdir -p examples/edits
cat > examples/edits/edit_target.lum <<'EOF'
module m
fn greet(): Int = 1
EOF

# Snapshot SIDs before
$LUMEN check --sid-snapshot examples/edits > before.json
TARGET=$(jq -r '.nodes[] | select(.kind=="Fn" and .name=="greet") | .sid' before.json)
if [ -z "$TARGET" ] || [ "$TARGET" = "null" ]; then echo "No target SID"; cat before.json; exit 1; fi

# Apply: change body to literal 2
cat > editspec.json <<EOF
{ "targetSid": "$TARGET", "newBody": "2" }
EOF
$LUMEN apply editspec.json

# Snapshot after
$LUMEN check --sid-snapshot examples/edits > after.json

# Ensure greet SID still exists and other SIDs unchanged count-wise
AFTER_TARGET=$(jq -r '.nodes[] | select(.sid=="'$TARGET'") | .sid' after.json)
if [ "$AFTER_TARGET" != "$TARGET" ]; then echo "Target SID missing after apply"; exit 1; fi

# Basic check: snapshot node count unchanged
BCOUNT=$(jq '.nodes | length' before.json)
ACOUNT=$(jq '.nodes | length' after.json)
if [ "$BCOUNT" != "$ACOUNT" ]; then echo "Unexpected SID churn count"; exit 1; fi

echo "EditScript apply-by-SID OK"