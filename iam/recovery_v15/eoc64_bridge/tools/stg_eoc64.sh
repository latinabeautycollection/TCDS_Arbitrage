#!/usr/bin/env bash
# STAGING ONLY. EOC 6.4 V1.2 IAM bridge, our corrected port (623 + internalIamApi.ts bridge routes).
#   inspect-leadership  read only: leadership table columns/constraints (for the appointment fixture), postgres
#                       BYPASSRLS, default privileges in warehouse_identity
#   db-rehearse   one transaction: catalog snapshot -> 623 -> 623 rollback -> snapshot must be identical -> ROLLBACK
#   db-install    apply 623 on the staging DB (one transaction, self-verifying)
#   db-uninstall  623 rollback (CONFIRM=UNINSTALL-623); must run before 622's rollback
#   patch         6.1B staging copy (item 4 must be applied): new internalIamApi.ts with the EOC bridge routes +
#                 EOC_IAM_SERVICE_TOKEN in env.ts/integration.ts; staging token generated into config.json (never printed)
#   test          signs requests exactly like Anthony's EOC authorityClient.mjs and checks the bridge end to end
#   revert        restore the backed-up files + config, restart (CONFIRM=REVERT-EOC64)
# Needs /tmp/recov15/{623_*.sql, internalIamApi.ts}. Usage: bash /tmp/recov15/stg_eoc64.sh <cmd>   (run from /srv/arb-system/api)
set -euo pipefail
cd /srv/arb-system/api
eval "$(grep -E '^(PGHOST|PGPORT|PGDATABASE|PGUSER|PGPASSWORD|PGSSLMODE)=' .env | sed -E "s/^([A-Z_]+)=(.*)$/export \1='\2'/")"
export PGHOST=db.kqcdqtazcqaawdkmcfed.supabase.co PGPORT=5432 PGDATABASE=postgres PGUSER=postgres
[ "$PGHOST" = "db.kqcdqtazcqaawdkmcfed.supabase.co" ] || { echo "not the staging host - stopping"; exit 1; }
D=/tmp/recov15
S=$HOME/stg_login
B=$S/6.1B
BK4=$S/item4_backup
BK=$S/eoc64_backup
API=http://127.0.0.1:8195
APP=login-v2-api-staging
FILES="src/express/internalIamApi.ts src/config/env.ts src/express/integration.ts"
OUTS="dist/express/internalIamApi.js dist/config/env.js dist/express/integration.js"
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
installed() { [ -n "$(q -c "SELECT to_regprocedure('warehouse_identity.eoc_bridge_ready_v623(uuid)')")" ]; }
bodies() { for f in 623_eoc_iam_bridge 623_eoc_iam_bridge.rollback; do grep -vxE 'BEGIN;|COMMIT;' $D/$f.sql > $D/$f.body.sql; done; }

cat > $D/snap623.sql <<'SQL'
CREATE OR REPLACE FUNCTION pg_temp.snap() RETURNS SETOF text LANGUAGE sql AS $s$
 SELECT 'fn:'||p.oid::regprocedure::text||':'||pg_get_userbyid(p.proowner)||':'||coalesce(p.proacl::text,'-')||':'||md5(p.prosrc)
   FROM pg_proc p WHERE p.pronamespace IN ('warehouse_identity'::regnamespace,'enterprise_org'::regnamespace)
 UNION ALL SELECT 'rel:'||c.oid::regclass::text||':'||c.relkind::text||':'||pg_get_userbyid(c.relowner)||':'||coalesce(c.relacl::text,'-')
   ||':'||c.relrowsecurity||c.relforcerowsecurity
   FROM pg_class c WHERE c.relnamespace IN ('warehouse_identity'::regnamespace,'enterprise_org'::regnamespace) AND c.relkind IN ('r','S','i')
 UNION ALL SELECT 'col_acl:'||c.oid::regclass::text||'.'||a.attname||':'||a.attacl::text
   FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid
   WHERE c.relnamespace IN ('warehouse_identity'::regnamespace,'enterprise_org'::regnamespace) AND a.attacl IS NOT NULL
 UNION ALL SELECT 'policy:'||schemaname||'.'||tablename||':'||policyname||':'||cmd||':'||array_to_string(roles,',')
   FROM pg_policies WHERE schemaname IN ('warehouse_identity','enterprise_org')
 UNION ALL SELECT 'schema_acl:'||nspname||':'||coalesce(nspacl::text,'-') FROM pg_namespace WHERE nspname IN ('warehouse_identity','enterprise_org')
 UNION ALL SELECT 'member:'||pg_get_userbyid(roleid)||'>'||pg_get_userbyid(member)||' by '||pg_get_userbyid(grantor)
   ||':'||inherit_option::text||':'||set_option::text||':'||admin_option::text
   FROM pg_auth_members WHERE pg_get_userbyid(member)='postgres' AND pg_get_userbyid(roleid)='tcds_identity_function_owner'
