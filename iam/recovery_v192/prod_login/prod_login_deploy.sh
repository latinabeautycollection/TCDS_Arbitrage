#!/usr/bin/env bash
# PRODUCTION login API (6.1B) + verifier (6.1C) upgrade to the code staging runs (item 3/4, central passkeys, recovery
# adapter v2, recovery-email approval page). The Pack/Ship host file (runtime/identity-api-host.cjs) is NOT touched.
#   check                                    read-only: production source is the expected baseline, staging source is the
#                                            expected superset, ports free, nothing configured yet, reset usage
#   build                                    compiles staging's source with production's own tsc in ~/prod_login_build;
#                                            the result must equal staging's running dist byte for byte (nothing live changes)
#   prepare  CONFIRM=PREPARE-PROD-LOGIN      creates the DB login tcds_login_central (password generated here, only its SCRAM
#                                            verifier goes to the DB) and writes a CANDIDATE config (not live): new keys
#                                            generated here, Graph keys copied from staging's config (same sender); recovery OFF
#   deploy   CONFIRM=DEPLOY-PROD-LOGIN       backup -> install code + config -> restart verifier, then API -> health;
#                                            rolls itself back if a health check fails
#   update   CONFIRM=UPDATE-PROD-LOGIN       after deploy: install a newer staging build (code only, live config kept)
#   enable   CONFIRM=ENABLE-RECOVERY         RECOVERY_ENABLED / WORKERS on -> restart API -> health
#   approvers CONFIRM=SET-APPROVERS APPROVER_EMAILS=a@x[,b@y]   who is emailed when a recovery email waits for approval
#   rollback CONFIRM=ROLLBACK-PROD-LOGIN     restores the last backup (code + config) and restarts both
#   status                                   read-only
# Prints no secrets. Copy first (Mac): scp -r ~/Downloads/prod_recovery apifydev@139.177.200.80:/tmp/
set -euo pipefail
P=/srv/arb-system/loginv2_runtime; S=$HOME/stg_login; CFG=$P/config.json; BLD=$HOME/prod_login_build; ST=$HOME/prod_login_state
PKG=/tmp/prod_recovery/login; INTERNAL_PORT=8096; ENROLL_PORT=8098; HOST=login.tcdsolutionsgroup.com
mkdir -p "$ST"; chmod 700 "$ST"; umask 077
(cd "$PKG" && sha256sum -c --quiet sha.txt) || { echo "package files differ from the reviewed copy - stopping"; exit 1; }
need() { [ "${CONFIRM:-}" = "$1" ] || { echo "set CONFIRM=$1"; exit 1; }; }
port_up() { (exec 3<>/dev/tcp/127.0.0.1/$1) 2>/dev/null; }
wait_port() { for _ in $(seq 1 30); do port_up "$1" && return 0; sleep 1; done; return 1; }
db() { ( cd /srv/arb-system/api; eval "$(grep -E '^(PGHOST|PGPORT|PGDATABASE|PGUSER|PGPASSWORD|PGSSLMODE)=' .env | sed -E "s/^([A-Z_]+)=(.*)$/export \1='\2'/")"
  case "$PGHOST $PGUSER" in *vfxlrkqgakqqbnbbgecp*) ;; *) echo "not production" >&2; exit 1;; esac
  PAGER=cat psql -X -q -At -v ON_ERROR_STOP=1 "$@" ); }
