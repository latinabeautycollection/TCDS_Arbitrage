#!/usr/bin/env bash
set -Eeuo pipefail
: "${DATABASE_URL:?DATABASE_URL is required}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
for n in 801 802 803 804 805 806 807 808 809; do
 f="$(find "$ROOT/database/migrations" -maxdepth 1 -name "${n}_*.sql" -print -quit)"
 [[ -n "$f" ]] || { echo "Missing migration $n" >&2; exit 2; }
 psql "$DATABASE_URL" -X -v ON_ERROR_STOP=1 -f "$f"
done
psql "$DATABASE_URL" -X -v ON_ERROR_STOP=1 -f "$ROOT/scripts/seed-domain8-policies.sql"
"$ROOT/scripts/smoke-domain8-foundation.sh"
"$ROOT/scripts/certify-domain8-foundation.sh"
"$ROOT/scripts/certify-domain8-foundation-behavioral.sh"
