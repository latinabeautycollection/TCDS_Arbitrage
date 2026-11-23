#!/usr/bin/env bash
# STAGING ONLY. Login API adapter v2 for login-v2-api-staging: adds recovery-email enrollment (TCDS 645) for signed-in
# employees at /api/v1/auth/recovery-email, and email kinds (reset code / enrollment code / approver notice).
#   check                                        read-only: live src/express/recovery == the committed v1 in the repo
#   build                                        compiles the live tree + v2 recovery dir with the server's tsc; lists changes
#   deploy     CONFIRM=DEPLOY-ADAPTER-V2         backup, install, restart, health
#   approvers  CONFIRM=SET-APPROVERS APPROVER_EMAILS=a@x,b@y   who is emailed when a recovery email waits for approval
#                                                (also sets RECOVERY_APPROVAL_LINK_BASE to the login-stg page), restart
#   rollback   CONFIRM=ROLLBACK-ADAPTER-V2       restores the v1 recovery dir (src + dist), restart
#   e2e-enroll [TO=address]                      645 enrollment end to end (employee API + login-stg approval page + verifier)
#   e2e-reset  [TO=address]                      password recovery end to end using the ENROLLED email (USE_EXISTING_CONTACT=1)
# Copy first: scp -r ~/Downloads/recov192/adapter apifydev@139.177.200.80:/tmp/recov192/
set -euo pipefail
S=$HOME/stg_login; APP=$S/6.1B; CFG=$S/config.json; STATE=$S/recovery_v192; PKG=/tmp/recov192/adapter
REPO_V1=/srv/arb-system/api/iam/recovery_v192/adapter/src/express/recovery
PM2APP=login-v2-api-staging; B=$STATE/build_adapter_v2
(cd "$PKG" && sha256sum -c --quiet sha.txt) || { echo "adapter files differ from the reviewed copy - stopping"; exit 1; }
need() { [ "${CONFIRM:-}" = "$1" ] || { echo "set CONFIRM=$1"; exit 1; }; }
wait_port() { for _ in $(seq 1 30); do (exec 3<>/dev/tcp/127.0.0.1/$1) 2>/dev/null && return 0; sleep 1; done; return 1; }
health() {
  wait_port 8195 || { echo "!! API not listening"; return 1; }; sleep 2
  echo "   GET /api/v1/auth/ready -> $(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:8195/api/v1/auth/ready)"
  echo "   GET /api/v1/auth/recovery-email (no session) -> $(curl -s -w ' %{http_code}' http://127.0.0.1:8195/api/v1/auth/recovery-email)   (expect SESSION_INVALID 401)"
  echo "   GET /api/v1/auth/password-recovery/invitation/context -> $(curl -s -w ' %{http_code}' 'http://127.0.0.1:8195/api/v1/auth/password-recovery/invitation/context?ref=x')"
  pm2 logs "$PM2APP" --lines 20 --nostream --raw 2>/dev/null | grep -E 'password recovery mounted|fatal|startup failed' | tail -2 | sed 's/^/   log: /' || true
}
v1_ok() { [ -d "$REPO_V1" ] && diff -rq "$APP/src/express/recovery" "$REPO_V1" >/dev/null; }
cfg_set() {
  cp -p "$CFG" "$STATE/config.json.bak-$(date -u +%Y%m%dT%H%M%SZ)"
  CFGF="$CFG" node -e 'const fs=require("fs"),f=process.env.CFGF,c=JSON.parse(fs.readFileSync(f,"utf8"));
    for(const kv of process.argv.slice(1)){const i=kv.indexOf("=");c.api[kv.slice(0,i)]=kv.slice(i+1);}
    fs.writeFileSync(f+".tmp",JSON.stringify(c,null,2)+"\n",{mode:0o600});fs.renameSync(f+".tmp",f);' "$@"
}

case "${1:-}" in
check)
  v1_ok && echo "ok live recovery dir == committed v1 (iam/recovery_v192/adapter)" || echo "!! live recovery dir differs from the committed v1"
  [ -f "$APP/src/express/recovery/recoveryEnrollmentRoutes.ts" ] && echo "v2 already live" || echo "v2 not live yet"
  node -e 'const a=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).api;console.log("   config: enabled="+a.RECOVERY_ENABLED+" delivery="+a.RECOVERY_DELIVERY_MODE+" approvers="+((a.RECOVERY_APPROVER_EMAILS||"").split(",").filter(Boolean).length)+" approval_link="+(a.RECOVERY_APPROVAL_LINK_BASE||"-"))' "$CFG" ;;