# Expected source differences (production -> staging), from the 2026-11-24 inspection.
EXP_B='Files P/config/env.ts and S/config/env.ts differ
Files P/express/integration.ts and S/express/integration.ts differ
Files P/express/registerIdentityRoutes.ts and S/express/registerIdentityRoutes.ts differ
Files P/services/passwordResetService.ts and S/services/passwordResetService.ts differ
Only in S/express: centralEnrollment.ts
Only in S/express: centralVerifierClient.ts
Only in S/express: centralWiring.ts
Only in S/express: internalIamApi.ts
Only in S/express: recovery'
EXP_C='Files P/app.ts and S/app.ts differ
Only in S: central'
srcdiff() { { diff -rq "$P/build/$1/src" "$S/$1/src" || true; } | sed -e "s#$P/build/$1/src#P#g" -e "s#$S/$1/src#S#g" | sort; }
NEWKEYS='api.RECOVERY_MASTER_KEY api.CENTRAL_WORKLOAD_SECRET api.INTERNAL_IAM_API_SECRET verifier.CENTRAL_DATABASE_URL'
cfgkeys() { node -e 'const c=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));for(const s of Object.keys(c))if(c[s]&&typeof c[s]==="object")for(const k of Object.keys(c[s]))console.log(s+"."+k)' "$1"; }
restart_health() { # $1 = config label for messages
  pm2 restart login-v2-verifier >/dev/null; wait_port 8091 || return 1; sleep 2
  local rc; rc=$(curl -s http://127.0.0.1:8091/ready/central || true); echo "   verifier /ready/central -> $rc"
  echo "$rc" | grep -q "\"rpId\":\"$HOST\"" || return 1
  pm2 restart login-v2-api >/dev/null; wait_port 8095 || return 1; sleep 3
  local r; r=$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:8095/api/v1/auth/ready); echo "   api /ready -> $r"; [ "$r" = 200 ] || return 1
  echo "   api /recovery-email (no session) -> $(curl -s -w ' %{http_code}' http://127.0.0.1:8095/api/v1/auth/recovery-email)"
  echo "   api /password-recovery/invitation/context -> $(curl -s -o /dev/null -w '%{http_code}' 'http://127.0.0.1:8095/api/v1/auth/password-recovery/invitation/context?ref=x')"
  echo "   bad password login -> $(curl -s -o /dev/null -w '%{http_code}' -X POST -H 'content-type: application/json' -H 'origin: https://warehouse-app.tcdsolutionsgroup.com' -H 'sec-fetch-site: same-origin' --data '{}' http://127.0.0.1:8095/api/v1/auth/password/login)  (expect 400)"
  wait_port $ENROLL_PORT || { echo "   !! approval/enrollment page :$ENROLL_PORT not listening"; return 1; }
  echo "   approval page :$ENROLL_PORT /approve/recovery/ -> $(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:$ENROLL_PORT/approve/recovery/)"
  port_up $INTERNAL_PORT && echo "   internal IAM API :$INTERNAL_PORT listening (loopback)" || { echo "   !! internal API :$INTERNAL_PORT down"; return 1; }
  pm2 logs login-v2-api --lines 40 --nostream --raw 2>/dev/null | grep -E 'packship routes mounted|password recovery mounted|fatal|startup failed' | tail -3 | sed 's/^/   log: /' || true
  pm2 logs login-v2-api --lines 40 --nostream --raw 2>/dev/null | grep -q 'packship routes mounted' || { echo "   !! Pack/Ship routes not mounted"; return 1; }
}

case "${1:-}" in
status)
  echo "== code: 6.1B recovery dir $([ -d "$P/build/6.1B/src/express/recovery" ] && echo present || echo absent) | 6.1C central dir $([ -d "$P/build/6.1C/src/central" ] && echo present || echo absent)"
  node -e 'const a=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));const x=a.api,v=a.verifier;
    console.log("== config: recovery="+(x.RECOVERY_ENABLED||"-")+" workers="+(x.RECOVERY_WORKERS_ENABLED||"-")+" delivery="+(x.RECOVERY_DELIVERY_MODE||"-")+" approvers="+((x.RECOVERY_APPROVER_EMAILS||"").split(",").filter(Boolean).length)+" central_rp="+(v.CENTRAL_RP_ID||"-"))' "$CFG"
  ls -1d "$ST"/backup-* 2>/dev/null | tail -3 | sed 's/^/   backup: /' || true ;;

