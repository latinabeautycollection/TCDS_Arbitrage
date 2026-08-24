#!/usr/bin/env bash
set -Eeuo pipefail
SLICE_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REPO_ROOT="${REPO_ROOT:-}"

[[ -n "$REPO_ROOT" ]] || { echo "FAIL: REPO_ROOT must point to production TCDS_Arbitrage"; exit 1; }
[[ -f "$REPO_ROOT/package.json" ]] || { echo "FAIL: production package.json missing"; exit 1; }

node -e '
const p=require(process.argv[1]);
if ((p.type||"commonjs")!=="commonjs") {
  console.error("FAIL: expected production CommonJS root");
  process.exit(1);
}
' "$REPO_ROOT/package.json"

# The slice must not bring competing root project controls.
[[ ! -f "$SLICE_ROOT/package.json" ]]
[[ ! -f "$SLICE_ROOT/tsconfig.json" ]]

# Tests must remain outside src because the production tsc includes src/**/*.ts.
if find "$SLICE_ROOT/src" -type f \( -name '*.test.ts' -o -path '*/tests/*' \) | grep -q .; then
  echo "FAIL: test files exist under src and would collide with root tsc include"
  exit 1
fi

# No generic infrastructure duplicates.
[[ ! -f "$SLICE_ROOT/src/domains/operations/repositories/db.ts" ]]
[[ ! -f "$SLICE_ROOT/src/domains/operations/observability/operationsLogger.ts" ]]

# Local NodeNext-style suffixes are forbidden in the production overlay.
if grep -R -E 'from ["'\''][^"'\'']+\.js["'\'']' "$SLICE_ROOT/src" --include='*.ts' >/dev/null; then
  echo "FAIL: .js ESM import suffix found"
  exit 1
fi

# Existing production paths must not be overwritten silently.
while IFS= read -r rel; do
  if [[ -e "$REPO_ROOT/$rel" ]]; then
    echo "FAIL: production path collision: $rel"
    exit 1
  fi
done < <(cd "$SLICE_ROOT" && find src/domains/operations -type f -printf '%p\n')

echo "PASS: Domain 10B production repository overlay preflight"
