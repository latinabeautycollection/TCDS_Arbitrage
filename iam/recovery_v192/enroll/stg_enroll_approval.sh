#!/usr/bin/env bash
# STAGING ONLY. Recovery-email approval (TCDS 645) on the login-stg approval page:
#   6.1C verifier   + src/central/centralRecoveryContacts.ts, centralRoutes.ts patched (/recovery-contact-approval/*)
#   6.1B API host   centralEnrollment.ts + centralVerifierClient.ts patched (/approve/recovery/ page + /approve/api/recovery/*)
# The existing binding (?r=) and grant (?g=) approval pages are not changed.
#   check                                     read-only: live files are the expected base versions; services up
#   build                                     candidates in temp copies with each app's own tsc; lists changed files; nothing live changes
#   deploy    CONFIRM=DEPLOY-RECOVERY-APPROVAL backups, installs, restarts verifier then API, smoke checks
#   smoke                                     read-only: page served; info for an unknown enrollment answers NOT_FOUND through the whole chain
#   rollback  CONFIRM=ROLLBACK-RECOVERY-APPROVAL restores both backups, restarts
# Copy first: scp -r ~/Downloads/recov192/enroll apifydev@139.177.200.80:/tmp/recov192/
set -euo pipefail
S=$HOME/stg_login; C61=$S/6.1C; B61=$S/6.1B; P=/tmp/recov192/enroll; STATE=$S/recovery_v192
VAPP=login-v2-verifier-staging; AAPP=login-v2-api-staging; ENROLL_PORT=8198
SHA_ROUTES=2d220f00e8f1f7d84c689ea347f58face8479c45ac2ed6a273c89b92db47e002
SHA_ENROLL=3d6e27278c2bd243ceff063a194d3d8771570ecb8bbae480c5cc2e7c883618aa
SHA_CLIENT=4d0e7159d2383c24e1484f12fb42f59eac0c66edb8e85d8777092ff96154470e
(cd "$P" && sha256sum -c --quiet sha.txt) && echo "package files: sha256 ok"
sha() { sha256sum "$1" | cut -d' ' -f1; }
wait_port() { for _ in $(seq 1 30); do (exec 3<>/dev/tcp/127.0.0.1/$1) 2>/dev/null && return 0; sleep 1; done; return 1; }
copy_tree() { ( cd "$1" && tar --exclude=./node_modules --exclude=./dist.candidate -cf - . ) | ( cd "$2" && tar -xf - ); ln -s "$1/node_modules" "$2/node_modules"; }
build_tree() { ( cd "$1" && ./node_modules/.bin/tsc -p tsconfig.json --noEmit && ./node_modules/.bin/tsc -p tsconfig.json --outDir dist.candidate ); }
base_ok() {
  local ok=0
  [ "$(sha "$C61/src/central/centralRoutes.ts")" = $SHA_ROUTES ] && echo "ok 6.1C centralRoutes.ts is the 630 base" || { echo "!! 6.1C centralRoutes.ts differs from the base"; ok=1; }
  [ "$(sha "$B61/src/express/centralEnrollment.ts")" = $SHA_ENROLL ] && echo "ok 6.1B centralEnrollment.ts is the base" || { echo "!! 6.1B centralEnrollment.ts differs from the base"; ok=1; }
  [ "$(sha "$B61/src/express/centralVerifierClient.ts")" = $SHA_CLIENT ] && echo "ok 6.1B centralVerifierClient.ts is the base" || { echo "!! 6.1B centralVerifierClient.ts differs from the base"; ok=1; }
  [ ! -e "$C61/src/central/centralRecoveryContacts.ts" ] && echo "ok no recovery approval in the verifier yet" || { echo "!! centralRecoveryContacts.ts already present"; ok=1; }
  return $ok
}
diff_list() { (cd "$1/dist.candidate" && find . -name '*.js' | sort | while read -r f; do
  if [ ! -f "$2/dist/$f" ]; then echo "   new     $f"; elif ! cmp -s "$f" "$2/dist/$f"; then echo "   changed $f"; fi; done); }
smoke() {
  echo "   GET  :$ENROLL_PORT/approve/recovery/ -> $(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:$ENROLL_PORT/approve/recovery/)"
  echo "   GET  :$ENROLL_PORT/approve/ (binding page, unchanged) -> $(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:$ENROLL_PORT/approve/)"
  local o; o=$(node -e 'const c=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));console.log("https://"+c.api.CENTRAL_RP_ID)' "$S/config.json")
  echo "   POST :$ENROLL_PORT/approve/api/recovery/info (unknown enrollment) -> $(curl -s -w ' %{http_code}' -H "origin: $o" -H 'sec-fetch-site: same-origin' -H 'content-type: application/json' \
     -d '{"enrollmentId":"00000000-0000-4000-8000-000000000000"}' http://127.0.0.1:$ENROLL_PORT/approve/api/recovery/info)   (expect RECOVERY_CONTACT_ENROLLMENT_NOT_FOUND 403)"
  echo "   GET  :8191/ready/central -> $(curl -s http://127.0.0.1:8191/ready/central)"
}

case "${1:-}" in
check) base_ok || true; echo "   pm2: $(pm2 jlist | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{for(const n of process.argv.slice(1)){const p=JSON.parse(s).find(x=>x.name===n);console.log(n+"="+(p?p.pm2_env.status:"missing"))}})' $VAPP $AAPP | tr '\n' ' ')" ;;

