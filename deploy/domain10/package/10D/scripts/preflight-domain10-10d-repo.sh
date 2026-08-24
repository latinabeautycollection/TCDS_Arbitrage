#!/usr/bin/env bash
set -Eeuo pipefail
: "${REPO_ROOT:?REPO_ROOT must point to production TCDS checkout}"
SLICE_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
[[ -f "$REPO_ROOT/src/domains/operations/infrastructure/operationsRuntime.ts" ]] || { echo 'FAIL: reviewed 10B runtime not integrated'; exit 1; }
[[ -d "$REPO_ROOT/src/domains/operations/delivery" ]] || { echo 'FAIL: reviewed 10C delivery slice not integrated'; exit 1; }
[[ ! -f "$SLICE_ROOT/package.json" && ! -f "$SLICE_ROOT/tsconfig.json" ]] || { echo 'FAIL: 10D ships competing root build files'; exit 1; }
while IFS= read -r -d '' src; do rel="${src#"$SLICE_ROOT/"}"; case "$rel" in docs/*|database/*|scripts/*|tests/*|certification/*) continue;; esac; [[ ! -e "$REPO_ROOT/$rel" ]] || { echo "FAIL: production path collision: $rel"; exit 1; }; done < <(find "$SLICE_ROOT/src" -type f -print0)
# Semantic collision: there must not already be another incident lifecycle/escalation worker authority.
if [[ -f "$REPO_ROOT/src/workers/workerBootstrap.ts" ]] && grep -Eq 'incidentActivationWorker|incidentEscalationWorker|acknowledgementDeadlineWorker|incidentLifecycleWorker|escalationWorker' "$REPO_ROOT/src/workers/workerBootstrap.ts"; then echo 'FAIL: existing incident/escalation worker authority detected'; exit 1; fi
echo 'PASS: Domain 10D production repo collision preflight'
