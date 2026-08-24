#!/usr/bin/env bash
set -Eeuo pipefail

: "${REPO_ROOT:?REPO_ROOT must point to the production TCDS repository checkout}"

SLICE_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$SLICE_ROOT"

[[ -f "$REPO_ROOT/package.json" ]] || { echo "FAIL: production package.json missing"; exit 1; }
[[ -f "$REPO_ROOT/tsconfig.json" ]] || { echo "FAIL: production tsconfig.json missing"; exit 1; }

# 10C must not ship competing root build files.
[[ ! -f "$SLICE_ROOT/package.json" ]] || { echo "FAIL: slice root package.json would collide"; exit 1; }
[[ ! -f "$SLICE_ROOT/tsconfig.json" ]] || { echo "FAIL: slice root tsconfig.json would collide"; exit 1; }

# Reviewed 10B shared runtime must already exist in the repository after 10B integration.
[[ -f "$REPO_ROOT/src/domains/operations/infrastructure/operationsRuntime.ts" ]] || {
  echo "FAIL: reviewed 10B operationsRuntime.ts prerequisite missing"
  exit 1
}

# Check every production overlay file. Refuse overwrite of an existing path.
while IFS= read -r -d '' src; do
  rel="${src#"$SLICE_ROOT/"}"
  case "$rel" in
    certification/*|docs/*|database/*|scripts/*|tests/*) continue ;;
  esac
  dest="$REPO_ROOT/$rel"
  if [[ -e "$dest" ]]; then
    echo "FAIL: production path collision: $rel"
    exit 1
  fi
done < <(find "$SLICE_ROOT/src" -type f -print0)

# Existing provider files are intentionally outside 10C and must not be overlaid.
for name in \
  microsoftGraphEmailProvider.ts \
  emailDeliveryWorker.ts \
  telnyxSmsProvider.ts \
  notificationPlanningWorker.ts \
  operationsRuntime.ts; do
  if find "$SLICE_ROOT/src/domains/operations/delivery" -type f -name "$name" | grep -q .; then
    echo "FAIL: 10C duplicates existing/owned file $name"
    exit 1
  fi
done


# Semantic collision guard: current production contains a legacy email worker.
# It may remain in source control, but it must not be scheduled in the same
# worker bootstrap as 10C, or both could claim/send EMAIL work.
if [[ -f "$REPO_ROOT/src/workers/workerBootstrap.ts" ]] && \
   grep -Eq 'emailDeliveryWorker|runEmailDeliveryBatch' "$REPO_ROOT/src/workers/workerBootstrap.ts"; then
  echo "FAIL: legacy email delivery worker is scheduled; dual EMAIL execution authority is forbidden"
  exit 1
fi

if [[ -f "$REPO_ROOT/ecosystem.config.cjs" ]] && \
   grep -Eq 'emailDeliveryWorker|runEmailDeliveryBatch' "$REPO_ROOT/ecosystem.config.cjs"; then
  echo "FAIL: PM2 configuration schedules legacy email delivery worker"
  exit 1
fi

echo "PASS: Domain 10C production repository collision preflight"
