#!/usr/bin/env bash
set -Eeuo pipefail
IFS=$'\n\t'

root="src/domains/shipping/intelligenceHub"
required=(
  "$root/engines/intelligenceHubEngine.ts"
  "$root/engines/actualDestinationRateEngine.ts"
  "$root/engines/zoneProtectionEngine.ts"
  "$root/validators/intelligenceContextValidator.ts"
  "$root/utils/canonicalJson.ts"
  "database/migrations/503_domain3_shipping_intelligence_hub_v2.sql"
)

for file in "${required[@]}"; do
  [[ -s "$file" ]] || { echo "missing or empty: $file" >&2; exit 1; }
done

if grep -R --line-number -E 'supports(Signature|AdultSignature|RestrictedDelivery).*\?\? true' "$root"; then
  echo "ERROR: unsafe capability default found" >&2
  exit 1
fi

if grep -R --exclude-dir=tests --line-number -E 'from "\.\./\.\./\.\./(providers|engines)|from "\.\./\.\./(providers|engines)' "$root"; then
  echo "ERROR: hub imports operational provider/engine internals directly" >&2
  exit 1
fi

grep -q 'purpose === "ACTUAL_DESTINATION"' \
  "$root/engines/carrierSelectionIntelligenceEngine.ts" || {
    echo "ERROR: carrier selection does not enforce actual-destination quotes" >&2
    exit 1
  }

grep -q 'REVOKE ALL ON FUNCTION arb.record_shipping_intelligence_decision_v2' \
  database/migrations/503_domain3_shipping_intelligence_hub_v2.sql || {
    echo "ERROR: SQL function privileges are not hardened" >&2
    exit 1
  }

echo "TCDS Shipping Intelligence Hub v2 preflight passed."
