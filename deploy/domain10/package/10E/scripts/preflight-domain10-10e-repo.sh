#!/usr/bin/env bash
set -Eeuo pipefail
: "${REPO_ROOT:?REPO_ROOT must point to production TCDS checkout}"

SLICE_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

[[ -f "$REPO_ROOT/package.json" ]] || { echo "FAIL: production package.json missing"; exit 1; }
[[ -f "$REPO_ROOT/tsconfig.json" ]] || { echo "FAIL: production tsconfig.json missing"; exit 1; }

# Enforce sequential integration.
[[ -f "$REPO_ROOT/src/domains/operations/infrastructure/operationsRuntime.ts" ]] || {
  echo "FAIL: reviewed 10B runtime prerequisite missing"; exit 1;
}
[[ -d "$REPO_ROOT/src/domains/operations/delivery" ]] || {
  echo "FAIL: reviewed 10C runtime prerequisite missing"; exit 1;
}
[[ -d "$REPO_ROOT/src/domains/operations/incidents" ]] || {
  echo "FAIL: reviewed 10D runtime prerequisite missing"; exit 1;
}

[[ ! -f "$SLICE_ROOT/package.json" ]] || { echo "FAIL: 10E may not ship root package.json"; exit 1; }
[[ ! -f "$SLICE_ROOT/tsconfig.json" ]] || { echo "FAIL: 10E may not ship root tsconfig.json"; exit 1; }

# No overlay. Entire assurance subtree must be new.
if [[ -e "$REPO_ROOT/src/domains/operations/assurance" ]]; then
  echo "FAIL: production already contains operations/assurance; manual collision review required"
  exit 1
fi

# No direct provider/incident execution authority.
if grep -R -E 'microsoftGraphEmailProvider|telnyxSmsProvider|runDeliveryOrchestrationBatch|applyIncidentCommand|transitionIncident' \
   "$SLICE_ROOT/src/domains/operations/assurance" >/dev/null 2>&1; then
  echo "FAIL: 10E crosses prior-slice ownership boundary"
  exit 1
fi


if [[ -f "$REPO_ROOT/src/workers/workerBootstrap.ts" ]] && grep -Eq 'assuranceEvaluationWorker|assuranceEventWorker|runAssuranceEvaluationBatch|runAssuranceEventEmissionBatch' "$REPO_ROOT/src/workers/workerBootstrap.ts"; then
  echo "FAIL: production bootstrap already contains assurance execution authority; manual merge review required"
  exit 1
fi
if [[ -f "$REPO_ROOT/ecosystem.config.cjs" ]] && grep -Eq 'assuranceEvaluationWorker|assuranceEventWorker|runAssuranceEvaluationBatch|runAssuranceEventEmissionBatch' "$REPO_ROOT/ecosystem.config.cjs"; then
  echo "FAIL: PM2 configuration already schedules assurance execution authority"
  exit 1
fi

echo "PASS: Domain 10E production repository collision preflight"