$s$;
SQL

case "${1:-}" in
inspect-leadership)
  q -F ' | ' <<'SQL'
BEGIN READ ONLY;
SELECT 'col', c.table_name||'.'||c.column_name||' '||c.data_type||CASE WHEN c.is_nullable='NO' THEN ' NOT NULL' ELSE '' END
       ||coalesce(' DEFAULT '||c.column_default,'')
  FROM information_schema.columns c WHERE c.table_schema='enterprise_org'
   AND c.table_name IN ('leadership_people','leadership_appointments','positions') ORDER BY c.table_name, c.ordinal_position;
SELECT 'con', conrelid::regclass::text||' '||conname||' '||pg_get_constraintdef(oid) FROM pg_constraint
 WHERE conrelid IN ('enterprise_org.leadership_people'::regclass,'enterprise_org.leadership_appointments'::regclass,'enterprise_org.positions'::regclass)
 ORDER BY 2;
SELECT 'trigger', c.relname||' '||t.tgname||' -> '||t.tgfoid::regproc::text FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid
 WHERE c.relnamespace='enterprise_org'::regnamespace AND NOT t.tgisinternal ORDER BY 2;
SELECT 'positions', count(*)||' rows' FROM enterprise_org.positions;
SELECT 'policy', tablename||':'||policyname||':'||cmd||':'||array_to_string(roles,',') FROM pg_policies WHERE schemaname='enterprise_org' ORDER BY 2;
SELECT 'postgres', 'bypassrls='||rolbypassrls FROM pg_roles WHERE rolname='postgres';
SELECT 'default_acl', pg_get_userbyid(defaclrole)||' in '||coalesce(defaclnamespace::regnamespace::text,'(all)')||' '||defaclobjtype::text||' '||defaclacl::text
  FROM pg_default_acl WHERE defaclnamespace IN (0,'warehouse_identity'::regnamespace) ORDER BY 2;
ROLLBACK;
SQL
  echo "INSPECT-LEADERSHIP DONE (read only)"
  ;;
db-rehearse)
  installed && { echo "623 already installed - rehearse runs only on a clean state"; exit 1; }
  bodies
  q -q <<SQL
BEGIN;
SET LOCAL search_path = pg_catalog, pg_temp;
\i $D/snap623.sql
CREATE TEMP TABLE before ON COMMIT DROP AS SELECT x FROM pg_temp.snap() x;
\i $D/623_eoc_iam_bridge.body.sql
SET LOCAL search_path = pg_catalog, pg_temp;
\echo == 623 installed inside the rehearsal transaction
SELECT 'fn | ' || p.oid::regprocedure::text || ' owner=' || pg_get_userbyid(p.proowner) || ' login_api=' || has_function_privilege('tcds_login_api', p.oid, 'EXECUTE')::text
  FROM pg_proc p WHERE p.proname LIKE 'eoc\_%\_v623' ORDER BY 1;
