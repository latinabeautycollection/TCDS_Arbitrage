#!/usr/bin/env bash
# STAGING ONLY. Item 4 (Anthony decision 4), database part = 622.
#   inspect       read only: FKs/defaults the test fixtures need (auth_sessions, passkeys, revocation commands) and how
#                 complete_password_login_v3 uses status LOCKED / locked_until
#   db-rehearse   one transaction: catalog snapshot -> 622 -> self-checks -> 622 rollback -> snapshot must be identical -> ROLLBACK
#   db-install    apply 622 on the staging DB (one transaction, self-verifying)
#   db-uninstall  622 rollback (CONFIRM=UNINSTALL-622); must run before 621/620 rollbacks
#   patch         6.1B staging copy: POST /api/v1/auth/sign-out-everywhere + internal IAM API on 127.0.0.1:8196
#                 (backup src/dist/config first; only the touched compiled files are replaced; restart)
#   test          internal API auth (valid / bad signature / stale / replay / unknown user), sign-out-everywhere,
#                 and the four 622 triggers, with synthetic fixtures that are removed afterwards
#   revert        restore the backed-up files + config, restart (CONFIRM=REVERT-ITEM4)
# Needs /tmp/recov15/{622_*.sql, internalIamApi.ts}. Usage: bash /tmp/recov15/stg_item4.sh <cmd>   (run from /srv/arb-system/api)
set -euo pipefail
cd /srv/arb-system/api
eval "$(grep -E '^(PGHOST|PGPORT|PGDATABASE|PGUSER|PGPASSWORD|PGSSLMODE)=' .env | sed -E "s/^([A-Z_]+)=(.*)$/export \1='\2'/")"
export PGHOST=db.kqcdqtazcqaawdkmcfed.supabase.co PGPORT=5432 PGDATABASE=postgres PGUSER=postgres
[ "$PGHOST" = "db.kqcdqtazcqaawdkmcfed.supabase.co" ] || { echo "not the staging host - stopping"; exit 1; }
D=/tmp/recov15
S=$HOME/stg_login
B=$S/6.1B
BK4=$S/item4_backup
API=http://127.0.0.1:8195
APP=login-v2-api-staging
FILES4="src/config/env.ts src/express/integration.ts src/express/registerIdentityRoutes.ts"
OUTS4="dist/config/env.js dist/express/integration.js dist/express/registerIdentityRoutes.js"
grep -q kqcdqtazcqaawdkmcfed "$S/config.json" || { echo "$S/config.json is not the staging config - stopping"; exit 1; }
umask 077
q() { PAGER=cat psql -X -At -v ON_ERROR_STOP=1 "$@"; }
clean_pm2() { env -i HOME="$HOME" PATH="$PATH" USER="$USER" LANG=C.UTF-8 pm2 "$@"; }
restart_api() {
  clean_pm2 restart "$APP" >/dev/null
  for i in $(seq 1 30); do
    code=$(curl -s -o /dev/null -m 3 -w '%{http_code}' "$API/" || true)
    [ "$code" = "404" ] && { echo "$APP restarted, answering ($code)"; return 0; }
    sleep 1
  done
  echo "!! $APP not answering after restart; last log lines:"; pm2 logs "$APP" --nostream --lines 30 2>&1 | tail -30; exit 1
}
installed() { [ -n "$(q -c "SELECT to_regprocedure('warehouse_identity.iam_sign_out_everywhere_v15(bytea,uuid,uuid)')")" ]; }
bodies() { for f in 622_iam_session_epoch_events 622_iam_session_epoch_events.rollback; do grep -vxE 'BEGIN;|COMMIT;' $D/$f.sql > $D/$f.body.sql; done; }

