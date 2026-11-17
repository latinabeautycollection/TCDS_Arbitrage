#!/usr/bin/env bash
# Deploys the Pack/Ship routes (packship_routes_v16) into the production Login V2 host (PM2 login-v2-api, :8095).
#   preflight  no live change: stages a CANDIDATE copy (patched host + compiled routes) and runs it on 127.0.0.1:8097
#              with production's config (port overridden), probes it, stops it. Run first.
#   apply      CONFIRM=DEPLOY-PACKSHIP-ROUTES: back up the live host, install candidate, pm2 reload login-v2-api, probe
#              :8095. Any failed probe -> automatic restore of the old host + reload.
#   nginx      CONFIRM=NGINX-PACKSHIP (sudo): route /api/v1/packing/ and /api/v1/shipments/ to :8095 (same proxy
#              settings as /api/v1/auth/), and any other /api/ path -> JSON 404 instead of the PWA page.
#              nginx -t gate; restore on failure; public probes after reload.
#   rollback   CONFIRM=ROLLBACK-PACKSHIP-ROUTES: restore the newest host backup, reload, probe sign-in.
#   nginx-rollback CONFIRM=ROLLBACK-NGINX-PACKSHIP (sudo): restore the newest vhost backup, nginx -t, reload.
#   status     read only: host version, mount log line, probes on :8095.
# Prints no secrets (config values are never echoed; the candidate config copy is shredded).
# Usage: bash /tmp/domain6_scanner/packship_routes_v16/deploy_packship_routes.sh <mode>
set -uo pipefail
PKG=$(cd "$(dirname "$0")" && pwd)
LV=/srv/arb-system/loginv2_runtime
B=$LV/build/6.1B
HOST=$LV/runtime/identity-api-host.cjs
CAND=$LV/candidate
VHOST=/etc/nginx/sites-enabled/warehouse-app.tcdsolutionsgroup.com
PUBLIC=https://warehouse-app.tcdsolutionsgroup.com
ORIG_HOST_SHA16=1264a0a0a203919c          # the deployed host before this change (inspect_loginv2.sh, 2026-11-17)
SUMS_SHA=e7535256ae3b254899df5c96a0e79fa62830d6aedad948d63e20100380416be7
UUID=00000000-0000-4000-8000-000000000000
umask 077

[ "$(sha256sum "$PKG/SHA256SUMS" | cut -d' ' -f1)" = "$SUMS_SHA" ] || { echo "SHA256SUMS is not the reviewed one - stopping"; exit 1; }
( cd "$PKG" && sha256sum -c --quiet SHA256SUMS ) || { echo "package files differ from SHA256SUMS - stopping"; exit 1; }
ORIGIN=$(node -e 'process.stdout.write(require(process.argv[1]).api.PUBLIC_APP_ORIGIN)' "$LV/config.json")