check)
  echo "== source"
  [ "$(srcdiff 6.1B)" = "$EXP_B" ] && echo "   ok 6.1B: production -> staging differs exactly by the 9 expected files" || { echo "   !! 6.1B differences are not the expected set:"; srcdiff 6.1B | sed 's/^/      /'; }
  [ "$(srcdiff 6.1C)" = "$EXP_C" ] && echo "   ok 6.1C: differs exactly by app.ts + central/" || { echo "   !! 6.1C differences are not the expected set:"; srcdiff 6.1C | sed 's/^/      /'; }
  for d in 6.1B 6.1C; do cmp -s "$P/build/$d/package.json" "$S/$d/package.json" && echo "   ok $d package.json identical" || echo "   !! $d package.json differs"; done
  [ -f "$S/recovery_deps/node_modules/@simplewebauthn/server/package.json" ] && echo "   ok staging recovery_deps has @simplewebauthn/server $(node -p 'require(process.argv[1]).version' "$S/recovery_deps/node_modules/@simplewebauthn/server/package.json")" || echo "   !! staging recovery_deps missing"
  [ -d "$S/central_assets" ] && echo "   ok staging page assets: $(ls "$S/central_assets" | tr '\n' ' ')" || echo "   !! staging central_assets missing"
  echo "== ports"; for p in $INTERNAL_PORT $ENROLL_PORT; do port_up $p && echo "   !! :$p in use" || echo "   ok :$p free"; done
  echo "== config"; CK=$(cfgkeys "$CFG"); for k in $NEWKEYS; do echo "$CK" | grep -qx "$k" && echo "   !! $k already set" || true; done; echo "   (new keys not set yet unless listed above)"
  echo "   Graph (M365) keys in staging's config (proven sender): $(node -e 'const a=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).api;console.log(["M365_TENANT_ID","M365_CLIENT_ID","M365_CLIENT_SECRET","M365_SENDER"].filter(k=>a[k]).length+" of 4, sender "+(a.M365_SENDER||"-"))' "$S/config.json")"
  echo "   redis: $(redis-cli ping 2>&1 | head -1)"
  echo "== database (read-only)"
  db -c "SELECT '   tcds_login_central exists: '||EXISTS(SELECT 1 FROM pg_roles WHERE rolname='tcds_login_central')"
  db -c "SELECT '   recovery chain installed: '||(to_regclass('warehouse_identity.recovery_contact_policy_v645') IS NOT NULL)"
  db -c "SELECT '   password resets, all time: '||coalesce(string_agg(status||'='||n,', '),'none') FROM (SELECT status, count(*) n FROM warehouse_identity.password_reset_requests GROUP BY 1 ORDER BY 1) x" || echo "   (reset count n/a)"
  db -c "SELECT '   active users: '||count(*) FROM warehouse_identity.users WHERE status='ACTIVE'" || echo "   (user count n/a)"
  echo "CHECK DONE (nothing changed)" ;;

build)
  if [ "$(srcdiff 6.1B)" = "$EXP_B" ] && [ "$(srcdiff 6.1C)" = "$EXP_C" ]; then echo "== first deploy: production is the pre-recovery baseline"
  elif [ -d "$P/build/6.1B/src/express/recovery" ] && ! { srcdiff 6.1B; srcdiff 6.1C; } | grep -qv '^Files P/.* and S/.* differ$'; then
    echo "== update: production already runs this code; staging changed only these files:"; { srcdiff 6.1B; srcdiff 6.1C; } | sed 's/^/   /'
    [ -n "$( { srcdiff 6.1B; srcdiff 6.1C; } )" ] || { echo "   (none - production already equals staging)"; exit 0; }
  else echo "source differences unexpected:"; { srcdiff 6.1B; srcdiff 6.1C; } | sed 's/^/   /'; exit 1; fi
  rm -rf "$BLD"; mkdir -p "$BLD"
  for d in 6.1B 6.1C; do T=$BLD/$d; mkdir -p "$T"
    (cd "$P/build/$d" && tar --exclude=./node_modules --exclude=./dist --exclude=./dist.candidate --exclude=./src -cf - .) | (cd "$T" && tar -xf -)
    cp -a "$S/$d/src" "$T/src"; ln -s "$P/build/$d/node_modules" "$T/node_modules"
    (cd "$T" && ./node_modules/.bin/tsc -p tsconfig.json --noEmit && ./node_modules/.bin/tsc -p tsconfig.json --outDir dist.candidate) \
      || { (cd "$T" && ./node_modules/.bin/tsc -p tsconfig.json --noEmit | head -20); exit 1; }
    echo "== $d compiled with production's tsc ($("$T/node_modules/.bin/tsc" -v))"
    (cd "$T/dist.candidate" && find . -name '*.js' | sort | while read -r f; do
       if [ ! -f "$P/build/$d/dist/$f" ]; then echo "   new     $f"; elif ! cmp -s "$f" "$P/build/$d/dist/$f"; then echo "   changed $f"; fi; done)
    X=$(cd "$P/build/$d/dist" && find . -type f | sort | while read -r f; do [ -e "$T/dist.candidate/$f" ] || echo "$f"; done)
    [ -z "$X" ] || { echo "   !! production dist has files the build does not produce (would be lost):"; echo "$X" | sed 's/^/      /'; exit 1; }
    N=$(cd "$T/dist.candidate" && find . -name '*.js' | sort | while read -r f; do cmp -s "$f" "$S/$d/dist/$f" || echo "$f"; done | wc -l)
    [ "$N" = 0 ] && echo "   ok every compiled file == staging's running dist" || { echo "   !! $N compiled files differ from staging's dist"; exit 1; }
    (cd "$T" && find src dist.candidate -type f | sort | xargs sha256sum) > "$ST/build_$d.sha256"
  done
  (cd "$P/build" && find 6.1B/src 6.1C/src -type f | sort | xargs sha256sum) > "$ST/prod_src_at_build.sha256"
  echo "BUILD DONE (nothing live changed)" ;;

