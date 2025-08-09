#!/usr/bin/env bash
set -euo pipefail
LUMEN="node packages/cli/dist/index.js"

# Prepare a simple query that works both in-memory and sqlite
mkdir -p examples/sqlite
cat > examples/sqlite/parity_test.lum <<'EOF'
module demo
schema User { id: Int, name: Text }
store Users: User = ""
query All from Users select id,name
All
EOF

MEM=$($LUMEN run examples/sqlite/parity_test.lum)

# If better-sqlite3 is available, generate DB and compare
if node -e 'require.resolve("better-sqlite3")' 2>/dev/null; then
  npm run gen:sqlite > /dev/null 2>&1 || true
  cat > examples/sqlite/parity_test.lum <<'EOF'
module demo
schema User { id: Int, name: Text }
store Users: User = "sqlite:./examples/data/app.db:users#orderBy=id"
query All from Users select id,name
All
EOF
  SQL=$($LUMEN run examples/sqlite/parity_test.lum)
  # Compare sorted JSON (best-effort; adjust depending on output shape)
  diff -u <(echo "$MEM" | jq -S .) <(echo "$SQL" | jq -S .) || { echo "SQLite parity failed"; exit 1; }
fi

echo "SQLite parity OK (mock-only or mock==real)"