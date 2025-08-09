#!/usr/bin/env bash
set -euo pipefail
LUMEN="node packages/cli/dist/index.js"

mkdir -p examples/actors
cat > examples/actors/denied_net_in_actor.lum <<'EOF'
module actors
actor A(msg) = net.get("https://blocked")
let a = spawn A
send a, 0
0
EOF

if $LUMEN run examples/actors/denied_net_in_actor.lum 2>err.log; then
  echo "Expected capability denial"; cat err.log; exit 1
fi
grep -Ei "denied|effect.*net|policy|capability" err.log >/dev/null || (echo "Missing clear capability message"; cat err.log; exit 1)
echo "Actor capability enforcement OK"