prepare)
  need PREPARE-PROD-LOGIN
  [ -f "$ST/build_6.1B.sha256" ] || { echo "run build first"; exit 1; }
  CK=$(cfgkeys "$CFG"); for k in $NEWKEYS; do echo "$CK" | grep -qx "$k" && { echo "$k already in the live config - stopping"; exit 1; }; done
  [ "$(node -e 'const a=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).api;console.log(["M365_TENANT_ID","M365_CLIENT_ID","M365_CLIENT_SECRET","M365_SENDER"].filter(k=>a[k]).length)' "$S/config.json")" = 4 ] || { echo "Graph keys missing in staging config"; exit 1; }
  if [ "$(db -c "SELECT count(*) FROM pg_roles WHERE rolname='tcds_login_central'")" = 0 ]; then
    PW=$(openssl rand -hex 32)
    VER=$(PW="$PW" node -e 'const c=require("crypto"),pw=process.env.PW,salt=c.randomBytes(16),it=4096;
      const sp=c.pbkdf2Sync(pw,salt,it,32,"sha256"),h=(k,m)=>c.createHmac("sha256",k).update(m).digest();
      const stored=c.createHash("sha256").update(h(sp,"Client Key")).digest();
      process.stdout.write(`SCRAM-SHA-256$${it}:${salt.toString("base64")}$${stored.toString("base64")}:${h(sp,"Server Key").toString("base64")}`)')
    db <<SQL
BEGIN;
CREATE ROLE tcds_login_central LOGIN INHERIT CONNECTION LIMIT 8 PASSWORD '$VER';
GRANT tcds_identity_central_verifier TO tcds_login_central;
ALTER ROLE tcds_login_central SET search_path = pg_catalog;
COMMIT;
SQL
    unset VER; echo "   DB login tcds_login_central created (member of tcds_identity_central_verifier only)"
  else echo "   tcds_login_central already exists - stopping (a password for it cannot be recovered; drop it or rotate it first)"; exit 1; fi
  cp -p "$CFG" "$ST/config.at_prepare.json"; sha256sum "$CFG" | cut -d' ' -f1 > "$ST/config.at_prepare.sha256"
  PW="$PW" STGCFG="$S/config.json" HOST=$HOST IP=$INTERNAL_PORT EP=$ENROLL_PORT P=$P node -e '
    const fs=require("fs"),c=require("crypto"),f=process.argv[1],out=process.argv[2],cfg=JSON.parse(fs.readFileSync(f,"utf8"));
    const env=JSON.parse(fs.readFileSync(process.env.STGCFG,"utf8")).api;   // Graph keys: the same app registration staging sends with
    const hex=()=>c.randomBytes(32).toString("hex"), wl=hex(), H=process.env.HOST;
    const u=new URL(cfg.verifier.WEBAUTHN_DATABASE_URL);u.username="tcds_login_central";u.password=process.env.PW;
    Object.assign(cfg.verifier,{CENTRAL_RP_ID:H,CENTRAL_ORIGIN:"https://"+H,CENTRAL_RP_NAME:"TCDS",CENTRAL_DATABASE_URL:u.toString(),CENTRAL_WORKLOAD_SECRET:wl});
    Object.assign(cfg.api,{INTERNAL_IAM_API_PORT:process.env.IP,INTERNAL_IAM_API_SECRET:hex(),
      EOC_IAM_ISSUER_PASSKEY_KEY:hex(),CENTRAL_OIDC_ISSUER:"https://"+H,CENTRAL_RP_ID:H,CENTRAL_VERIFIER_URL:"http://127.0.0.1:8091",
      CENTRAL_WORKLOAD_SECRET:wl,CENTRAL_SUBJECT_KEY:hex(),CENTRAL_ENROLL_PORT:process.env.EP,CENTRAL_ENROLL_ASSETS_DIR:process.env.P+"/central_assets",
      M365_TENANT_ID:env.M365_TENANT_ID,M365_CLIENT_ID:env.M365_CLIENT_ID,M365_CLIENT_SECRET:env.M365_CLIENT_SECRET,M365_SENDER:env.M365_SENDER,
      RECOVERY_ENABLED:"false",RECOVERY_WORKERS_ENABLED:"false",RECOVERY_MASTER_KEY:hex(),RECOVERY_DELIVERY_MODE:"graph",
      RECOVERY_DEPS_DIR:process.env.P+"/recovery_deps",RECOVERY_TICK_MS:"3000",
      RECOVERY_LINK_BASE:"https://warehouse-app.tcdsolutionsgroup.com/auth/recovery/new-password",
      RECOVERY_APPROVAL_LINK_BASE:"https://"+H+"/approve/recovery/"});
    for(const k of ["M365_TENANT_ID","M365_CLIENT_ID","M365_CLIENT_SECRET","M365_SENDER"])if(!cfg.api[k])throw new Error(k+" empty");
    fs.writeFileSync(out,JSON.stringify(cfg,null,2)+"\n",{mode:0o600});' "$CFG" "$ST/config.candidate.json"
  unset PW
  # the verifier login works through the Node driver exactly as the verifier will connect
  NODE_PATH="$P/build/6.1C/node_modules" node - "$ST/config.candidate.json" <<'NODE'
const {Client}=require("pg"),cfg=require(process.argv[2]);
(async()=>{const c=new Client({connectionString:cfg.verifier.CENTRAL_DATABASE_URL});await c.connect();
 const r=(await c.query(`SELECT current_user u,(SELECT rolsuper OR rolbypassrls FROM pg_roles WHERE rolname=current_user) p,
   has_table_privilege('warehouse_identity.central_passkeys','SELECT') t,
   has_function_privilege('warehouse_identity.central_claim_workload_nonce_v1(bytea,uuid,uuid,timestamptz)','EXECUTE') f`)).rows[0];
 console.log(`   login check: user=${r.u} superuser/bypassrls=${r.p} can read central_passkeys=${r.t} can claim nonce=${r.f}`);
 await c.end();process.exit(r.u==="tcds_login_central"&&!r.p&&!r.t&&r.f?0:1)})().catch(e=>{console.log("   login check FAILED: "+e.message);process.exit(1)});
NODE
  echo "   candidate config written (~/prod_login_state/config.candidate.json, 600), new keys: $(diff <(cfgkeys "$CFG" | sort) <(cfgkeys "$ST/config.candidate.json" | sort) | grep -c '^>')"
  echo "PREPARED (live code and live config unchanged)" ;;

deploy)
  need DEPLOY-PROD-LOGIN
  [ -f "$ST/config.candidate.json" ] || { echo "run prepare first"; exit 1; }
  [ "$(sha256sum "$CFG" | cut -d' ' -f1)" = "$(cat "$ST/config.at_prepare.sha256")" ] || { echo "live config changed since prepare - stopping"; exit 1; }
  (cd "$P/build" && sha256sum -c --quiet "$ST/prod_src_at_build.sha256") || { echo "production source changed since build - stopping"; exit 1; }
  for d in 6.1B 6.1C; do (cd "$BLD/$d" && sha256sum -c --quiet "$ST/build_$d.sha256") || { echo "build $d changed - stopping"; exit 1; }; done
  for d in 6.1B 6.1C; do diff -rq "$BLD/$d/src" "$S/$d/src" >/dev/null || { echo "staging's $d source changed since build - run build again"; exit 1; }; done
  BK="$ST/backup-$(date -u +%Y%m%dT%H%M%SZ)"; mkdir -p "$BK"
  for d in 6.1B 6.1C; do cp -a "$P/build/$d/src" "$BK/$d.src"; cp -a "$P/build/$d/dist" "$BK/$d.dist"; done
  cp -p "$CFG" "$BK/config.json"; echo "$BK" > "$ST/last_backup"; echo "== backup: $BK"
  rm -rf "$P/recovery_deps"; mkdir -p "$P/recovery_deps"; cp -a "$S/recovery_deps/node_modules" "$S/recovery_deps/package.json" "$P/recovery_deps/"
  [ -f "$S/recovery_deps/package-lock.json" ] && cp -a "$S/recovery_deps/package-lock.json" "$P/recovery_deps/" || true
  rm -rf "$P/central_assets"; cp -a "$S/central_assets" "$P/central_assets"; chmod 755 "$P/central_assets"; find "$P/central_assets" -type f -exec chmod 644 {} +
  for d in 6.1B 6.1C; do rm -rf "$P/build/$d/src" "$P/build/$d/dist"; cp -a "$BLD/$d/src" "$P/build/$d/src"; cp -a "$BLD/$d/dist.candidate" "$P/build/$d/dist"; done
  install -m 600 "$ST/config.candidate.json" "$CFG.tmp"; mv "$CFG.tmp" "$CFG"
  echo "== restart + health"
  if restart_health; then echo "DEPLOYED (recovery still OFF; next: enable after the login site + approver are ready)"
  else
    echo "!! health check failed - rolling back"
    for d in 6.1B 6.1C; do rm -rf "$P/build/$d/src" "$P/build/$d/dist"; cp -a "$BK/$d.src" "$P/build/$d/src"; cp -a "$BK/$d.dist" "$P/build/$d/dist"; done
    install -m 600 "$BK/config.json" "$CFG.tmp"; mv "$CFG.tmp" "$CFG"
    pm2 restart login-v2-verifier >/dev/null; pm2 restart login-v2-api >/dev/null; wait_port 8095 || true; sleep 3
    echo "   rolled back: api /ready -> $(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:8095/api/v1/auth/ready)"; exit 1
  fi ;;

