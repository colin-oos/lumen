#!/usr/bin/env bash
set -euo pipefail
LUMEN="node packages/cli/dist/index.js"

# Create minimal examples
mkdir -p examples/effects
cat > examples/effects/ok_net_call.lum <<'EOF'
module fx
fn fetch(url: Text) raises net = net.get(url)
fetch("https://example.com")
EOF

cat > examples/effects/pure_calls_net.lum <<'EOF'
module fx
fn bad(url: Text) = net.get(url)
bad("https://example.com")
EOF

# Positive
$LUMEN check examples/effects/ok_net_call.lum

# Negative
if $LUMEN check examples/effects/pure_calls_net.lum 2>err.log; then
  echo "Expected failure for pure->net but got success"; cat err.log; exit 1
fi
grep -Ei "raises net|effect.*net|pure function" err.log >/dev/null || (echo "Missing helpful error message"; cat err.log; exit 1)
echo "Effects guardrails OK"