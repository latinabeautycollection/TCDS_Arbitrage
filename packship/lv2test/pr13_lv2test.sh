#!/usr/bin/env bash
# PR #13 (Pack/Ship scanner wiring V2.1 + Claim / Select Box / Measurements / Seal controls, PR #14 folded in) ->
# develop -> main -> rebuild + redeploy the Warehouse PWA (pm2 domain6-pwa, :8080) for the LV2TEST end-to-end run.
# Camera stays OFF (VITE_SCANDIT_WORKFLOW_PACK_SHIP not set): scans are typed into the Pack/Ship screen.
#   preflight  no change to the repo or the live app: PR head pinned, checkout clean/in sync, merge has no conflicts,
#              builds the PR in a throwaway worktree with the live .env (license + API base) and runs the Pack/Ship
#              controls + scanner suites
#   merge      CONFIRM=MERGE-PR13: --no-ff merge into develop (no squash, no trailer), push; main merged --no-ff from a
#              throwaway worktree only if main has no changes develop lacks
#   deploy     CONFIRM=DEPLOY-PWA: develop must contain PR #13; backup dist, npm ci, build, pm2 restart, checks
#   status     read only: heads, live build time, pm2 state, camera flag
#   rollback   CONFIRM=ROLLBACK-PWA: restore the latest dist backup, pm2 restart
# Prints no secrets (the license key is only checked for presence in the build, never shown).
set -euo pipefail
REPO=/srv/arb-system/api
APP=$REPO/tcds-domain6-v3/tcds_v23_work
PR13=13dc0342ad9e8405e75dc8492b5bf6b370eb05b9      # PR #13 head reviewed 2026-11-19 (13dc034, CI 3-line change on f111f17)
PM2APP=domain6-pwa
WT=/tmp/wt-pr13-preflight
cd "$REPO"
flag() { grep -E "^$1=" "$APP/.env" 2>/dev/null | cut -d= -f2- | tr -d '"' || true; }
clean_repo() {
  [ "$(git rev-parse --abbrev-ref HEAD)" = develop ] || { echo "repo is not on develop - stopping"; exit 1; }
  [ -z "$(git status --porcelain --untracked-files=no)" ] || { echo "tracked files modified in the checkout - stopping"; exit 1; }
}
case "${1:-}" in
preflight)
  clean_repo; git fetch -q origin
  [ "$(git rev-parse origin/scandit-integration)" = "$PR13" ] || { echo "PR #13 head moved since review ($(git rev-parse --short origin/scandit-integration)) - stopping"; exit 1; }
  echo "ok PR #13 head = ${PR13:0:7} (reviewed)"
  ahead=$(git rev-list --count origin/develop..HEAD); behind=$(git rev-list --count HEAD..origin/develop)
  echo "checkout: ahead $ahead, behind $behind of origin/develop"; [ "$ahead" = 0 ] || { echo "local develop has unpushed commits - stopping"; exit 1; }
  if ! git merge-tree -h 2>&1 | grep -q -- --write-tree; then echo "note: git $(git --version | cut -d' ' -f3) cannot test the merge in advance; the merge step will stop on any conflict"
  elif git merge-tree --write-tree origin/develop origin/scandit-integration >/dev/null 2>&1; then echo "ok merge into develop has no conflicts"; else echo "!! merge conflicts - stopping"; exit 1; fi
  echo "changed paths vs develop: $(git diff --name-only origin/develop...origin/scandit-integration | cut -d/ -f1-3 | sort -u | tr '\n' ' ')"
  rm -rf "$WT"; git worktree prune; git worktree add -q --detach "$WT" origin/scandit-integration
  cp -p "$APP/.env" "$WT/tcds-domain6-v3/tcds_v23_work/.env"
  ( cd "$WT/tcds-domain6-v3/tcds_v23_work"
    npm ci --no-audit --no-fund 2>&1 | tail -1 || true
    echo "== build (prebuild: scandit prepare + preflight; tsc; vite)"; npm run build 2>&1 | grep -E 'error|Error|PASS|FAIL|built in|✓' | tail -12 || true
    echo "== packship:controls:test"; npm run packship:controls:test 2>&1 | grep -E 'Test Files|Tests ' | tail -2 || true
    echo "== packship:scanner:test"; npm run packship:scanner:test 2>&1 | grep -E 'Test Files|Tests ' | tail -2 || true
    grep -lq 'packaging-options' dist/assets/*.js && echo "ok build contains the Pack/Ship controls (packaging-options call)" || echo "!! controls not found in the build" )
  git worktree remove --force "$WT"
  echo "camera flag VITE_SCANDIT_WORKFLOW_PACK_SHIP in live .env: '$(flag VITE_SCANDIT_WORKFLOW_PACK_SHIP)' (empty/false = camera off, typed scans)"
  echo "PREFLIGHT DONE (nothing merged or deployed)" ;;

merge)
  [ "${CONFIRM:-}" = "MERGE-PR13" ] || { echo "set CONFIRM=MERGE-PR13"; exit 1; }
  clean_repo; git fetch -q origin
  [ "$(git rev-parse origin/scandit-integration)" = "$PR13" ] || { echo "PR #13 head moved since review - stopping"; exit 1; }
  [ "$(git rev-list --count origin/develop..HEAD)" = 0 ] || { echo "local develop has unpushed commits - stopping"; exit 1; }
  git merge -q --ff-only origin/develop
  if git merge-base --is-ancestor "$PR13" HEAD; then echo "PR #13 already merged into develop"; else
    BASE=$(git rev-parse HEAD)
    git merge -q --no-ff -m "Merge PR #13: Pack/Ship scanner wiring V2.1 + Claim/Select Box/Measurements/Seal controls (6.2D)" "$PR13"
    git push -q origin develop; echo "develop: $(git log --oneline -1)"
    if [ -z "$(git diff --name-only "$BASE" origin/main)" ]; then
      rm -rf /tmp/wt-main-pr13; git worktree prune; git worktree add -q /tmp/wt-main-pr13 origin/main
      git -C /tmp/wt-main-pr13 merge --no-ff -q -m "Merge develop: PR #13 Pack/Ship wiring + controls" origin/develop
      git -C /tmp/wt-main-pr13 push -q origin HEAD:main; git worktree remove /tmp/wt-main-pr13; echo "main merged"
    else echo "!! main has file changes develop did not have - main left untouched"; git diff --name-only "$BASE" origin/main | head; fi
  fi
  git fetch -q origin; echo "develop=$(git rev-parse --short origin/develop) main=$(git rev-parse --short origin/main) branch=$(git rev-parse --abbrev-ref HEAD)" ;;

deploy)
  [ "${CONFIRM:-}" = "DEPLOY-PWA" ] || { echo "set CONFIRM=DEPLOY-PWA"; exit 1; }
  clean_repo; git merge-base --is-ancestor "$PR13" HEAD || { echo "develop checkout does not contain PR #13 - run merge first"; exit 1; }
  cd "$APP"; B="dist.bak.$(date -u +%Y%m%dT%H%M%SZ)"; [ -d dist ] && cp -a dist "$B" && echo "backup: $APP/$B"
  npm ci --no-audit --no-fund 2>&1 | tail -1 || true
  npm run build 2>&1 | grep -E 'error|Error|PASS|FAIL|built in' | tail -10 || true
  [ -f dist/index.html ] || { echo "!! build produced no dist/index.html - restore with CONFIRM=ROLLBACK-PWA $0 rollback"; exit 1; }
  grep -lq 'packaging-options' dist/assets/*.js && echo "ok Pack/Ship controls in the build" || echo "!! controls not found in the build"
  lk=$(flag VITE_SCANDIT_LICENSE_KEY); [ -n "$lk" ] && grep -lqF "${lk:0:12}" dist/assets/*.js && echo "ok Scandit license baked in" || echo "!! license not found in the build"; unset lk
  pm2 restart "$PM2APP" >/dev/null; sleep 2
  for p in / /pack-ship; do echo "GET :8080$p -> $(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:8080$p")"; done
  echo "PWA DEPLOYED (build $(date -r dist/index.html -u +%FT%TZ))" ;;

status)
  git fetch -q origin
  echo "develop=$(git rev-parse --short origin/develop) main=$(git rev-parse --short origin/main) PR13=$(git rev-parse --short origin/scandit-integration) checkout=$(git rev-parse --short HEAD) contains PR13: $(git merge-base --is-ancestor "$PR13" HEAD && echo yes || echo no)"
  echo "live build: $(date -r "$APP/dist/index.html" -u +%FT%TZ 2>/dev/null || echo none)"
  pm2 describe "$PM2APP" 2>/dev/null | grep -E 'status|restarts' | head -2
  echo "camera flag: '$(flag VITE_SCANDIT_WORKFLOW_PACK_SHIP)'" ;;

rollback)
  [ "${CONFIRM:-}" = "ROLLBACK-PWA" ] || { echo "set CONFIRM=ROLLBACK-PWA"; exit 1; }
  cd "$APP"; B=$(ls -dt dist.bak.* | head -1); [ -n "$B" ] || { echo "no backup"; exit 1; }
  rm -rf dist; cp -a "$B" dist; pm2 restart "$PM2APP" >/dev/null; sleep 2
  echo "restored $B; GET :8080/ -> $(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:8080/)" ;;
*) sed -n '2,14p' "$0"; exit 2 ;;
esac
