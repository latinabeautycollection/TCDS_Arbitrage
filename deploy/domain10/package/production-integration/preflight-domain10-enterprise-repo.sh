#!/usr/bin/env bash
set -Eeuo pipefail
: "${REPO_ROOT:?REPO_ROOT must point at the TCDS_Arbitrage production checkout}"

PKG="$REPO_ROOT/package.json"
BOOT="$REPO_ROOT/src/workers/workerBootstrap.ts"
ECO="$REPO_ROOT/ecosystem.config.cjs"

[[ -f "$PKG" ]] || { echo "FAIL: production package.json missing"; exit 1; }
[[ -f "$BOOT" ]] || { echo "FAIL: production workerBootstrap.ts missing"; exit 1; }

node - "$PKG" <<'NODE'
const fs=require("fs");
const p=JSON.parse(fs.readFileSync(process.argv[2],"utf8"));
const deps={...(p.dependencies||{}),...(p.devDependencies||{})};
for(const [name,expected] of Object.entries({"ajv":"8.17.1","ajv-formats":"3.0.1"})){
  if(!deps[name]){
    console.error(`FAIL: production root missing ${name}`);
    process.exit(1);
  }
}
NODE

# Reviewed 10C is the sole Domain 10 human-message delivery executor.
if grep -Eq 'emailDeliveryWorker|runEmailDeliveryBatch|emailRetryWorker|emailReconciliationWorker' "$BOOT"; then
  echo "FAIL: legacy email executor is scheduled in central worker bootstrap"
  exit 1
fi

if [[ -f "$ECO" ]] && grep -Eq 'emailDeliveryWorker|runEmailDeliveryBatch|emailRetryWorker|emailReconciliationWorker' "$ECO"; then
  echo "FAIL: legacy email executor is scheduled in PM2 ecosystem"
  exit 1
fi

# Current Graph provider is intentionally retained as provider infrastructure.
GRAPH="$REPO_ROOT/src/domains/operations/providers/microsoftGraphEmailProvider.ts"
EMAIL_TYPES="$REPO_ROOT/src/domains/operations/models/emailTypes.ts"
[[ -f "$GRAPH" ]] || { echo "FAIL: production Microsoft Graph provider missing"; exit 1; }
[[ -f "$EMAIL_TYPES" ]] || { echo "FAIL: production Graph request types missing"; exit 1; }

grep -q 'ClientCertificateCredential' "$GRAPH" || {
  echo "FAIL: Graph provider lacks certificate-credential support"; exit 1;
}
grep -q 'response.status === 202' "$GRAPH" || {
  echo "FAIL: Graph provider does not enforce sendMail HTTP 202"; exit 1;
}
for field in eventId notificationId correlationId deliveryId attemptId importance; do
  grep -q "$field" "$EMAIL_TYPES" || {
    echo "FAIL: GraphSendRequest missing $field"; exit 1;
  }
done

# Legacy email SQL repository is allowed to remain only as dormant migration-era
# source. It may not become an execution authority after reviewed 10A-10C.
LEGACY="$REPO_ROOT/src/domains/operations/repositories/emailDeliveryRepository.ts"
if [[ -f "$LEGACY" ]]; then
  if grep -Eq 'emailDeliveryRepository|emailDeliveryWorker|emailRetryWorker|emailReconciliationWorker' "$BOOT" "$ECO" 2>/dev/null; then
    echo "FAIL: legacy email SQL surface is active"
    exit 1
  fi
fi

# No second Domain10 certification worker: current repo has a generic unrelated
# certificationWorker and 10F must remain deliberate/CI-driven.
if grep -Eq 'domain10CertificationWorker|runDomain10AutomatedCertification' "$BOOT"; then
  echo "FAIL: Domain 10F persistent worker authority already exists"
  exit 1
fi

echo "PASS: production repository Domain 10 ownership/collision prerequisites"