\i $D/623_eoc_iam_bridge.rollback.body.sql
SET LOCAL search_path = pg_catalog, pg_temp;
\echo == 623 rolled back inside the rehearsal transaction
SELECT 'missing_after_rollback | ' || x FROM (SELECT x FROM before EXCEPT SELECT x FROM pg_temp.snap() x) d;
SELECT 'extra_after_rollback | ' || x FROM (SELECT x FROM pg_temp.snap() x EXCEPT SELECT x FROM before) d;
SELECT 'catalog_identical=' || NOT EXISTS (SELECT x FROM before EXCEPT SELECT x FROM pg_temp.snap() x
                                         UNION ALL SELECT x FROM pg_temp.snap() x EXCEPT SELECT x FROM before);
ROLLBACK;
SQL
  echo "REHEARSAL DONE (nothing kept)"
  ;;
db-install)
  installed && { echo "623 already installed"; exit 1; }
  sha256sum $D/623_eoc_iam_bridge.sql $D/623_eoc_iam_bridge.rollback.sql
  q -q -f $D/623_eoc_iam_bridge.sql
  q -c "SELECT 'installed | ' || p.oid::regprocedure::text || ' owner=' || pg_get_userbyid(p.proowner) || ' login_api=' || has_function_privilege('tcds_login_api', p.oid, 'EXECUTE')::text
        FROM pg_proc p WHERE p.proname LIKE 'eoc\_%\_v623' ORDER BY 1"
  echo "623 INSTALLED ON STAGING at $(date -u +%FT%TZ)"
  ;;
db-uninstall)
  [ "${CONFIRM:-}" = "UNINSTALL-623" ] || { echo "set CONFIRM=UNINSTALL-623"; exit 1; }
  q -q -f $D/623_eoc_iam_bridge.rollback.sql; echo "623 ROLLED BACK"
  ;;
patch)
  installed || { echo "run db-install first"; exit 1; }
  [ -d "$BK4" ] || { echo "item 4 patch not applied ($BK4 missing) - stopping"; exit 1; }
  [ -e "$BK" ] && { echo "$BK exists - already patched? (revert first)"; exit 1; }
  [ -f "$D/internalIamApi.ts" ] || { echo "missing $D/internalIamApi.ts"; exit 1; }
  cd "$B"
  grep -q "eoc_bridge_admit_nonce_v623" "$D/internalIamApi.ts" || { echo "$D/internalIamApi.ts is not the bridge version - stopping"; exit 1; }
  SCR=$(mktemp -d "$S/eoc64_build.XXXX")
  ./node_modules/.bin/tsc -p tsconfig.json --outDir "$SCR/base"
  for o in $OUTS; do cmp -s "$SCR/base/${o#dist/}" "$o" || { echo "REFUSING: deployed $o is not the current src"; exit 1; }; echo "match: $o"; done
  mkdir -p "$BK"; chmod 700 "$BK"
  for f in $FILES $OUTS; do mkdir -p "$BK/$(dirname $f)"; cp -p "$f" "$BK/$f"; done
  cp -p "$S/config.json" "$BK/config.json"
  cp "$D/internalIamApi.ts" src/express/internalIamApi.ts
  node - "$B" <<'NODE'
const fs=require("fs"),path=require("path"),B=process.argv[2];
function edit(file,pairs){const p=path.join(B,file);let s=fs.readFileSync(p,"utf8");
 for(const [a,b] of pairs){const n=s.split(a).length-1;if(n!==1)throw Error(file+": expected 1 match, found "+n+" for: "+a.slice(0,70));s=s.replace(a,()=>b)}
 fs.writeFileSync(p,s);console.log("patched "+file+" ("+pairs.length+" edits)")}
edit("src/config/env.ts",[
 ['INTERNAL_IAM_API_PORT:z.coerce.number().int().min(1).max(65535).optional()',
  'INTERNAL_IAM_API_PORT:z.coerce.number().int().min(1).max(65535).optional(),\n EOC_IAM_SERVICE_TOKEN:z.string().min(32).optional()']]);
