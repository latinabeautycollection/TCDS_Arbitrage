#!/usr/bin/env bash
# PRODUCTION Warehouse app (pm2 domain6-pwa, :8080 behind warehouse-app.tcdsolutionsgroup.com): rebuild from develop with
# the password-recovery screens (forgot password -> code + new password) and the Recovery email menu item
# (VITE_RECOVERY_EMAIL_ENABLED=true).
#   preflight  nothing live changes: lists app commits since the live build, builds develop in a throwaway worktree with
#              the live .env + the flag, runs recovery (19) + Pack/Ship controls (64) tests + both type checks, checks the
#              bundle contains the recovery screens (and the Scandit license, without showing it)
#   deploy     CONFIRM=DEPLOY-PWA-RECOVERY: only once recovery is ENABLED on the login API (else the menu would lead to a
#              404); backup dist + .env, set the flag, npm ci, build, pm2 restart, public checks
#   camera     CONFIRM=DEPLOY-PWA-CAMERA: Pack/Ship camera ON for Sourabh's camera checks; recovery menu stays OFF;
#              deploy (later) keeps the camera flag
#   status     read-only        rollback  CONFIRM=ROLLBACK-PWA-RECOVERY: restore the dist + .env backups, pm2 restart
# Prints no secrets (the license key is only checked for presence).
set -euo pipefail
REPO=/srv/arb-system/api; APPDIR=tcds-domain6-v3/tcds_v23_work; APP=$REPO/$APPDIR; PM2APP=domain6-pwa; WT=/tmp/wt-pwa-recovery
ST=$HOME/prod_login_state; mkdir -p "$ST"; chmod 700 "$ST"
cd "$REPO"
flag() { grep -E "^$1=" "$2" 2>/dev/null | cut -d= -f2- | tr -d '"' || true; }
need() { [ "${CONFIRM:-}" = "$1" ] || { echo "set CONFIRM=$1"; exit 1; }; }
clean_repo() {
  [ "$(git rev-parse --abbrev-ref HEAD)" = develop ] || { echo "repo is not on develop - stopping"; exit 1; }
  [ -z "$(git status --porcelain --untracked-files=no)" ] || { echo "tracked files modified in the checkout - stopping"; exit 1; }
  git fetch -q origin; [ "$(git rev-list --count origin/develop..HEAD)" = 0 ] || { echo "local develop has unpushed commits - stopping"; exit 1; }
  git merge -q --ff-only origin/develop; }