update)
  need UPDATE-PROD-LOGIN
  [ -d "$P/build/6.1B/src/express/recovery" ] || { echo "not deployed yet - use deploy"; exit 1; }
  [ -f "$ST/build_6.1B.sha256" ] || { echo "run build first"; exit 1; }
  (cd "$P/build" && sha256sum -c --quiet "$ST/prod_src_at_build.sha256") || { echo "production source changed since build - stopping"; exit 1; }
  for d in 6.1B 6.1C; do (cd "$BLD/$d" && sha256sum -c --quiet "$ST/build_$d.sha256") || { echo "build $d changed - stopping"; exit 1; }
    diff -rq "$BLD/$d/src" "$S/$d/src" >/dev/null || { echo "staging's $d source changed since build - run build again"; exit 1; }; done
  BK="$ST/backup-$(date -u +%Y%m%dT%H%M%SZ)"; mkdir -p "$BK"
  for d in 6.1B 6.1C; do cp -a "$P/build/$d/src" "$BK/$d.src"; cp -a "$P/build/$d/dist" "$BK/$d.dist"; done
  cp -p "$CFG" "$BK/config.json"; echo "$BK" > "$ST/last_backup"; echo "== backup: $BK (live config kept as is)"
  for d in 6.1B 6.1C; do rm -rf "$P/build/$d/src" "$P/build/$d/dist"; cp -a "$BLD/$d/src" "$P/build/$d/src"; cp -a "$BLD/$d/dist.candidate" "$P/build/$d/dist"; done
  echo "== restart + health"
  if restart_health; then echo "UPDATED (code only)"
    echo "   enrollment page: 'Register this device' $(curl -s http://127.0.0.1:$ENROLL_PORT/enroll/ | grep -c 'Register this device') | 'laptop' on page+script: $( { curl -s http://127.0.0.1:$ENROLL_PORT/enroll/; curl -s http://127.0.0.1:$ENROLL_PORT/enroll/assets/enroll.js; } | grep -ci laptop || true)"
  else
    echo "!! health check failed - rolling back"
    for d in 6.1B 6.1C; do rm -rf "$P/build/$d/src" "$P/build/$d/dist"; cp -a "$BK/$d.src" "$P/build/$d/src"; cp -a "$BK/$d.dist" "$P/build/$d/dist"; done
    pm2 restart login-v2-verifier >/dev/null; pm2 restart login-v2-api >/dev/null; wait_port 8095 || true; sleep 3
    echo "   rolled back: api /ready -> $(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:8095/api/v1/auth/ready)"; exit 1
  fi ;;

