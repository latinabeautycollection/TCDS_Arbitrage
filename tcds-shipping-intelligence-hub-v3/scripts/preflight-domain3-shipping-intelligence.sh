#!/usr/bin/env bash
set -Eeuo pipefail
IFS=$'\n\t'

required=(
  "src/domains/shipping/intelligenceHub/index.ts"
  "src/domains/shipping/intelligenceHub/engines/intelligenceHubEngine.ts"
  "database/migrations/502_domain3_shipping_intelligence_hub.sql"
)

for file in "${required[@]}"; do
  [[ -f "$file" ]] || { echo "missing: $file" >&2; exit 1; }
done

grep -R --exclude-dir=tests --line-number -E 'from "\.\./\.\./providers|from "\.\./\.\./engines' \
  src/domains/shipping/intelligenceHub && {
    echo "ERROR: intelligenceHub directly imports operational provider/engine internals." >&2
    exit 1
  } || true

echo "Shipping Intelligence Hub preflight passed."
