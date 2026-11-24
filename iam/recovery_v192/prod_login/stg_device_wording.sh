#!/usr/bin/env bash
# STAGING ONLY. Passkey enrollment page wording: "laptop" -> "device" (a passkey can live on a phone, tablet or computer).
# Text-only change in ~/stg_login/6.1B/src/express/centralEnrollment.ts (6 user-facing strings), compiled with the
# server's tsc; only dist/express/centralEnrollment.js may change. Production then picks it up via prod_login_deploy.sh build.
#   check     read-only: each old string present exactly once
#   apply     CONFIRM=APPLY-DEVICE-WORDING: backup, edit, compile, swap the one js file, restart staging API, smoke
#   rollback  CONFIRM=ROLLBACK-DEVICE-WORDING
set -euo pipefail
S=$HOME/stg_login; A=$S/6.1B; F=src/express/centralEnrollment.ts; ST=$S/recovery_v192; PM2APP=login-v2-api-staging
need() { [ "${CONFIRM:-}" = "$1" ] || { echo "set CONFIRM=$1"; exit 1; }; }
edit() { # $1 = check|apply, $2 = file
  MODE=$1 node - "$2" <<'JS'
const fs=require('fs'),f=process.argv[2];let s=fs.readFileSync(f,'utf8');
const R=[
 ["Your passkey stays on this laptop, unlocked by your fingerprint, face or device PIN.",
  "Your passkey is saved on this device (phone, tablet or computer) and unlocked by your fingerprint, face or device PIN."],
 ["<h2>Register this laptop</h2>","<h2>Register this device</h2>"],
 ["your laptop asks for your fingerprint","your device asks for your fingerprint"],
 ["Safari, Chrome or Edge on your laptop.","Safari, Chrome or Edge on your phone or computer."],
 ["Follow your laptop\\\\'s prompt","Follow your device\\\\'s prompt"],
 ["This laptop already has a TCDS passkey","This device already has a TCDS passkey"]];
let bad=0;
for(const [a,b] of R){const n=s.split(a).length-1;console.log(`   ${n===1?'ok':'!!'} ${n}x "${a.slice(0,48)}"`);if(n!==1)bad++;else s=s.replace(a,b);}
if(bad){console.log('   strings not as expected - nothing changed');process.exit(1);}
const left=(s.match(/laptop/gi)||[]).length;console.log(`   "laptop" left in the file: ${left} (comments only)`);
if(process.env.MODE==='apply')fs.writeFileSync(f,s);
JS
}
case "${1:-}" in
check) edit check "$A/$F" ;;
apply)
  need APPLY-DEVICE-WORDING
  edit check "$A/$F" >/dev/null || { edit check "$A/$F"; exit 1; }
  BK="$ST/wording_backup-$(date -u +%Y%m%dT%H%M%SZ)"; mkdir -p "$BK"
  cp -p "$A/$F" "$BK/centralEnrollment.ts"; cp -p "$A/dist/express/centralEnrollment.js" "$BK/centralEnrollment.js"; echo "$BK" > "$ST/last_wording_backup"
  B=$ST/build_wording; rm -rf "$B"; mkdir -p "$B"
  (cd "$A" && tar --exclude=./node_modules --exclude=./dist.candidate -cf - .) | (cd "$B" && tar -xf -); ln -s "$A/node_modules" "$B/node_modules"
  edit apply "$B/$F"
  (cd "$B" && ./node_modules/.bin/tsc -p tsconfig.json --noEmit && ./node_modules/.bin/tsc -p tsconfig.json --outDir dist.candidate) || exit 1
  CH=$(cd "$B/dist.candidate" && find . -name '*.js' | sort | while read -r f; do cmp -s "$f" "$A/dist/$f" || echo "$f"; done)
  [ "$CH" = "./express/centralEnrollment.js" ] || { echo "!! unexpected compiled changes: $CH - nothing installed"; exit 1; }
  cp -p "$B/$F" "$A/$F"; cp "$B/dist.candidate/express/centralEnrollment.js" "$A/dist/express/centralEnrollment.js"; chmod 644 "$A/dist/express/centralEnrollment.js"
  pm2 restart "$PM2APP" >/dev/null; for _ in $(seq 1 30); do (exec 3<>/dev/tcp/127.0.0.1/8198) 2>/dev/null && break; sleep 1; done; sleep 2
  P=$(curl -s http://127.0.0.1:8198/enroll/); J=$(curl -s http://127.0.0.1:8198/enroll/assets/enroll.js)
  echo "   /enroll/ $(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:8198/enroll/) | 'Register this device': $(grep -c 'Register this device' <<< "$P") | 'laptop' on page+script: $( { echo "$P"; echo "$J"; } | grep -ci laptop || true)"
  echo "   /approve/recovery/ $(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:8198/approve/recovery/) | api /ready $(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:8195/api/v1/auth/ready)"
  echo "APPLIED ON STAGING (backup $BK)" ;;
rollback)
  need ROLLBACK-DEVICE-WORDING; BK=$(cat "$ST/last_wording_backup"); cp -p "$BK/centralEnrollment.ts" "$A/$F"; cp -p "$BK/centralEnrollment.js" "$A/dist/express/centralEnrollment.js"
  pm2 restart "$PM2APP" >/dev/null; echo "rolled back ($BK)" ;;
*) sed -n '2,8p' "$0"; exit 2 ;;
esac