build)
  base_ok || { echo "base versions differ - stopping"; exit 1; }
  rm -rf "$STATE/build_c61" "$STATE/build_b61"; mkdir -p "$STATE/build_c61" "$STATE/build_b61"
  copy_tree "$C61" "$STATE/build_c61"; cp "$P/verifier_6.1C/centralRecoveryContacts.ts" "$STATE/build_c61/src/central/"
  (cd "$STATE/build_c61" && patch -s -p1 < "$P/verifier_6.1C/centralRoutes.patch") && echo "ok verifier patched"
  build_tree "$STATE/build_c61" >/dev/null || { (cd "$STATE/build_c61" && ./node_modules/.bin/tsc -p tsconfig.json --noEmit | head -20); exit 1; }
  echo "ok verifier compiled ($(node -e 'console.log(require(process.argv[1]+"/node_modules/typescript/package.json").version)' "$C61"))"; echo "== verifier: changed compiled files (expect central/centralRoutes.js + new central/centralRecoveryContacts.js)"; diff_list "$STATE/build_c61" "$C61"
  copy_tree "$B61" "$STATE/build_b61"
  (cd "$STATE/build_b61" && patch -s -p1 < "$P/loginv2_6.1B/central_recovery_approval.patch") && echo "ok API host patched"
  build_tree "$STATE/build_b61" >/dev/null || { (cd "$STATE/build_b61" && ./node_modules/.bin/tsc -p tsconfig.json --noEmit | head -20); exit 1; }
  echo "ok API host compiled"; echo "== API host: changed compiled files (expect express/centralEnrollment.js + express/centralVerifierClient.js)"; diff_list "$STATE/build_b61" "$B61"
  echo "BUILD DONE (nothing live changed)" ;;

deploy)
  [ "${CONFIRM:-}" = DEPLOY-RECOVERY-APPROVAL ] || { echo "set CONFIRM=DEPLOY-RECOVERY-APPROVAL"; exit 1; }
  [ -f "$STATE/build_c61/dist.candidate/central/centralRecoveryContacts.js" ] && [ -f "$STATE/build_b61/dist.candidate/express/centralEnrollment.js" ] || { echo "run build first"; exit 1; }
  base_ok >/dev/null || { echo "live files changed since build - stopping"; exit 1; }
  BK="$STATE/approval_backup-$(date -u +%Y%m%dT%H%M%SZ)"; mkdir -p "$BK/c61/src" "$BK/c61/dist" "$BK/b61/src" "$BK/b61/dist"
  cp -p "$C61/src/central/centralRoutes.ts" "$BK/c61/src/"; cp -p "$C61/dist/central/centralRoutes.js" "$BK/c61/dist/"
  for f in centralEnrollment centralVerifierClient; do cp -p "$B61/src/express/$f.ts" "$BK/b61/src/"; cp -p "$B61/dist/express/$f.js" "$BK/b61/dist/"; done
  echo "$BK" > "$STATE/last_approval_backup"
  for f in centralRoutes centralRecoveryContacts; do cp "$STATE/build_c61/src/central/$f.ts" "$C61/src/central/"; cp "$STATE/build_c61/dist.candidate/central/$f.js" "$C61/dist/central/"; chmod 644 "$C61/dist/central/$f.js"; done
  for f in centralEnrollment centralVerifierClient; do cp "$STATE/build_b61/src/express/$f.ts" "$B61/src/express/"; cp "$STATE/build_b61/dist.candidate/express/$f.js" "$B61/dist/express/"; chmod 644 "$B61/dist/express/$f.js"; done
  echo "backup: $BK"
  pm2 restart "$VAPP" >/dev/null; wait_port 8191 || { echo "!! verifier not listening - roll back with CONFIRM=ROLLBACK-RECOVERY-APPROVAL $0 rollback"; exit 1; }
  pm2 restart "$AAPP" >/dev/null; wait_port 8195 && wait_port $ENROLL_PORT || { echo "!! API listeners not up - roll back with CONFIRM=ROLLBACK-RECOVERY-APPROVAL $0 rollback"; exit 1; }
  sleep 2; smoke; echo "DEPLOYED (approver role still assigned to nobody)" ;;

smoke) smoke ;;

rollback)
  [ "${CONFIRM:-}" = ROLLBACK-RECOVERY-APPROVAL ] || { echo "set CONFIRM=ROLLBACK-RECOVERY-APPROVAL"; exit 1; }
  BK=$(cat "$STATE/last_approval_backup" 2>/dev/null || true); [ -n "$BK" ] && [ -d "$BK" ] || { echo "no backup recorded"; exit 1; }
  cp -p "$BK/c61/src/centralRoutes.ts" "$C61/src/central/"; cp -p "$BK/c61/dist/centralRoutes.js" "$C61/dist/central/"
  rm -f "$C61/src/central/centralRecoveryContacts.ts" "$C61/dist/central/centralRecoveryContacts.js"
  for f in centralEnrollment centralVerifierClient; do cp -p "$BK/b61/src/$f.ts" "$B61/src/express/"; cp -p "$BK/b61/dist/$f.js" "$B61/dist/express/"; done
  pm2 restart "$VAPP" >/dev/null; wait_port 8191; pm2 restart "$AAPP" >/dev/null; wait_port 8195; wait_port $ENROLL_PORT
  base_ok && echo "ROLLED BACK to $BK" ;;
*) sed -n '2,12p' "$0"; exit 2 ;;
esac