build)
  v1_ok || { echo "live recovery dir is not the committed v1 - stopping"; exit 1; }
  rm -rf "$B"; mkdir -p "$B"
  ( cd "$APP" && tar --exclude=./node_modules --exclude=./dist.candidate -cf - . ) | ( cd "$B" && tar -xf - ); ln -s "$APP/node_modules" "$B/node_modules"
  rm -rf "$B/src/express/recovery"; cp -a "$PKG/src/express/recovery" "$B/src/express/"
  (cd "$B" && ./node_modules/.bin/tsc -p tsconfig.json --noEmit && ./node_modules/.bin/tsc -p tsconfig.json --outDir dist.candidate) \
    || { (cd "$B" && ./node_modules/.bin/tsc -p tsconfig.json --noEmit | head -20); exit 1; }
  echo "ok compiled with the server's tsc"
  echo "== changed compiled files (expect only express/recovery/*: config, delivery, install, workers changed + new recoveryEnrollmentRoutes.js)"
  (cd "$B/dist.candidate" && find . -name '*.js' | sort | while read -r f; do if [ ! -f "$APP/dist/$f" ]; then echo "   new     $f"; elif ! cmp -s "$f" "$APP/dist/$f"; then echo "   changed $f"; fi; done)
  echo "BUILD DONE (nothing live changed)" ;;

deploy)
  need DEPLOY-ADAPTER-V2
  [ -f "$B/dist.candidate/express/recovery/recoveryEnrollmentRoutes.js" ] || { echo "run build first"; exit 1; }
  v1_ok || { echo "live recovery dir changed since build - stopping"; exit 1; }
  BK="$STATE/adapter_v1_backup-$(date -u +%Y%m%dT%H%M%SZ)"; mkdir -p "$BK"
  cp -a "$APP/src/express/recovery" "$BK/src"; cp -a "$APP/dist/express/recovery" "$BK/dist"; echo "$BK" > "$STATE/last_adapter_v2_backup"
  rm -rf "$APP/src/express/recovery"; cp -a "$B/src/express/recovery" "$APP/src/express/"
  rm -rf "$APP/dist/express/recovery"; cp -a "$B/dist.candidate/express/recovery" "$APP/dist/express/"; chmod 644 "$APP/dist/express/recovery/"*.js
  echo "backup: $BK"; pm2 restart "$PM2APP" >/dev/null; health; echo "DEPLOYED adapter v2" ;;

approvers)
  need SET-APPROVERS
  [ -n "${APPROVER_EMAILS:-}" ] || { echo "set APPROVER_EMAILS=a@example.com[,b@example.com]"; exit 1; }
  echo "$APPROVER_EMAILS" | tr ',' '\n' | grep -vqE '^[^@ ]+@[^@ ]+\.[^@ ]+$' && { echo "an address looks wrong - stopping"; exit 1; }
  cfg_set "RECOVERY_APPROVER_EMAILS=$APPROVER_EMAILS" RECOVERY_APPROVAL_LINK_BASE=https://login-stg.tcdsolutionsgroup.com/approve/recovery/
  pm2 restart "$PM2APP" >/dev/null; health ;;

rollback)
  need ROLLBACK-ADAPTER-V2; BK=$(cat "$STATE/last_adapter_v2_backup" 2>/dev/null || true); [ -n "$BK" ] && [ -d "$BK" ] || { echo "no backup recorded"; exit 1; }
  rm -rf "$APP/src/express/recovery" "$APP/dist/express/recovery"; cp -a "$BK/src" "$APP/src/express/recovery"; cp -a "$BK/dist" "$APP/dist/express/recovery"
  pm2 restart "$PM2APP" >/dev/null; health; v1_ok && echo "ROLLED BACK to v1 ($BK)" ;;
e2e-enroll|e2e-reset)
  cd /srv/arb-system/api
  eval "$(grep -E '^(PGHOST|PGPORT|PGDATABASE|PGUSER|PGPASSWORD|PGSSLMODE)=' .env | sed -E "s/^([A-Z_]+)=(.*)$/export \1='\2'/")"
  export PGHOST=db.kqcdqtazcqaawdkmcfed.supabase.co PGPORT=5432 PGDATABASE=postgres PGUSER=postgres
  if [ "$1" = e2e-enroll ]; then LOGINV2_CONFIG="$CFG" LOGINV2_6_1B="$APP" TO="${TO:-}" node "$PKG/harness/stg_enroll_e2e.cjs"
  else USE_EXISTING_CONTACT=1 LOGINV2_CONFIG="$CFG" LOGINV2_6_1B="$APP" RECOVERY_STATE="$STATE" TO="${TO:-}" node "$PKG/harness/stg_recovery_e2e.cjs"; fi ;;
*) sed -n '2,14p' "$0"; exit 2 ;;
esac