FAILS=0
# probe <label> <expected status> <expected body (exact, or ~substring)> <curl args...>
probe() {
  local label=$1 want=$2 wantbody=$3; shift 3
  local out code body ok=1
  out=$(curl -s -m 10 -w $'\n%{http_code}' "$@" 2>/dev/null); code=${out##*$'\n'}; body=${out%$'\n'*}
  [ "$code" = "$want" ] || ok=0
  if [ -n "$wantbody" ]; then
    if [ "${wantbody:0:1}" = "~" ]; then [[ "$body" == *"${wantbody:1}"* ]] || ok=0; else [ "$body" = "$wantbody" ] || ok=0; fi
  fi
  [ $ok = 1 ] && echo "PASS $label ($code ${body:0:80})" || { echo "FAIL $label (got $code ${body:0:120}; want $want $wantbody)"; FAILS=$((FAILS+1)); }
}
probes() {   # $1 = base URL
  local u=$1
  probe "P1 sign-in API unchanged: GET /api/v1/auth/session -> 401" 401 '~"SESSION_INVALID"' "$u/api/v1/auth/session"
  probe "P2 GET /api/v1/auth/bootstrap -> 200" 200 '~passwordEnabled' "$u/api/v1/auth/bootstrap"
  probe "P3 task without cookie -> 401 {code}" 401 '{"code":"PACKSHIP_SESSION_INVALID"}' "$u/api/v1/packing/tasks/$UUID"
  probe "P4 task with an unknown session cookie -> 401" 401 '{"code":"PACKSHIP_SESSION_INVALID"}' -H "Cookie: __Host-tcds_session=not-a-session" "$u/api/v1/packing/tasks/$UUID"
  probe "P5 claim from another origin -> 403" 403 '{"code":"REQUEST_REJECTED"}' -X POST -H 'Origin: https://evil.example' -H 'Content-Type: application/json' -d '{}' "$u/api/v1/packing/tasks/$UUID/claim"
  probe "P6 claim with session cookie but no CSRF -> 403" 403 '{"code":"CSRF_REJECTED"}' -X POST -H "Origin: $ORIGIN" -H 'Content-Type: application/json' -H "Cookie: __Host-tcds_session=not-a-session" -d '{}' "$u/api/v1/packing/tasks/$UUID/claim"
  probe "P7 claim with a CSRF token the database rejects -> 403" 403 '{"code":"CSRF_REJECTED"}' -X POST -H "Origin: $ORIGIN" -H 'Content-Type: application/json' -H "Cookie: __Host-tcds_session=not-a-session; __Host-tcds_csrf=not-a-token" -H 'x-csrf-token: not-a-token' -d '{}' "$u/api/v1/packing/tasks/$UUID/claim"
  probe "P8 outbound-stage without session -> 401" 401 '{"code":"PACKSHIP_SESSION_INVALID"}' -X POST -H "Origin: $ORIGIN" -H 'Content-Type: application/json' -d '{}' "$u/api/v1/shipments/$UUID/outbound-stage"
  probe "P9 unknown Pack/Ship path -> 404 {code}" 404 '{"code":"NOT_FOUND"}' "$u/api/v1/packing/nope"
}
host_known() {   # live host is the original, or this package's own host (an update of the routes only)
  local h; h=$(sha256sum "$HOST" | cut -c1-16)
  [ "$h" = "$ORIG_HOST_SHA16" ] || [ "$h" = "$(sha256sum "$PKG/host/identity-api-host.cjs" | cut -c1-16)" ]
}
restore_apply() {  # $1 = apply timestamp: put back the host file AND the routes directory from before that apply
  cp -p "$HOST.bak-packship-$1" "$HOST"
  rm -rf "$LV/packship"
  [ -e "$LV/packship.bak-$1" ] && mv "$LV/packship.bak-$1" "$LV/packship"
  return 0
}
wait_listen() {  # $1 port, $2 seconds
  for _ in $(seq 1 "$2"); do curl -s -m 2 -o /dev/null "http://127.0.0.1:$1/api/v1/auth/bootstrap" && return 0; sleep 1; done; return 1
}

case "${1:-}" in
preflight)
  echo "== preflight (no live change)"
  host_known || { echo "live host is neither the original nor this package's host - stopping"; exit 1; }
  node -e 'const c=require(process.argv[1]);if(!c.packship||!c.packship.DATABASE_URL)throw Error("config.json has no packship.DATABASE_URL (run packship_login.sh create)")' "$LV/config.json" || exit 1
  node -e 'const s=require(process.argv[1]);const need=["requestIds","securityHeaders","noStore","exactOrigin","fetchMetadataGuard","requireCsrf","cookie"];
    const miss=need.filter(k=>typeof s[k]!=="function");if(miss.length)throw Error("6.1B security.js lacks: "+miss);console.log("6.1B security exports: ok")' "$B/dist/express/security" || exit 1
  for m in express pg; do echo "6.1B $m $(node -e "console.log(require('$B/node_modules/$m/package.json').version)")"; done
  ss -ltn | grep -q '127.0.0.1:8097 ' && { echo "port 8097 is busy - stopping"; exit 1; }
  rm -rf "$CAND"; mkdir -p "$CAND/runtime" "$CAND/packship"
  cp -R "$PKG/dist" "$CAND/packship/dist"; ln -s "$B/node_modules" "$CAND/packship/node_modules"
  cp "$PKG/host/identity-api-host.cjs" "$CAND/runtime/identity-api-host.cjs"
  node -e 'const fs=require("fs"),c=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));c.api.PORT="8097";c.api.HOST="127.0.0.1";
    fs.writeFileSync(process.argv[2],JSON.stringify(c),{mode:0o600})' "$LV/config.json" "$CAND/config.json"
  LOG=$CAND/candidate.log
  ( cd "$LV" && NODE_ENV=production LOGINV2_CONFIG="$CAND/config.json" LOGINV2_6_1B="$B" LOGINV2_HOME="$LV" \
      exec node "$CAND/runtime/identity-api-host.cjs" ) > "$LOG" 2>&1 &
  PID=$!
  trap 'kill $PID 2>/dev/null; shred -u "$CAND/config.json" 2>/dev/null' EXIT
  if ! wait_listen 8097 20; then echo "candidate did not start; log (levels/messages only):"; grep -oE '"(level|msg|error)":"[^"]*"' "$LOG" | head -20; exit 1; fi
  grep -q '"msg":"packship routes mounted"' "$LOG" && echo "candidate: packship routes mounted" || { echo "FAIL candidate did not mount packship"; FAILS=$((FAILS+1)); }
  probes http://127.0.0.1:8097
  kill $PID 2>/dev/null; wait $PID 2>/dev/null; shred -u "$CAND/config.json"; trap - EXIT
  echo "candidate stopped; candidate config shredded"
  [ $FAILS = 0 ] && { echo "PREFLIGHT PASSED - candidate staged at $CAND"; date -u +%s > "$CAND/PREFLIGHT_OK"; } || { echo "PREFLIGHT FAILED ($FAILS)"; exit 1; } ;;