cat > $D/snap4.sql <<'SQL'
CREATE OR REPLACE FUNCTION pg_temp.snap() RETURNS SETOF text LANGUAGE sql AS $s$
 SELECT 'fn:'||p.oid::regprocedure::text||':'||pg_get_userbyid(p.proowner)||':'||coalesce(p.proacl::text,'-')||':'||md5(p.prosrc)||':'||coalesce(array_to_string(p.proconfig,','),'-')
   FROM pg_proc p WHERE p.pronamespace='warehouse_identity'::regnamespace
 UNION ALL SELECT 'trg:'||c.relname||':'||t.tgname FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid
   WHERE c.relnamespace='warehouse_identity'::regnamespace AND NOT t.tgisinternal
 UNION ALL SELECT 'acl:'||c.relname||':'||coalesce(c.relacl::text,'-') FROM pg_class c
   WHERE c.relnamespace='warehouse_identity'::regnamespace AND c.relkind='r'
 UNION ALL SELECT 'schema_acl:'||coalesce(nspacl::text,'-') FROM pg_namespace WHERE nspname='warehouse_identity'
 UNION ALL SELECT 'member:'||pg_get_userbyid(roleid)||'>'||pg_get_userbyid(member)||' by '||pg_get_userbyid(grantor)
   ||':'||inherit_option::text||':'||set_option::text||':'||admin_option::text
   FROM pg_auth_members WHERE pg_get_userbyid(member)='postgres' AND pg_get_userbyid(roleid)='tcds_identity_function_owner'
$s$;
SQL

case "${1:-}" in
inspect-devices)
  q <<'SQL'
BEGIN READ ONLY;
SELECT 'devices_rows | ' || count(*) FROM warehouse.devices;
SELECT 'col | ' || c.relname || '.' || a.attname || ' ' || format_type(a.atttypid, a.atttypmod)
  || CASE WHEN a.attnotnull THEN ' NOT NULL' ELSE '' END || coalesce(' DEFAULT ' || pg_get_expr(d.adbin, d.adrelid), '')
FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
WHERE c.oid IN ('warehouse.devices'::regclass, 'warehouse.device_sessions'::regclass) AND a.attnum > 0 AND NOT a.attisdropped
ORDER BY c.relname, a.attnum;
SELECT 'con | ' || c.relname || ' ' || k.conname || ' ' || pg_get_constraintdef(k.oid)
FROM pg_constraint k JOIN pg_class c ON c.oid = k.conrelid
WHERE c.oid IN ('warehouse.devices'::regclass, 'warehouse.device_sessions'::regclass) AND k.contype IN ('c','f','u') ORDER BY 1;
SELECT 'enum | ' || t.typname || ': ' || string_agg(e.enumlabel, ',' ORDER BY e.enumsortorder)
FROM pg_type t JOIN pg_enum e ON e.enumtypid = t.oid
WHERE t.oid IN (SELECT a.atttypid FROM pg_attribute a WHERE a.attrelid IN ('warehouse.devices'::regclass,'warehouse.device_sessions'::regclass))
GROUP BY t.typname;
SELECT 'trigger | ' || c.relname || ' ' || t.tgname || ' -> ' || p.proname FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
JOIN pg_proc p ON p.oid = t.tgfoid WHERE c.oid IN ('warehouse.devices'::regclass,'warehouse.device_sessions'::regclass) AND NOT t.tgisinternal;
SELECT 'lv2test | facility=' || f.facility_id || ' stations=' || (SELECT count(*) FROM warehouse.stations s WHERE s.facility_id = f.facility_id)
FROM warehouse.facilities f WHERE f.facility_code = 'LV2TEST';
ROLLBACK;
SQL
  echo "INSPECT-DEVICES DONE (read only)"
  ;;
inspect)
  q <<'SQL'
BEGIN READ ONLY;
SELECT 'required | ' || c.relname || '.' || a.attname || ' ' || format_type(a.atttypid, a.atttypmod)
FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid
WHERE c.relnamespace = 'warehouse_identity'::regnamespace AND c.relname IN ('auth_sessions','passkeys','session_revocation_commands','enrolled_devices')
  AND a.attnum > 0 AND NOT a.attisdropped AND a.attnotnull AND NOT a.atthasdef AND a.attidentity = '' ORDER BY c.relname, a.attnum;