bundle_checks() { # $1 = dist dir, $2 = .env used
  local d=$1
  grep -lq '/api/v1/auth/password-recovery' "$d"/assets/*.js && echo "   ok forgot-password screens in the build" || { echo "   !! password-recovery screens missing"; return 1; }
  grep -lq '/api/v1/auth/recovery-email' "$d"/assets/*.js && echo "   ok Recovery email screen in the build" || { echo "   !! recovery-email screen missing"; return 1; }
  grep -lq 'Recovery email' "$d"/assets/*.js && echo "   ok 'Recovery email' menu label in the build" || { echo "   !! menu label missing"; return 1; }
  local lk; lk=$(flag VITE_SCANDIT_LICENSE_KEY "$2"); if [ -n "$lk" ]; then grep -lqF "${lk:0:12}" "$d"/assets/*.js && echo "   ok Scandit license baked in" || { echo "   !! license not in the build"; return 1; }; else echo "   (no Scandit license in .env)"; fi
  unset lk; echo "   camera flag VITE_SCANDIT_WORKFLOW_PACK_SHIP: '$(flag VITE_SCANDIT_WORKFLOW_PACK_SHIP "$2")' (unchanged from live)"; }
api_enabled() { [ "$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:8095/api/v1/auth/recovery-email)" = 401 ]; }

case "${1:-}" in
status)
  echo "live build: $(date -r "$APP/dist/index.html" -u +%FT%TZ 2>/dev/null || echo none) | flag VITE_RECOVERY_EMAIL_ENABLED='$(flag VITE_RECOVERY_EMAIL_ENABLED "$APP/.env")'"
  echo "login API recovery: $(api_enabled && echo enabled || echo 'off (404)')"
  pm2 jlist 2>/dev/null | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{for(const p of JSON.parse(s||"[]"))if(p.name==="domain6-pwa")console.log("pm2 domain6-pwa: "+p.pm2_env.status)})'
  echo "public: / $(curl -s -o /dev/null -w '%{http_code}' https://warehouse-app.tcdsolutionsgroup.com/) | /auth/recovery $(curl -s -o /dev/null -w '%{http_code}' https://warehouse-app.tcdsolutionsgroup.com/auth/recovery)" ;;

preflight)
  clean_repo
  LIVE=$(date -r "$APP/dist/index.html" -u +%FT%TZ 2>/dev/null || echo 1970-01-01)
  echo "== app commits on develop since the live build ($LIVE):"; git log --oneline --since="$LIVE" origin/develop -- "$APPDIR" | sed 's/^/   /' | head -20
  echo "   files: $(git diff --stat "$(git rev-list -1 --before="$LIVE" origin/develop)" origin/develop -- "$APPDIR/src" "$APPDIR/package.json" | tail -1)"
  rm -rf "$WT"; git worktree prune; git worktree add -q --detach "$WT" origin/develop
  W=$WT/$APPDIR; cp -p "$APP/.env" "$W/.env"; sed -i '/^VITE_RECOVERY_EMAIL_ENABLED=/d' "$W/.env"; echo 'VITE_RECOVERY_EMAIL_ENABLED=true' >> "$W/.env"
  ( cd "$W"; export NODE_ENV=test; npm ci --include=dev --no-audit --no-fund --ignore-scripts 2>&1 | tail -1 || true
    echo "== recovery:test (19 expected)"; npm run recovery:test 2>&1 | grep -E 'Tests ' | tail -1 || true
    echo "== packship:controls:test (64 expected)"; npm run packship:controls:test 2>&1 | grep -E 'Tests ' | tail -1 || true
    echo "== tsc"; npx tsc --noEmit >/tmp/pwa_tsc.log 2>&1 && echo "   ok 0 type errors" || echo "   !! $(grep -c 'error TS' /tmp/pwa_tsc.log) type errors"
    echo "== tests:typecheck"; npm run -s tests:typecheck >/tmp/pwa_tt.log 2>&1 && echo "   ok 0 type errors" || echo "   !! $(grep -c 'error TS' /tmp/pwa_tt.log) type errors"
    echo "== build"; export NODE_ENV=production; npm run build 2>&1 | grep -E 'error|Error|FAIL|built in' | tail -5 || true
    [ -f dist/index.html ] && bundle_checks dist .env || echo "   !! build produced no dist" )
  git worktree remove --force "$WT"; echo "PREFLIGHT DONE (nothing live changed)" ;;

deploy)
  need DEPLOY-PWA-RECOVERY
  api_enabled || { echo "recovery is not enabled on the login API yet (prod_login_deploy.sh enable first) - stopping"; exit 1; }
  clean_repo
  TS=$(date -u +%Y%m%dT%H%M%SZ); cd "$APP"
  cp -a dist "dist.bak.$TS"; cp -p .env "$ST/pwa.env.bak-$TS"; echo "$TS" > "$ST/last_pwa_backup"; echo "backup: $APP/dist.bak.$TS + .env"
  sed -i '/^VITE_RECOVERY_EMAIL_ENABLED=/d' .env; echo 'VITE_RECOVERY_EMAIL_ENABLED=true' >> .env
  npm ci --include=dev --no-audit --no-fund 2>&1 | tail -1 || true
  npm run build 2>&1 | grep -E 'error|Error|FAIL|built in' | tail -5 || true
  if [ -f dist/index.html ] && bundle_checks dist .env; then
    pm2 restart "$PM2APP" >/dev/null; sleep 3
    echo "   :8080 $(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:8080/) | public / $(curl -s -o /dev/null -w '%{http_code}' https://warehouse-app.tcdsolutionsgroup.com/) | /auth/recovery $(curl -s -o /dev/null -w '%{http_code}' https://warehouse-app.tcdsolutionsgroup.com/auth/recovery) | /account/recovery-email $(curl -s -o /dev/null -w '%{http_code}' https://warehouse-app.tcdsolutionsgroup.com/account/recovery-email)"
    echo "PWA DEPLOYED (build $(date -r dist/index.html -u +%FT%TZ)) - reload the app (close all tabs) to get the new version"
  else
    rm -rf dist; cp -a "dist.bak.$TS" dist; cp -p "$ST/pwa.env.bak-$TS" .env; pm2 restart "$PM2APP" >/dev/null
    echo "!! build checks failed - previous app restored"; exit 1
  fi ;;

camera)
  # Sourabh's camera checks (2A): Pack/Ship camera ON, Recovery email menu still OFF (recovery is enabled later with deploy).
  need DEPLOY-PWA-CAMERA
  clean_repo
  TS=$(date -u +%Y%m%dT%H%M%SZ); cd "$APP"
  cp -a dist "dist.bak.$TS"; cp -p .env "$ST/pwa.env.bak-$TS"; echo "$TS" > "$ST/last_pwa_backup"; echo "backup: $APP/dist.bak.$TS + .env"
  sed -i '/^VITE_SCANDIT_WORKFLOW_PACK_SHIP=/d;/^VITE_RECOVERY_EMAIL_ENABLED=/d' .env; echo 'VITE_SCANDIT_WORKFLOW_PACK_SHIP=true' >> .env
  npm ci --include=dev --no-audit --no-fund 2>&1 | tail -1 || true
  npm run build 2>&1 | grep -E 'error|Error|FAIL|built in' | tail -5 || true
  lk=$(flag VITE_SCANDIT_LICENSE_KEY .env)
  if [ -f dist/index.html ] && [ -n "$lk" ] && grep -lqF "${lk:0:12}" dist/assets/*.js; then
    unset lk; pm2 restart "$PM2APP" >/dev/null; sleep 3
    echo "   ok Scandit license baked in | camera flag VITE_SCANDIT_WORKFLOW_PACK_SHIP='$(flag VITE_SCANDIT_WORKFLOW_PACK_SHIP .env)' | Recovery email menu: off"
    echo "   :8080 $(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:8080/) | public / $(curl -s -o /dev/null -w '%{http_code}' https://warehouse-app.tcdsolutionsgroup.com/)"
    echo "PWA DEPLOYED WITH CAMERA ON (build $(date -r dist/index.html -u +%FT%TZ)) - close and reopen the app (and the installed app) to load it"
  else
    unset lk; rm -rf dist; cp -a "dist.bak.$TS" dist; cp -p "$ST/pwa.env.bak-$TS" .env; pm2 restart "$PM2APP" >/dev/null
    echo "!! build or license check failed - previous app restored"; exit 1
  fi ;;

rollback)
  need ROLLBACK-PWA-RECOVERY; TS=$(cat "$ST/last_pwa_backup"); cd "$APP"
  rm -rf dist; cp -a "dist.bak.$TS" dist; cp -p "$ST/pwa.env.bak-$TS" .env; pm2 restart "$PM2APP" >/dev/null; sleep 2
  echo "ROLLED BACK to dist.bak.$TS: :8080 $(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:8080/)" ;;
*) sed -n '2,13p' "$0"; exit 2 ;;
esac