edit("src/express/integration.ts",[
 ["secret:d.env.INTERNAL_IAM_API_SECRET})","secret:d.env.INTERNAL_IAM_API_SECRET,eocBridgeSecret:d.env.EOC_IAM_SERVICE_TOKEN})"]]);
NODE
  ./node_modules/.bin/tsc -p tsconfig.json --noEmit
  ./node_modules/.bin/tsc -p tsconfig.json --outDir "$SCR/new"
  for o in $OUTS; do cp "$SCR/new/${o#dist/}" "$o"; chmod 644 "$o"; done
  rm -rf "$SCR"
  # Staging-only bridge token (never printed); the EOC staging server gets it out of band.
  node -e 'const fs=require("fs"),c=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));
    c.api.EOC_IAM_SERVICE_TOKEN=require("crypto").randomBytes(48).toString("base64url");
    fs.writeFileSync(process.argv[1],JSON.stringify(c,null,2));' "$S/config.json"
  chmod 600 "$S/config.json"
  sha256sum $FILES $OUTS
  restart_api
  for i in $(seq 1 10); do ss -ltn | grep -q '127.0.0.1:8196 ' && break; sleep 1; done
  ss -ltn | grep -q '127.0.0.1:8196 ' && echo "internal IAM API (+ EOC bridge) listening on 127.0.0.1:8196" || { echo "!! internal API not listening"; exit 1; }
  echo "PATCHED (backup in $BK)"
  ;;
revert)
  [ "${CONFIRM:-}" = "REVERT-EOC64" ] || { echo "set CONFIRM=REVERT-EOC64"; exit 1; }
  [ -d "$BK" ] || { echo "no backup in $BK"; exit 1; }
  for f in $FILES $OUTS; do cp -p "$BK/$f" "$B/$f"; done
  cp -p "$BK/config.json" "$S/config.json"
  mv "$BK" "$BK.reverted.$(date +%s)"; restart_api; echo "REVERTED"
  ;;
test)
  . "$S/testusers.env"; U="$STG_EMPLOYEE_1_USER_ID"; A1="$STG_APPROVER_1_USER_ID"; A2="$STG_APPROVER_2_USER_ID"
  installed || { echo "623 not installed"; exit 1; }
  ss -ltn | grep -q '127.0.0.1:8196 ' || { echo "internal API not listening (run patch)"; exit 1; }
  cat > "$S/eoc64_client.cjs" <<'NODE'
// Signs exactly like Anthony's server/authorityClient.mjs (method \n path \n unix-seconds \n nonce \n sha256(body), hex).
const fs=require("fs"),crypto=require("crypto");
const cfg=JSON.parse(fs.readFileSync(process.env.CFG,"utf8")),key=cfg.api.EOC_IAM_SERVICE_TOKEN,port=cfg.api.INTERNAL_IAM_API_PORT;
const sha=s=>crypto.createHash("sha256").update(s).digest("hex");
async function call(method,path,payload,o={}){
 const body=payload===undefined?"":JSON.stringify(payload),nonce=o.nonce||crypto.randomUUID(),ts=String(o.ts||Math.floor(Date.now()/1000));
 const sig=crypto.createHmac("sha256",o.key||key).update([method,o.signPath||path,ts,nonce,sha(body)].join("\n")).digest("hex");
 const r=await fetch(`http://127.0.0.1:${port}${path}`,{method,body:body||undefined,headers:{"x-eoc-workload-timestamp":ts,
  "x-eoc-workload-nonce":nonce,"x-eoc-workload-signature":sig,"x-request-id":crypto.randomUUID(),accept:"application/json",
  ...(body?{"content-type":"application/json"}:{})}});
 let j={};try{j=await r.json()}catch{}
 return {s:r.status,j,nonce};
}
const fmt=({s,j})=>s+" "+(j.error?j.error:j.userId&&"active" in j?`active=${j.active} epoch=${j.epoch} appointments=${Array.isArray(j.appointments)?j.appointments.length:"?"}`
  :j.verified?`verified userId=${j.userId===process.env.EXPECT_USER?"<test user>":j.userId}`:JSON.stringify(j));