SELECT 'fk_or_check | ' || c.relname || ' ' || k.conname || ' ' || pg_get_constraintdef(k.oid)
FROM pg_constraint k JOIN pg_class c ON c.oid = k.conrelid
WHERE c.relnamespace = 'warehouse_identity'::regnamespace AND c.relname IN ('auth_sessions','passkeys','session_revocation_commands')
  AND k.contype IN ('f','c') ORDER BY 1;
SELECT 'trigger | ' || c.relname || ' ' || t.tgname || ' -> ' || p.proname FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
JOIN pg_proc p ON p.oid = t.tgfoid
WHERE c.relnamespace = 'warehouse_identity'::regnamespace AND c.relname IN ('auth_sessions','passkeys','session_revocation_commands') AND NOT t.tgisinternal;
SELECT '----- src ' || p.oid::regprocedure::text || E'\n' || p.prosrc FROM pg_proc p
WHERE p.pronamespace IN ('warehouse'::regnamespace) AND p.proname IN ('end_authenticated_device_session','open_authenticated_device_session');
SELECT 'locked_logic | ' || p.proname || ': ' || string_agg(m[1], ' | ')
FROM pg_proc p, regexp_matches(p.prosrc, '([^;]*(LOCKED|locked_until)[^;]*)', 'g') m
WHERE p.pronamespace = 'warehouse_identity'::regnamespace AND p.proname IN ('complete_password_login_v3','register_auth_failure_v3','resolve_effective_access','resolve_session_access')
GROUP BY p.proname;
SELECT 'enrolled_devices | rows=' || count(*) || ' active=' || count(*) FILTER (WHERE status = 'ACTIVE') FROM warehouse_identity.enrolled_devices;
SELECT 'lv2test_devices | ' || count(*) FROM warehouse_identity.enrolled_devices d JOIN warehouse.facilities f ON f.facility_id = d.facility_id WHERE f.facility_code = 'LV2TEST';
ROLLBACK;
SQL
  echo "INSPECT DONE (read only)"
  ;;
db-rehearse)
  installed && { echo "622 already installed - rehearse runs only on a clean state"; exit 1; }
  bodies
  q -q <<SQL
BEGIN;
SET LOCAL search_path = pg_catalog, pg_temp;
\i $D/snap4.sql
CREATE TEMP TABLE before ON COMMIT DROP AS SELECT x FROM pg_temp.snap() x;
\i $D/622_iam_session_epoch_events.body.sql
SET LOCAL search_path = pg_catalog, pg_temp;
\echo == 622 installed inside the rehearsal transaction
SELECT 'status_fn_after | ' || (SELECT md5(prosrc) FROM pg_proc WHERE oid='warehouse_identity.iam_session_epoch_status_v15(uuid)'::regprocedure);
\i $D/622_iam_session_epoch_events.rollback.body.sql
SET LOCAL search_path = pg_catalog, pg_temp;
\echo == 622 rolled back inside the rehearsal transaction
SELECT 'missing_after_rollback | ' || x FROM (SELECT x FROM before EXCEPT SELECT x FROM pg_temp.snap() x) d;
SELECT 'extra_after_rollback | ' || x FROM (SELECT x FROM pg_temp.snap() x EXCEPT SELECT x FROM before) d;
SELECT 'catalog_identical=' || NOT EXISTS (SELECT x FROM before EXCEPT SELECT x FROM pg_temp.snap() x
                                         UNION ALL SELECT x FROM pg_temp.snap() x EXCEPT SELECT x FROM before);
ROLLBACK;
SQL
  echo "REHEARSAL DONE (nothing kept)"
  ;;
