#!/usr/bin/env bash
# Warehouse PWA fix (found on the PR #15 wrong-scan retest, 2026-11-21): every bottom sheet drew UNDER the bottom nav
# and the status strip, hiding the end of the sheet (on Pack & Ship: the Code and Request ID lines).
# Cause: src/layouts/AppLayout.tsx gave <main> "relative z-[1]". A z-index on <main> makes it a stacking context, so
# nothing inside it (sheets z-50, toasts z-[60..80]) can rise above its siblings BottomNav (z-20) and StatusStrip
# (z-30). Present since the first PWA commit (v3.12.1); affects Pack & Ship, Inventory, Supervisor and Returns sheets.
# Fix: drop z-[1] (one class). Safe: the watermark it protected is position:absolute with no z-index and comes before
# <main>, so content still paints above it; no element in the app uses a negative z-index.
#   commit    CONFIRM=COMMIT-SHEET-FIX: checkout on develop, clean, in sync; edits exactly that line; commit (no
#             trailer); push develop; main merged --no-ff from a throwaway worktree only if main has nothing develop lacks
#   deploy    CONFIRM=DEPLOY-PWA: develop must contain the fix; backup dist, npm ci, build, pm2 restart, checks
#   status    read only: heads, whether the checkout and the live build have the fix, pm2 state
#   rollback  CONFIRM=ROLLBACK-PWA: restore the latest dist backup, pm2 restart
# Copy first: scp pwa_sheet_layer_fix.sh apifydev@139.177.200.80:/tmp/domain6_scanner/
# Prints no secrets.
set -euo pipefail
REPO=/srv/arb-system/api
APP=$REPO/tcds-domain6-v3/tcds_v23_work
REL=tcds-domain6-v3/tcds_v23_work/src/layouts/AppLayout.tsx
PR15MERGE=7234496                                   # develop must already contain the PR #15 merge
PM2APP=domain6-pwa
MSG_SUBJECT="fix(pwa): bottom sheets drew under the nav bar and status strip"
cd "$REPO"
clean_repo() {
  [ "$(git rev-parse --abbrev-ref HEAD)" = develop ] || { echo "repo is not on develop - stopping"; exit 1; }
  [ -z "$(git status --porcelain --untracked-files=no)" ] || { echo "tracked files modified in the checkout - stopping"; exit 1; }
}
has_fix() { ! grep -q 'relative z-\[1\]' "$1"; }

case "${1:-}" in
commit)
  [ "${CONFIRM:-}" = "COMMIT-SHEET-FIX" ] || { echo "set CONFIRM=COMMIT-SHEET-FIX"; exit 1; }
  clean_repo; git fetch -q origin
  [ "$(git rev-list --count origin/develop..HEAD)" = 0 ] || { echo "local develop has unpushed commits - stopping"; exit 1; }
  git merge -q --ff-only origin/develop
  git merge-base --is-ancestor "$PR15MERGE" HEAD || { echo "develop does not contain the PR #15 merge - stopping"; exit 1; }
  if has_fix "$REL"; then echo "fix already on develop ($(git log --oneline -1 -- "$REL"))"; else
    [ "$(grep -c '<main className={`relative z-\[1\] ' "$REL")" = 1 ] || { echo "AppLayout.tsx <main> line not as reviewed - stopping"; exit 1; }
    BASE=$(git rev-parse HEAD)
    sed -i 's/<main className={`relative z-\[1\] /<main className={`relative /' "$REL"
    [ "$(git diff --numstat | awk '{print $1" "$2" "$3}')" = "1 1 $REL" ] || { git checkout -- "$REL"; echo "unexpected diff - reverted, stopping"; exit 1; }
    git diff -U0 | grep '^[-+] ' | sed 's/^/  /'
    git add "$REL"
    git commit -q -m "$MSG_SUBJECT" -m "<main> in AppLayout had z-[1], which made it a stacking context. Every sheet, toast and dialog inside it