apply)
  [ "${CONFIRM:-}" = "DEPLOY-PACKSHIP-ROUTES" ] || { echo "set CONFIRM=DEPLOY-PACKSHIP-ROUTES"; exit 1; }
  [ -f "$CAND/PREFLIGHT_OK" ] || { echo "run preflight first"; exit 1; }
  [ $(( $(date -u +%s) - $(cat "$CAND/PREFLIGHT_OK") )) -lt 3600 ] || { echo "preflight is older than 1 hour - run it again"; exit 1; }
  host_known || { echo "live host is neither the original nor this package's host - stopping"; exit 1; }
  TS=$(date -u +%Y%m%dT%H%M%SZ)
  cp -p "$HOST" "$HOST.bak-packship-$TS"
  [ -e "$LV/packship" ] && mv "$LV/packship" "$LV/packship.bak-$TS"
  mkdir -p "$LV/packship"; cp -R "$CAND/packship/dist" "$LV/packship/dist"; ln -s "$B/node_modules" "$LV/packship/node_modules"
  cp "$CAND/runtime/identity-api-host.cjs" "$HOST"
  echo "$TS" > "$LV/.packship_last_apply"
  echo "installed; host backup $HOST.bak-packship-$TS$( [ -e "$LV/packship.bak-$TS" ] && echo ", routes backup $LV/packship.bak-$TS")"
  pm2 reload login-v2-api >/dev/null 2>&1; sleep 2
  if wait_listen 8095 25; then probes http://127.0.0.1:8095; else echo "FAIL login-v2-api did not come back"; FAILS=1; fi
  if pm2 logs login-v2-api --nostream --lines 40 2>/dev/null | grep -q '"msg":"packship routes mounted"'; then echo "PASS log: packship routes mounted"
  else echo "FAIL log line 'packship routes mounted' not found"; FAILS=$((FAILS+1)); fi
  if [ $FAILS != 0 ]; then
    echo "!! $FAILS failed - restoring the previous host and routes"
    restore_apply "$TS"; pm2 reload login-v2-api >/dev/null 2>&1; sleep 2
    FAILS=0; wait_listen 8095 25 && probe "R1 sign-in after restore" 401 '~"SESSION_INVALID"' http://127.0.0.1:8095/api/v1/auth/session
    echo "RESTORED (sign-in probe failures: $FAILS)"; exit 1
  fi
  echo "APPLY PASSED - Pack/Ship live on :8095 (nginx not routed yet: run 'nginx')" ;;

nginx)
  [ "${CONFIRM:-}" = "NGINX-PACKSHIP" ] || { echo "set CONFIRM=NGINX-PACKSHIP"; exit 1; }
  grep -q 'location ^~ /api/v1/packing/' "$VHOST" && { echo "vhost already routes /api/v1/packing/ - stopping"; exit 1; }
  TS=$(date -u +%Y%m%dT%H%M%SZ); BK=/etc/nginx/vhost-backups/warehouse-app.bak-packship-$TS
  sudo mkdir -p /etc/nginx/vhost-backups && sudo cp -p "$(readlink -f "$VHOST")" "$BK" || exit 1
  NEW=$(mktemp); sudo cat "$VHOST" | python3 -I -c '