db-install)
  installed && { echo "622 already installed"; exit 1; }
  sha256sum $D/622_iam_session_epoch_events.sql $D/622_iam_session_epoch_events.rollback.sql
  q -q -f $D/622_iam_session_epoch_events.sql
  q -c "SELECT 'installed | ' || p.oid::regprocedure::text || ' owner=' || pg_get_userbyid(p.proowner) || ' login_api=' || has_function_privilege('tcds_login_api', p.oid, 'EXECUTE')::text
        FROM pg_proc p WHERE p.proname IN ('iam_sign_out_everywhere_v15','iam_epoch_event_trigger_v15','iam_session_epoch_status_v15') ORDER BY 1"
  q -c "SELECT 'trigger | ' || c.relname || ' ' || t.tgname FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid WHERE t.tgname LIKE 'trg_iam_epoch_v15_%' ORDER BY 1"
  echo "622 INSTALLED ON STAGING at $(date -u +%FT%TZ)"
  ;;
db-uninstall)
  [ "${CONFIRM:-}" = "UNINSTALL-622" ] || { echo "set CONFIRM=UNINSTALL-622"; exit 1; }
  q -q -f $D/622_iam_session_epoch_events.rollback.sql; echo "622 ROLLED BACK"
  ;;
patch)
  # 6.1B on the STAGING copy: POST /api/v1/auth/sign-out-everywhere + the internal IAM API listener (127.0.0.1:8196).
  installed || { echo "run db-install first"; exit 1; }
  [ -e "$BK4" ] && { echo "$BK4 exists - already patched? (revert first)"; exit 1; }
  [ -f "$D/internalIamApi.ts" ] || { echo "missing $D/internalIamApi.ts"; exit 1; }
  cd "$B"
  [ -e src/express/internalIamApi.ts ] && { echo "src/express/internalIamApi.ts already exists - stopping"; exit 1; }
  SCR=$(mktemp -d "$S/item4_build.XXXX")
  ./node_modules/.bin/tsc -p tsconfig.json --outDir "$SCR/base"
  for o in $OUTS4; do cmp -s "$SCR/base/${o#dist/}" "$o" || { echo "REFUSING: deployed $o is not the current src"; exit 1; }; echo "match: $o"; done
  mkdir -p "$BK4"; chmod 700 "$BK4"
  for f in $FILES4 $OUTS4; do mkdir -p "$BK4/$(dirname $f)"; cp -p "$f" "$BK4/$f"; done
  cp -p "$S/config.json" "$BK4/config.json"
  cp "$D/internalIamApi.ts" src/express/internalIamApi.ts
  node - "$B" <<'NODE'
const fs=require("fs"),path=require("path"),B=process.argv[2];
function edit(file,pairs){const p=path.join(B,file);let s=fs.readFileSync(p,"utf8");
 for(const [a,b] of pairs){const n=s.split(a).length-1;if(n!==1)throw Error(file+": expected 1 match, found "+n+" for: "+a.slice(0,70));s=s.replace(a,()=>b)}
 fs.writeFileSync(p,s);console.log("patched "+file+" ("+pairs.length+" edits)")}
edit("src/config/env.ts",[
 ['LOG_LEVEL:z.string().default("info")',
  'LOG_LEVEL:z.string().default("info"),\n INTERNAL_IAM_API_SECRET:z.string().min(32).optional(),INTERNAL_IAM_API_PORT:z.coerce.number().int().min(1).max(65535).optional()']]);
edit("src/express/integration.ts",[
 ["import {identityAdminRoutes} from './identityAdmin/identityAdminRoutes';",
  "import {identityAdminRoutes} from './identityAdmin/identityAdminRoutes';\nimport {startInternalIamApi} from './internalIamApi';"],
 ["  await auth.startup();\n",
  "  await auth.startup();\n\n  // Internal IAM verification API for EOC: own 127.0.0.1 listener, only when configured.\n  const internalIam=d.env.INTERNAL_IAM_API_SECRET&&d.env.INTERNAL_IAM_API_PORT\n    ?startInternalIamApi(d.pool,{host:'127.0.0.1',port:d.env.INTERNAL_IAM_API_PORT,secret:d.env.INTERNAL_IAM_API_SECRET})\n    :null;\n"],
 ["    close:async()=>{await limits.close();},","    close:async()=>{await limits.close();await internalIam?.close();},"]]);
