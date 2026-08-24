#!/usr/bin/env bash
set -Eeuo pipefail
: "${REPO_ROOT:?REPO_ROOT must point to production TCDS checkout}"
SLICE_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

[[ -f "$REPO_ROOT/package.json" ]] || { echo "FAIL: production package.json missing"; exit 1; }
[[ -f "$REPO_ROOT/tsconfig.json" ]] || { echo "FAIL: production tsconfig.json missing"; exit 1; }
[[ -f "$REPO_ROOT/src/domains/operations/infrastructure/operationsRuntime.ts" ]] || { echo "FAIL: reviewed 10B runtime missing"; exit 1; }
[[ -d "$REPO_ROOT/src/domains/operations/delivery" ]] || { echo "FAIL: reviewed 10C runtime missing"; exit 1; }
[[ -d "$REPO_ROOT/src/domains/operations/incidents" ]] || { echo "FAIL: reviewed 10D runtime missing"; exit 1; }
[[ -d "$REPO_ROOT/src/domains/operations/assurance" ]] || { echo "FAIL: reviewed 10E runtime missing"; exit 1; }

[[ ! -f "$SLICE_ROOT/package.json" ]] || { echo "FAIL: 10F must not ship root package.json"; exit 1; }
[[ ! -f "$SLICE_ROOT/tsconfig.json" ]] || { echo "FAIL: 10F must not ship root tsconfig.json"; exit 1; }

if [[ -e "$REPO_ROOT/src/domains/operations/domain10Certification" ]]; then
 echo "FAIL: production already contains domain10Certification; manual collision review required"; exit 1
fi

# Existing generic src/workers/certificationWorker.ts belongs to another platform
# workflow. 10F deliberately creates no worker and must not modify/schedule it.
if find "$SLICE_ROOT/src/domains/operations/domain10Certification" -type f -iname '*worker*' | grep -q .; then
 echo "FAIL: 10F must remain on-demand/CI certification; worker ownership is prohibited"; exit 1
fi

while IFS= read -r -d '' src; do
 rel="${src#"$SLICE_ROOT/"}"
 [[ ! -e "$REPO_ROOT/$rel" ]] || { echo "FAIL: production path collision: $rel"; exit 1; }
done < <(find "$SLICE_ROOT/src" -type f -print0)


# The existing generic src/workers/certificationWorker.ts belongs to another
# platform workflow. A Domain10-specific certification worker must not be added.
if [[ -f "$REPO_ROOT/src/workers/workerBootstrap.ts" ]] && \
   grep -Eq 'domain10CertificationWorker|runDomain10AutomatedCertification' \
   "$REPO_ROOT/src/workers/workerBootstrap.ts"; then
  echo "FAIL: production bootstrap already schedules Domain 10 certification execution"
  exit 1
fi

echo "PASS: Domain 10F production repository collision preflight"