import sys,re
s=sys.stdin.read()
m=re.search(r"( *)location \^~ /api/v1/auth/ \{.*?\n\1\}\n", s, re.S)
if not m: sys.exit("auth location block not found")
auth=m.group(0); ind=m.group(1)
add=auth.replace("/api/v1/auth/","/api/v1/packing/")+auth.replace("/api/v1/auth/","/api/v1/shipments/")
add+=ind+"location ^~ /api/ {\n"+ind+"    default_type application/json;\n"+ind+"    add_header Cache-Control \"no-store\" always;\n"+ind+"    return 404 \x27{\"code\":\"NOT_FOUND\"}\x27;\n"+ind+"}\n"
i=s.index(ind+"location / {")
sys.stdout.write(s[:i]+add+s[i:])' > "$NEW" || { rm -f "$NEW"; echo "vhost edit failed - nothing changed"; exit 1; }
  echo "--- vhost diff"; diff -u "$BK" "$NEW" | sed -n '1,60p'
  sudo cp "$NEW" "$(readlink -f "$VHOST")"; rm -f "$NEW"
  if ! sudo nginx -t 2>&1 | tail -2; then :; fi
  if ! sudo nginx -t >/dev/null 2>&1; then sudo cp -p "$BK" "$(readlink -f "$VHOST")"; echo "nginx -t FAILED - vhost restored, not reloaded"; exit 1; fi
  sudo systemctl reload nginx && echo "nginx reloaded; backup $BK"; sleep 1
  probe "N1 public sign-in unchanged" 401 '~"SESSION_INVALID"' "$PUBLIC/api/v1/auth/session"
  probe "N2 public Pack/Ship task without session -> 401 JSON" 401 '{"code":"PACKSHIP_SESSION_INVALID"}' "$PUBLIC/api/v1/packing/tasks/$UUID"
  probe "N3 public shipments path reaches :8095" 401 '{"code":"PACKSHIP_SESSION_INVALID"}' -X POST -H "Origin: $ORIGIN" -H 'Content-Type: application/json' -d '{}' "$PUBLIC/api/v1/shipments/$UUID/outbound-stage"
  probe "N4 unserved /api path -> JSON 404, not the PWA page" 404 '{"code":"NOT_FOUND"}' "$PUBLIC/api/v1/health"
  probe "N5 PWA itself still served" 200 '' "$PUBLIC/"
  probe "N6 IAM admin path unchanged (not the JSON catch-all)" 401 '' "$PUBLIC/api/v1/iam/admin/overview"
  [ $FAILS = 0 ] && echo "NGINX PASSED" || echo "NGINX: $FAILS probe(s) failed - review; restore with: CONFIRM=ROLLBACK-NGINX-PACKSHIP bash $0 nginx-rollback" ;;

rollback)
  [ "${CONFIRM:-}" = "ROLLBACK-PACKSHIP-ROUTES" ] || { echo "set CONFIRM=ROLLBACK-PACKSHIP-ROUTES"; exit 1; }
  TS=$(cat "$LV/.packship_last_apply" 2>/dev/null); [ -n "$TS" ] && [ -f "$HOST.bak-packship-$TS" ] || { echo "no recorded last apply to undo"; exit 1; }
  restore_apply "$TS"; rm -f "$LV/.packship_last_apply"; pm2 reload login-v2-api >/dev/null 2>&1; sleep 2
  wait_listen 8095 25 && probe "sign-in after rollback" 401 '~"SESSION_INVALID"' http://127.0.0.1:8095/api/v1/auth/session
  echo "undid the apply of $TS: host and routes restored to what they were before it" ;;

nginx-rollback)
  [ "${CONFIRM:-}" = "ROLLBACK-NGINX-PACKSHIP" ] || { echo "set CONFIRM=ROLLBACK-NGINX-PACKSHIP"; exit 1; }
  BK=$(sudo ls -t /etc/nginx/vhost-backups/ 2>/dev/null | grep 'warehouse-app.bak-packship-' | head -1); [ -n "$BK" ] || { echo "no vhost backup"; exit 1; }
  sudo cp -p "/etc/nginx/vhost-backups/$BK" "$(readlink -f "$VHOST")" && sudo nginx -t >/dev/null 2>&1 && sudo systemctl reload nginx && echo "vhost restored from $BK" ;;

status)
  echo "live host sha16: $(sha256sum "$HOST" | cut -c1-16) (original $ORIG_HOST_SHA16, package $(sha256sum "$PKG/host/identity-api-host.cjs" | cut -c1-16))"
  pm2 logs login-v2-api --nostream --lines 60 2>/dev/null | grep -oE '"msg":"(packship routes mounted|login v2 identity api listening|startup failed|packship pg pool error)"' | sort | uniq -c
  probes http://127.0.0.1:8095; echo "failed: $FAILS" ;;

*) echo "usage: $0 preflight|apply|nginx|rollback|nginx-rollback|status"; exit 2 ;;
esac