edit("src/express/registerIdentityRoutes.ts",[
 ["    return res.status(204).end();\n  });\n\n  return r;",
  "    return res.status(204).end();\n  });\n\n  // Every Warehouse session of the caller's user + the IAM session epoch (ends EOC sessions too).\n  r.post('/sign-out-everywhere',async(req,res)=>{\n    const token=cookie(req,'__Host-tcds_session');\n    if(!token)return res.status(401).json({error:{code:'SESSION_INVALID'}});\n    const q=await d.pool.query(\n      'SELECT warehouse_identity.iam_sign_out_everywhere_v15($1,$2,$3) AS revoked',\n      [H(token,d.sessionHashKey),ids(req).requestId,ids(req).correlationId]\n    );\n    clearCookies(res);\n    return res.json({revokedSessions:Number(q.rows[0]?.revoked??0)});\n  });\n\n  return r;"]]);
NODE
  ./node_modules/.bin/tsc -p tsconfig.json --noEmit
  ./node_modules/.bin/tsc -p tsconfig.json --outDir "$SCR/new"
  for o in $OUTS4 dist/express/internalIamApi.js; do cp "$SCR/new/${o#dist/}" "$o"; chmod 644 "$o"; done
  rm -rf "$SCR"
  # Staging-only secret for the internal API (never printed); EOC staging gets it out of band.
  node -e 'const fs=require("fs"),c=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));
    c.api.INTERNAL_IAM_API_SECRET=require("crypto").randomBytes(48).toString("base64url");c.api.INTERNAL_IAM_API_PORT="8196";
    fs.writeFileSync(process.argv[1],JSON.stringify(c,null,2));' "$S/config.json"
  chmod 600 "$S/config.json"
  sha256sum $FILES4 src/express/internalIamApi.ts $OUTS4 dist/express/internalIamApi.js
  restart_api
  for i in $(seq 1 10); do ss -ltn | grep -q '127.0.0.1:8196 ' && break; sleep 1; done
  ss -ltn | grep -q '127.0.0.1:8196 ' && echo "internal IAM API listening on 127.0.0.1:8196" || { echo "!! internal API not listening"; exit 1; }
  echo "PATCHED (backup in $BK4)"
  ;;
revert)
  [ "${CONFIRM:-}" = "REVERT-ITEM4" ] || { echo "set CONFIRM=REVERT-ITEM4"; exit 1; }
  [ -d "$BK4" ] || { echo "no backup in $BK4"; exit 1; }
  for f in $FILES4 $OUTS4; do cp -p "$BK4/$f" "$B/$f"; done
  rm -f "$B/src/express/internalIamApi.ts" "$B/dist/express/internalIamApi.js"
  cp -p "$BK4/config.json" "$S/config.json"
  mv "$BK4" "$BK4.reverted.$(date +%s)"; restart_api; echo "REVERTED"
  ;;
test)
  . "$S/testusers.env"; U="$STG_EMPLOYEE_1_USER_ID"; A1="$STG_APPROVER_1_USER_ID"
  ss -ltn | grep -q '127.0.0.1:8196 ' || { echo "internal API not listening (run patch)"; exit 1; }
  cat > "$S/item4_client.cjs" <<'NODE'