(z-50 and up) was capped below the bottom nav (z-20) and the status strip (z-30), so the end of each bottom sheet was
hidden. On Pack & Ship that hid the Code and Request ID on the \"Why is this blocked?\" sheet (seen on the LV2TEST
wrong-scan retest, 2026-11-21). Affected since v3.12.1: Pack & Ship, Inventory, Supervisor and Returns sheets.

Drop the z-index. The brand watermark is position:absolute with no z-index and precedes <main>, so content still
paints above it, and no element in the app uses a negative z-index."
    git push -q origin develop; echo "develop: $(git log --oneline -1)"
    if [ -z "$(git diff --name-only "$BASE" origin/main)" ]; then
      rm -rf /tmp/wt-main-sheetfix; git worktree prune; git worktree add -q /tmp/wt-main-sheetfix origin/main
      git -C /tmp/wt-main-sheetfix merge --no-ff -q -m "Merge develop: PWA bottom sheets above the nav bar" origin/develop
      git -C /tmp/wt-main-sheetfix push -q origin HEAD:main; git worktree remove /tmp/wt-main-sheetfix; echo "main merged"
    else echo "!! main has file changes develop did not have - main left untouched"; git diff --name-only "$BASE" origin/main | head; fi
  fi
  git fetch -q origin; echo "develop=$(git rev-parse --short origin/develop) main=$(git rev-parse --short origin/main) branch=$(git rev-parse --abbrev-ref HEAD)" ;;

deploy)
  [ "${CONFIRM:-}" = "DEPLOY-PWA" ] || { echo "set CONFIRM=DEPLOY-PWA"; exit 1; }
  clean_repo; has_fix "$REL" || { echo "develop checkout does not have the fix - run commit first"; exit 1; }
  cd "$APP"; B="dist.bak.$(date -u +%Y%m%dT%H%M%SZ)"; [ -d dist ] && cp -a dist "$B" && echo "backup: $APP/$B"
  npm ci --no-audit --no-fund 2>&1 | tail -1 || true
  npm run build 2>&1 | grep -E 'error|Error|PASS|FAIL|built in' | tail -10 || true
  [ -f dist/index.html ] || { echo "!! build produced no dist/index.html - restore with CONFIRM=ROLLBACK-PWA $0 rollback"; exit 1; }
  grep -lq 'relative z-\[1\]' dist/assets/*.js && echo "!! build still has the old <main> class" || echo "ok build has the sheet-layer fix"
  grep -lq 'Request ID: ' dist/assets/*.js && echo "ok PR #15 sheet still in the build" || echo "!! PR #15 sheet not found in the build"
  pm2 restart "$PM2APP" >/dev/null; sleep 2
  for p in / /pack-ship; do echo "GET :8080$p -> $(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:8080$p")"; done
  echo "PWA DEPLOYED (build $(date -r dist/index.html -u +%FT%TZ))" ;;

status)
  git fetch -q origin
  echo "develop=$(git rev-parse --short origin/develop) main=$(git rev-parse --short origin/main) checkout=$(git rev-parse --short HEAD)"
  echo "checkout has fix: $(has_fix "$REL" && echo yes || echo no)   main has fix: $(git show origin/main:"$REL" | grep -q 'relative z-\[1\]' && echo no || echo yes)"
  echo "live build: $(date -r "$APP/dist/index.html" -u +%FT%TZ 2>/dev/null || echo none)   live build has fix: $(grep -lq 'relative z-\[1\]' "$APP"/dist/assets/*.js && echo no || echo yes)"
  pm2 describe "$PM2APP" 2>/dev/null | grep -E 'status|restarts' | head -2 ;;

rollback)
  [ "${CONFIRM:-}" = "ROLLBACK-PWA" ] || { echo "set CONFIRM=ROLLBACK-PWA"; exit 1; }
  cd "$APP"; B=$(ls -dt dist.bak.* | head -1); [ -n "$B" ] || { echo "no backup"; exit 1; }
  rm -rf dist; cp -a "$B" dist; pm2 restart "$PM2APP" >/dev/null; sleep 2
  echo "restored $B; GET :8080/ -> $(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:8080/)" ;;
*) sed -n '2,15p' "$0"; exit 2 ;;
esac
