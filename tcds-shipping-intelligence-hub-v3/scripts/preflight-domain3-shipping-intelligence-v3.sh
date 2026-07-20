#!/usr/bin/env bash
set -Eeuo pipefail
root="src/domains/shipping/intelligenceHub"
required=("$root/models/stageContexts.ts" "$root/models/capabilityTypes.ts" "$root/engines/intelligenceHubEngine.ts" "$root/engines/actualDestinationRateEngine.ts" "$root/engines/packageIntelligenceEngine.ts" "$root/engines/shippingDigitalTwinEngine.ts" "$root/engines/decisionDriftEngine.ts" "$root/engines/shippingPolicySimulationEngine.ts" "$root/resilience/circuitBreaker.ts" "$root/resilience/retryPolicy.ts" "$root/resilience/bulkhead.ts" "database/migrations/504_domain3_shipping_intelligence_hub_v3.sql")
for f in "${required[@]}"; do [[ -s "$f" ]] || { echo "missing: $f" >&2; exit 1; }; done
if grep -R --line-number -E 'from "\.\./\.\./providers|from "\.\./\.\./engines' "$root"; then echo "ERROR: direct operational import" >&2; exit 1; fi
grep -q 'purpose === "ACTUAL_DESTINATION"' "$root/engines/carrierSelectionIntelligenceEngine.ts" || { echo "ERROR: destination invariant missing" >&2; exit 1; }
grep -q 'shipping_digital_twins' database/migrations/504_domain3_shipping_intelligence_hub_v3.sql || { echo "ERROR: digital twin schema missing" >&2; exit 1; }
echo "TCDS Shipping Intelligence Hub v3 preflight passed."