// Test client: signs requests to the internal IAM API exactly as EOC must, and drives sign-out-everywhere.
const fs=require("fs"),crypto=require("crypto");
const cfg=JSON.parse(fs.readFileSync(process.env.CFG,"utf8")),sec=cfg.api.INTERNAL_IAM_API_SECRET,port=cfg.api.INTERNAL_IAM_API_PORT;
const sha=s=>crypto.createHash("sha256").update(s,"utf8").digest("hex");
const hmac=s=>crypto.createHmac("sha256",sec).update(s,"utf8").digest("base64url");
async function status(userId,o={}){
 const body=JSON.stringify({userId}),requestId=crypto.randomUUID(),n=o.nonce||crypto.randomUUID(),t=String(o.ts||Date.now()),h=sha(body);
 const sig=o.badSig?hmac("wrong"):hmac(`${t}.${n}.${h}.${requestId}`);
 const r=await fetch(`http://127.0.0.1:${port}/internal/v1/iam/session-status`,{method:"POST",
  headers:{"content-type":"application/json","x-tcds-workload":"eoc","x-tcds-timestamp":t,"x-tcds-nonce":n,"x-tcds-body-sha256":h,"x-tcds-request-signature":sig,"x-request-id":requestId},body});
 const raw=await r.text();let j={};try{j=JSON.parse(raw)}catch{}
 const rs=r.headers.get("x-tcds-response-signature");
 return {s:r.status,code:j.error?j.error.code:"-",active:j.userActive,epoch:j.epoch,respSig:rs?(rs===hmac(`${requestId}.${sha(raw)}`)?"valid":"INVALID"):"none",nonce:n};
}
const fmt=r=>`${r.s} code=${r.code} active=${r.active} epoch=${r.epoch} response_sig=${r.respSig}`;
(async()=>{
 const [cmd,arg]=process.argv.slice(2);
 if(cmd==="status")console.log(fmt(await status(arg)));
 else if(cmd==="badsig")console.log(fmt(await status(arg,{badSig:true})));
 else if(cmd==="stale")console.log(fmt(await status(arg,{ts:Date.now()-5*60_000})));
 else if(cmd==="replay"){const a=await status(arg);const b=await status(arg,{nonce:a.nonce});console.log("first "+fmt(a)+" | replay "+fmt(b));}
 else if(cmd==="signout"){
  const t=process.env.TOKEN,c=process.env.CSRF,H={"content-type":"application/json","origin":cfg.api.PUBLIC_APP_ORIGIN,
    "cookie":`__Host-tcds_session=${t}; __Host-tcds_csrf=${c}`};
  if(arg!=="nocsrf")H["x-csrf-token"]=c;
  const r=await fetch(`http://127.0.0.1:${cfg.api.PORT}/api/v1/auth/sign-out-everywhere`,{method:"POST",headers:H,body:"{}"});
  let j={};try{j=await r.json()}catch{};console.log(r.status+" "+(j.error?j.error.code:"revokedSessions="+j.revokedSessions));
 } else throw Error("unknown cmd");
})().catch(e=>{console.error("client failed:",e.message);process.exit(1)});
NODE
  cli() { CFG="$S/config.json" node "$S/item4_client.cjs" "$@"; }
  epoch() { q -c "SELECT coalesce((SELECT epoch FROM warehouse_identity.iam_session_epochs_v15 WHERE user_id='$U'),0)"; }
  sessions() { q -c "SELECT count(*) FILTER (WHERE revoked_at IS NULL) || ' active / ' || count(*) || ' total' FROM warehouse_identity.auth_sessions WHERE user_id='$U'"; }
  check() { printf '  %-58s %s\n' "$1" "$2"; }
  cleanup() {
    q -q -c "BEGIN;
      UPDATE warehouse_identity.users SET status='ACTIVE',locked_until=NULL WHERE user_id='$U';
      UPDATE warehouse_identity.employees SET employment_status='ACTIVE' WHERE user_id='$U';
      DELETE FROM warehouse_identity.session_revocation_commands WHERE idempotency_key LIKE 'item4-test-%';
      DELETE FROM warehouse_identity.auth_sessions WHERE user_id='$U';
      DELETE FROM warehouse.device_sessions WHERE user_id='$U' AND network_state->>'fixture'='item4';
      DELETE FROM warehouse.devices WHERE device_name='item4-test-device' AND serial_number::text LIKE 'item4-test-%';
      DELETE FROM warehouse_identity.passkeys WHERE user_id='$U' AND credential_id LIKE 'item4-test-%';
      COMMIT;" || true
    rm -f "$S/item4_sessions.env"; }
  trap cleanup EXIT
  make_sessions() {   # two synthetic Warehouse sessions for the test user; tokens only in a 600 file
    CFG="$S/config.json" OUT="$S" node -e '
      const fs=require("fs"),c=require("crypto"),cfg=JSON.parse(fs.readFileSync(process.env.CFG,"utf8"));
      const h=(v,k)=>c.createHmac("sha256",k).update(v).digest("hex");let env="",rows=[];
      for(const i of [1,2]){const t=c.randomBytes(32).toString("base64url"),x=c.randomBytes(32).toString("base64url");
        env+=`TOKEN${i}=${t}\nCSRF${i}=${x}\n`;rows.push([h(t,cfg.api.SESSION_HASH_KEY),h(x,cfg.api.CSRF_HASH_KEY)]);}
      fs.writeFileSync(process.env.OUT+"/item4_sessions.env",env,{mode:0o600});
      console.log(rows.map(r=>r.join(":")).join(" "));' > "$S/item4_hashes.txt"
    for pair in $(cat "$S/item4_hashes.txt"); do
      th=${pair%%:*}; ch=${pair##*:}
      q -q -c "WITH ds AS (
          INSERT INTO warehouse.device_sessions(device_id,user_id,employee_number,started_at,last_activity_at,network_state)
          SELECT '$DEV','$U',e.employee_number,statement_timestamp(),statement_timestamp(),'{\"fixture\":\"item4\"}'::jsonb
          FROM warehouse_identity.employees e WHERE e.user_id='$U' RETURNING session_id)
        INSERT INTO warehouse_identity.auth_sessions(user_id,employee_id,device_id,warehouse_device_session_id,authentication_method,
          assurance_level,token_hash,csrf_token_hash,issued_at,last_activity_at,idle_expires_at,absolute_expires_at,request_id,correlation_id)
        SELECT '$U',e.employee_id,'$DEV',ds.session_id,'PASSWORD','AAL1',decode('$th','hex'),decode('$ch','hex'),
          statement_timestamp(),statement_timestamp(),statement_timestamp()+interval '29 minutes',statement_timestamp()+interval '7 hours',
          gen_random_uuid(),gen_random_uuid()
        FROM ds, warehouse_identity.employees e WHERE e.user_id='$U'"
    done
    rm -f "$S/item4_hashes.txt"; . "$S/item4_sessions.env"; }

  echo "===== A. internal IAM API (signed like EOC must sign)"
  E0=$(epoch)
  check "A1 valid request (expect 200 active=true epoch=$E0, sig valid)" "$(cli status "$U")"
  check "A2 bad request signature (expect 401)" "$(cli badsig "$U")"
  check "A3 stale timestamp, 5 min old (expect 401)" "$(cli stale "$U")"
  check "A4 nonce replay (expect first 200, replay 401 REQUEST_REPLAYED)" "$(cli replay "$U")"
  check "A5 unknown user (expect 200 active=false epoch=0)" "$(cli status "$(cat /proc/sys/kernel/random/uuid)")"

  echo "===== T. triggers (each in one statement as postgres; same transaction as the change)"
  E=$(epoch)
  q -q -c "INSERT INTO warehouse_identity.passkeys(user_id,credential_id,public_key,public_key_algorithm) VALUES('$U','item4-test-'||gen_random_uuid(),'\x00'::bytea,-7)"
  q -q -c "UPDATE warehouse_identity.passkeys SET security_state='REVOKED',revoked_at=clock_timestamp(),revoked_by='$A1' WHERE user_id='$U' AND credential_id LIKE 'item4-test-%'"
  check "T1 passkey revoked (expect epoch $((E+1)))" "$(epoch)"; E=$(epoch)
  q -q -c "UPDATE warehouse_identity.employees SET employment_status='LEAVE' WHERE user_id='$U'"
  check "T2 employment ACTIVE->LEAVE (expect epoch $((E+1)), API active=false)" "$(epoch) | $(cli status "$U")"; E=$(epoch)
  q -q -c "UPDATE warehouse_identity.employees SET employment_status='ACTIVE' WHERE user_id='$U'"
  check "   back to ACTIVE (expect epoch $E unchanged, active=true)" "$(epoch) | $(cli status "$U")"
  q -q -c "UPDATE warehouse_identity.users SET status='SUSPENDED' WHERE user_id='$U'"
  check "T3 user SUSPENDED (expect epoch $((E+1)), active=false)" "$(epoch) | $(cli status "$U")"; E=$(epoch)
  q -q -c "UPDATE warehouse_identity.users SET status='ACTIVE' WHERE user_id='$U'"
  q -q -c "UPDATE warehouse_identity.users SET status='LOCKED',locked_until=clock_timestamp()+interval '15 minutes' WHERE user_id='$U'"
  check "T4 user LOCKED by lockout (expect epoch $E unchanged, active=true)" "$(epoch) | $(cli status "$U")"
  q -q -c "UPDATE warehouse_identity.users SET status='ACTIVE',locked_until=NULL WHERE user_id='$U'"
  CMD=$(q -c "INSERT INTO warehouse_identity.session_revocation_commands(scope_type,scope_id,reason_code,requested_by,idempotency_key,request_id,correlation_id)
              VALUES('USER','$U','SECURITY_TEST','$A1','item4-test-'||gen_random_uuid(),gen_random_uuid(),gen_random_uuid()) RETURNING session_revocation_command_id" | head -1)
  q -q -c "SELECT warehouse_identity.execute_session_revocation_command(p_command_id=>'$CMD',p_executor_user_id=>'$A1')" >/dev/null
  check "T5 USER-scope revocation command (expect epoch $((E+1)))" "$(epoch) | $(sessions)"

  echo "===== S. sign-out-everywhere (2 synthetic sessions)"
  # Own synthetic device at LV2TEST (never a real device); removed by cleanup.
  DEV=$(q -c "INSERT INTO warehouse.devices(facility_id,device_type,status,device_name,serial_number,hardware_fingerprint)
              SELECT facility_id,'PWA_DESKTOP','ACTIVE','item4-test-device','item4-test-'||gen_random_uuid(),'item4-test-'||gen_random_uuid()
              FROM warehouse.facilities WHERE facility_code='LV2TEST' RETURNING device_id" | head -1)
  if [ -z "$DEV" ]; then echo "  SKIPPED: could not create the LV2TEST fixture device"; else
  make_sessions
  echo "  fixture: $(sessions), epoch=$(epoch)"
  E0=$(epoch)
  TOKEN=$TOKEN1 CSRF=$CSRF1 check "S1 without CSRF header (expect 403 CSRF_REJECTED)" "$(TOKEN=$TOKEN1 CSRF=$CSRF1 cli signout nocsrf)"
  check "S2 with CSRF (expect 200 revokedSessions=2)" "$(TOKEN=$TOKEN1 CSRF=$CSRF1 cli signout)"
  check "   sessions after (expect 0 active / 2 total)" "$(sessions)"
  check "   epoch after (expect $((E0+1)))" "$(epoch)"
  check "S3 replay with the revoked session (expect 403 CSRF_REJECTED: CSRF dies with the session)" "$(TOKEN=$TOKEN1 CSRF=$CSRF1 cli signout)"
  check "S4 API sees the new epoch (expect epoch=$((E0+1)))" "$(cli status "$U")"
  fi

  echo "ITEM 4 TEST DONE (fixtures removed, test user back to ACTIVE)"
  ;;
*) echo "usage: $0 inspect|inspect-devices|db-rehearse|db-install|db-uninstall|patch|test|revert"; exit 2;;
esac