enable|approvers)
  if [ "$1" = enable ]; then need ENABLE-RECOVERY; else need SET-APPROVERS
    [ -n "${APPROVER_EMAILS:-}" ] || { echo "set APPROVER_EMAILS=a@example.com"; exit 1; }
    echo "$APPROVER_EMAILS" | tr ',' '\n' | grep -vqE '^[^@ ]+@[^@ ]+\.[^@ ]+$' && { echo "an address looks wrong - stopping"; exit 1; }; fi
  [ -d "$P/build/6.1B/src/express/recovery" ] || { echo "deploy first"; exit 1; }
  cp -p "$CFG" "$ST/config.before-$1-$(date -u +%Y%m%dT%H%M%SZ).json"
  MODE=$1 node -e 'const fs=require("fs"),f=process.argv[1],c=JSON.parse(fs.readFileSync(f,"utf8"));
    if(process.env.MODE==="enable"){c.api.RECOVERY_ENABLED="true";c.api.RECOVERY_WORKERS_ENABLED="true";}
    else c.api.RECOVERY_APPROVER_EMAILS=process.env.APPROVER_EMAILS;
    fs.writeFileSync(f+".tmp",JSON.stringify(c,null,2)+"\n",{mode:0o600});fs.renameSync(f+".tmp",f);' "$CFG"
  pm2 restart login-v2-api >/dev/null; wait_port 8095; sleep 3
  echo "   api /ready -> $(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:8095/api/v1/auth/ready)"
  echo "   /recovery-email (no session) -> $(curl -s -w ' %{http_code}' http://127.0.0.1:8095/api/v1/auth/recovery-email)   (enabled: SESSION_INVALID 401)"
  pm2 logs login-v2-api --lines 40 --nostream --raw 2>/dev/null | grep -E 'password recovery mounted|packship routes mounted|fatal' | tail -3 | sed 's/^/   log: /' || true
  "$0" status ;;

rollback)
  need ROLLBACK-PROD-LOGIN; BK=$(cat "$ST/last_backup" 2>/dev/null || true); [ -n "$BK" ] && [ -d "$BK" ] || { echo "no backup recorded"; exit 1; }
  for d in 6.1B 6.1C; do rm -rf "$P/build/$d/src" "$P/build/$d/dist"; cp -a "$BK/$d.src" "$P/build/$d/src"; cp -a "$BK/$d.dist" "$P/build/$d/dist"; done
  install -m 600 "$BK/config.json" "$CFG.tmp"; mv "$CFG.tmp" "$CFG"
  pm2 restart login-v2-verifier >/dev/null; pm2 restart login-v2-api >/dev/null; wait_port 8095; sleep 3
  echo "ROLLED BACK to $BK: api /ready -> $(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:8095/api/v1/auth/ready) (the DB login tcds_login_central stays; harmless)" ;;

*) sed -n '2,19p' "$0"; exit 2 ;;
esac