(async()=>{
 const [cmd,arg]=process.argv.slice(2),sub=id=>`/internal/v1/iam/eoc/subject/${id}`;
 const fed=p=>call("POST","/internal/v1/iam/eoc/federation/resolve",{issuer:"https://issuer.stg-eoc.test",providerSubject:p});
 if(cmd==="ready")console.log(fmt(await call("GET","/internal/v1/iam/eoc/ready")));
 else if(cmd==="subject")console.log(fmt(await call("GET",sub(arg))));
 else if(cmd==="badkey")console.log(fmt(await call("GET",sub(arg),undefined,{key:"x".repeat(48)})));
 else if(cmd==="stale")console.log(fmt(await call("GET",sub(arg),undefined,{ts:Math.floor(Date.now()/1000)-300})));
 else if(cmd==="pathswap")console.log(fmt(await call("GET",sub(arg),undefined,{signPath:"/internal/v1/iam/eoc/ready"})));
 else if(cmd==="replay"){const a=await call("GET",sub(arg));const b=await call("GET",sub(arg),undefined,{nonce:a.nonce});console.log("first "+fmt(a)+" | replay "+fmt(b));}
 else if(cmd==="fed")console.log(fmt(await fed(arg)));
 else if(cmd==="appt"){   // Anthony's own EOC policy decides whether the snapshot lets this user in
  const r=await call("GET",sub(arg)),{activeAppointment,POSITION_MAP}=await import(process.env.POLICY);
  const a=activeAppointment(r.j.appointments||[]);
  console.log(fmt(r)+" | EOC activeAppointment="+(a?`${a.position_code} -> ${POSITION_MAP[a.position_code]}`:"none"));}
 else throw Error("unknown cmd");
})().catch(e=>{console.error("client failed:",e.message);process.exit(1)});
NODE
  [ -f "$D/eoc64_policy.mjs" ] || { echo "missing $D/eoc64_policy.mjs (Anthony's server/policy.mjs)"; exit 1; }
  cli() { CFG="$S/config.json" EXPECT_USER="$U" POLICY="$D/eoc64_policy.mjs" node "$S/eoc64_client.cjs" "$@"; }
  epoch() { q -c "SELECT coalesce((SELECT epoch FROM warehouse_identity.iam_session_epochs_v15 WHERE user_id='$1'),0)"; }
  check() { printf '  %-66s %s\n' "$1" "$2"; }
  ISS=https://issuer.stg-eoc.test
  # postgres-only fixture policies on the forced-RLS bridge tables (dropped again by cleanup)
  q -q -c "BEGIN;
    CREATE POLICY eoc623_test_pg ON warehouse_identity.eoc_federated_subject_bindings_v12 FOR ALL TO postgres USING (true) WITH CHECK (true);
    CREATE POLICY eoc623_test_pg ON warehouse_identity.eoc_bridge_nonces_v12 FOR ALL TO postgres USING (true) WITH CHECK (true);
    CREATE POLICY eoc623_test_pg ON warehouse_identity.eoc_bridge_audit_v12 FOR ALL TO postgres USING (true) WITH CHECK (true);
    COMMIT;"
  cleanup() {
    q -q -c "BEGIN;
      UPDATE warehouse_identity.users SET status='ACTIVE',locked_until=NULL WHERE user_id='$U';
      DELETE FROM enterprise_org.leadership_appointments WHERE approval_reference='STAGING-SYNTHETIC-EOC64';
      DELETE FROM enterprise_org.leadership_people WHERE person_key='STG_EOC64_TEST_PERSON';
      DELETE FROM enterprise_org.positions WHERE position_code='CEO' AND position_title='Staging EOC64 Synthetic CEO';
      DELETE FROM warehouse_identity.eoc_federated_subject_bindings_v12 WHERE issuer='$ISS';
      DROP POLICY IF EXISTS eoc623_test_pg ON warehouse_identity.eoc_federated_subject_bindings_v12;
      DROP POLICY IF EXISTS eoc623_test_pg ON warehouse_identity.eoc_bridge_nonces_v12;
      DROP POLICY IF EXISTS eoc623_test_pg ON warehouse_identity.eoc_bridge_audit_v12;
      COMMIT;" || true; }
  trap cleanup EXIT
  N=$(q -c "SELECT u.user_id FROM warehouse_identity.users u WHERE u.status='ACTIVE' AND u.archived_at IS NULL
            AND NOT EXISTS (SELECT 1 FROM warehouse_identity.iam_session_epochs_v15 e WHERE e.user_id=u.user_id) LIMIT 1")
  A0=$(q -c "SELECT count(*) FROM warehouse_identity.eoc_bridge_audit_v12")

  echo "===== B. EOC bridge auth (signed like EOC authorityClient.mjs)"
  check "B1 ready (expect 200 ready)" "$(cli ready)"
  check "B2 bad key (expect 401 UNAUTHORIZED)" "$(cli badkey "$U")"
  check "B3 timestamp 5 min old (expect 401 UNAUTHORIZED)" "$(cli stale "$U")"
  check "B4 signature for another path (expect 401 UNAUTHORIZED)" "$(cli pathswap "$U")"
  check "B5 nonce replay (expect first 200, replay 401 REPLAY_REJECTED)" "$(cli replay "$U")"
  echo "===== C. subject snapshot (Anthony's 070 bugs)"
  if [ -n "$N" ]; then check "C1 user WITHOUT epoch row (expect 200 active=true epoch=0; 070: 404)" "$(cli subject "$N")"
  else check "C1 user WITHOUT epoch row" "SKIPPED: every active user has an epoch row"; fi
  E=$(epoch "$U")
  check "C2 user with epoch row (expect 200 active=true epoch=$E)" "$(cli subject "$U")"
  check "C3 unknown user (expect 404 UNKNOWN_SUBJECT)" "$(cli subject "$(cat /proc/sys/kernel/random/uuid)")"
  q -q -c "UPDATE warehouse_identity.users SET status='LOCKED',locked_until=clock_timestamp()+interval '15 minutes' WHERE user_id='$U'"
  check "C4 lockout (expect active=true epoch=$E; 070: active=false)" "$(cli subject "$U")"
  q -q -c "UPDATE warehouse_identity.users SET status='SUSPENDED',locked_until=NULL WHERE user_id='$U'"
  check "C5 SUSPENDED (expect active=false epoch=$((E+1)))" "$(cli subject "$U")"
  q -q -c "UPDATE warehouse_identity.users SET status='ACTIVE' WHERE user_id='$U'"
  check "   back to ACTIVE (expect active=true epoch=$((E+1)))" "$(cli subject "$U")"
  echo "===== F. federation"
  check "F1 no binding (expect 403 FEDERATION_BINDING_DENIED)" "$(cli fed stg-sub-1)"
  q -q -c "INSERT INTO warehouse_identity.eoc_federated_subject_bindings_v12(issuer,subject_hash,user_id,binding_status,evidence_reference,approved_by,secondary_approved_by,verified_at)
           VALUES('$ISS',encode(sha256(convert_to('stg-sub-1','UTF8')),'hex'),'$U','VERIFIED','STAGING-SYNTHETIC-EOC64','$A1','$A2',clock_timestamp())"
  check "F2 VERIFIED binding (expect 200 verified userId=<test user>)" "$(cli fed stg-sub-1)"
  check "F3 wrong subject (expect 403)" "$(cli fed stg-sub-2)"
  q -q -c "UPDATE warehouse_identity.users SET status='SUSPENDED' WHERE user_id='$U'"
  check "F4 bound user SUSPENDED (expect 403)" "$(cli fed stg-sub-1)"
  q -q -c "UPDATE warehouse_identity.users SET status='ACTIVE' WHERE user_id='$U'"
  q -q -c "UPDATE warehouse_identity.eoc_federated_subject_bindings_v12 SET binding_status='REVOKED',revoked_at=clock_timestamp() WHERE issuer='$ISS'"
  check "F5 binding REVOKED (expect 403)" "$(cli fed stg-sub-1)"
  echo "===== L. leadership appointment (synthetic CEO linked to the test user; removed afterwards)"
  check "L1 no appointment (expect appointments=0, activeAppointment=none)" "$(cli appt "$U")"
  if q -q -c "BEGIN;
      INSERT INTO enterprise_org.positions(position_code,position_title,function_key)
        SELECT 'CEO','Staging EOC64 Synthetic CEO','EXECUTIVE' WHERE NOT EXISTS (SELECT 1 FROM enterprise_org.positions WHERE position_code='CEO');
      INSERT INTO enterprise_org.leadership_people(person_key,full_name,iam_user_id,iam_link_authority,iam_link_evidence_reference,iam_link_verified_at,record_status)
        VALUES('STG_EOC64_TEST_PERSON','Staging EOC64 Test Person','$U','TCDS_GOVERNED_IAM','STAGING-SYNTHETIC-EOC64',clock_timestamp(),'VERIFIED');
      INSERT INTO enterprise_org.leadership_appointments(person_id,position_code,appointment_status,effective_from,approved_by_iam_user_id,approval_reference,approved_at)
        SELECT person_id,'CEO','ACTIVE',current_date,'$A1','STAGING-SYNTHETIC-EOC64',clock_timestamp()
        FROM enterprise_org.leadership_people WHERE person_key='STG_EOC64_TEST_PERSON';
      COMMIT;"; then
    check "L2 ACTIVE CEO appointment (expect appointments=1, activeAppointment=CEO -> CEO)" "$(cli appt "$U")"
    q -q -c "UPDATE enterprise_org.leadership_appointments SET appointment_status='ON_LEAVE' WHERE approval_reference='STAGING-SYNTHETIC-EOC64'"
    check "L3 appointment ON_LEAVE (expect appointments=1, activeAppointment=none)" "$(cli appt "$U")"
  else check "L2 synthetic appointment" "SKIPPED: fixture insert refused (error above) - paste it to me"; fi
  echo "===== H. housekeeping"
  q -q -c "INSERT INTO warehouse_identity.eoc_bridge_nonces_v12(nonce_hash,expires_at) VALUES(repeat('a',64),clock_timestamp()-interval '1 minute')"
  cli ready >/dev/null
  check "H1 expired nonce pruned on next request (expect 0)" "$(q -c "SELECT count(*) FROM warehouse_identity.eoc_bridge_nonces_v12 WHERE expires_at<clock_timestamp()")"
  check "H2 audit rows written by this run" "$(q -c "SELECT count(*)-$A0 FROM warehouse_identity.eoc_bridge_audit_v12") ($(q -c "SELECT string_agg(event_type||'='||n,' ' ORDER BY event_type) FROM (SELECT event_type,count(*) n FROM (SELECT event_type FROM warehouse_identity.eoc_bridge_audit_v12 ORDER BY audit_id DESC LIMIT $(q -c "SELECT count(*)-$A0 FROM warehouse_identity.eoc_bridge_audit_v12")) z GROUP BY 1) y"))"
  check "H3 tcds_login_api cannot read bindings directly (expect f)" "$(q -c "SELECT has_table_privilege('tcds_login_api','warehouse_identity.eoc_federated_subject_bindings_v12','SELECT')")"
  echo "EOC64 BRIDGE TEST DONE (fixtures removed, test user back to ACTIVE)"
  ;;
*) echo "usage: $0 inspect-leadership|db-rehearse|db-install|db-uninstall|patch|test|revert"; exit 2;;
esac
