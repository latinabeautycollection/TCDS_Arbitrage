#!/usr/bin/env bash
# Dedicated database login for the Pack/Ship routes on PRODUCTION (vfxlrkqgakqqbnbbgecp):
#   tcds_login_packship  LOGIN, member of tcds_packship_api ONLY (INHERIT, no SET), no other privileges.
# The password is generated here, only its SCRAM verifier goes to the database, and the URL is written only into the
# Login V2 config.json (0600, backed up first) as packship.DATABASE_URL. Nothing secret is printed.
#   rehearse  create role + grant + role-bound checks AS the new role (SET ROLE) in one transaction, ROLLBACK.
#   create    CONFIRM=CREATE-PACKSHIP-LOGIN: create the role (COMMIT), then write packship.DATABASE_URL.
#   test      read only: connect AS tcds_login_packship over the network with the stored URL and run the checks.
#   drop      CONFIRM=DROP-PACKSHIP-LOGIN: drop the role and remove packship from config.json (backup kept).
# Usage: bash /tmp/domain6_scanner/packship_routes_v16/packship_login.sh rehearse|create|test|drop
set -uo pipefail
ROLE=tcds_login_packship
CFG=/srv/arb-system/loginv2_runtime/config.json
NM=/srv/arb-system/loginv2_runtime/build/6.1B/node_modules
umask 077
cd /srv/arb-system/api || exit 1
eval "$(grep -E '^(PGHOST|PGPORT|PGDATABASE|PGUSER|PGPASSWORD|PGSSLMODE)=' .env | sed -E "s/^([A-Z_]+)=(.*)$/export \1='\2'/")"
case "${PGHOST:-}${PGUSER:-}" in *vfxlrkqgakqqbnbbgecp*) ;; *) echo "not the production database - stopping"; exit 1;; esac
PSQL=(psql -X -q -At -v ON_ERROR_STOP=1)
export PAGER=cat

# $1 = PASSWORD clause ('NULL' or the quoted SCRAM verifier)
role_sql() { cat <<SQL
SET LOCAL lock_timeout = '5s';
DO \$\$ BEGIN IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '$ROLE') THEN RAISE EXCEPTION '$ROLE already exists'; END IF; END \$\$;
CREATE ROLE $ROLE LOGIN INHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS CONNECTION LIMIT 20 PASSWORD $1;
GRANT tcds_packship_api TO $ROLE WITH INHERIT TRUE, SET FALSE;
ALTER ROLE $ROLE SET statement_timeout = '15s';
ALTER ROLE $ROLE SET lock_timeout = '5s';
ALTER ROLE $ROLE SET idle_in_transaction_session_timeout = '60s';
COMMENT ON ROLE $ROLE IS 'Pack/Ship route layer (Login V2 host). Member of tcds_packship_api only. Created by packship_login.sh.';
SQL
}

case "${1:-}" in
rehearse)
  echo "target: production, mode=rehearse (ROLLBACK at the end)"
  { echo "BEGIN;"; role_sql NULL; cat <<SQL
SELECT 'R1 role: login=' || rolcanlogin || ' super=' || rolsuper || ' bypassrls=' || rolbypassrls || ' createrole=' || rolcreaterole
  FROM pg_roles WHERE rolname = '$ROLE';
SELECT 'R2 memberships: ' || string_agg(r.rolname || '(inherit=' || m.inherit_option || ',set=' || m.set_option || ')', ', ')
  FROM pg_auth_members m JOIN pg_roles r ON r.oid = m.roleid WHERE m.member = '$ROLE'::regrole;
GRANT $ROLE TO postgres WITH INHERIT FALSE, SET TRUE;   -- rehearsal only, rolled back: lets the checks run AS the role
SET LOCAL ROLE $ROLE;
DO \$\$
DECLARE e text; out text[] := '{}'; f int := 0;
BEGIN
  out := out || text('R3 current_user = ' || current_user);
  BEGIN PERFORM warehouse.packship_get_task_v2(gen_random_uuid(), gen_random_uuid()); e := 'NO_ERROR';
  EXCEPTION WHEN OTHERS THEN e := SQLERRM; END;
  IF e = 'PACKSHIP_SESSION_INVALID' THEN out := out || text('PASS R4 get_task_v2 executes, unknown session refused (' || e || ')');
  ELSE f := f + 1; out := out || text('FAIL R4 get_task_v2 (' || e || ')'); END IF;
  BEGIN PERFORM warehouse.packship_claim_task_v2(gen_random_uuid(), gen_random_uuid(), 'psv16-rehearse-0001', NULL, NULL); e := 'NO_ERROR';
  EXCEPTION WHEN OTHERS THEN e := SQLERRM; END;
  IF e = 'PACKSHIP_SESSION_INVALID' THEN out := out || text('PASS R5 claim_task_v2 executes (' || e || ')');
  ELSE f := f + 1; out := out || text('FAIL R5 claim_task_v2 (' || e || ')'); END IF;
  BEGIN PERFORM warehouse.packship_create_task_v2(gen_random_uuid(), NULL, NULL, NULL, NULL, 'psv16-rehearse-0002', NULL, NULL); e := 'NO_ERROR';
  EXCEPTION WHEN OTHERS THEN e := SQLERRM; END;
  IF e LIKE 'permission denied%' THEN out := out || text('PASS R6 create_task_v2 denied (system role only)');
  ELSE f := f + 1; out := out || text('FAIL R6 create_task_v2 (' || e || ')'); END IF;
  BEGIN PERFORM count(*) FROM warehouse.packing_tasks; e := 'NO_ERROR'; EXCEPTION WHEN OTHERS THEN e := SQLERRM; END;
  IF e LIKE 'permission denied%' THEN out := out || text('PASS R7 direct SELECT on packing_tasks denied');
  ELSE f := f + 1; out := out || text('FAIL R7 packing_tasks (' || e || ')'); END IF;
  BEGIN PERFORM count(*) FROM warehouse_identity.auth_sessions; e := 'NO_ERROR'; EXCEPTION WHEN OTHERS THEN e := SQLERRM; END;
  IF e LIKE 'permission denied%' THEN out := out || text('PASS R8 identity tables denied');
  ELSE f := f + 1; out := out || text('FAIL R8 auth_sessions (' || e || ')'); END IF;
  BEGIN PERFORM warehouse.packship__actor(gen_random_uuid()); e := 'NO_ERROR'; EXCEPTION WHEN OTHERS THEN e := SQLERRM; END;
  IF e LIKE 'permission denied%' THEN out := out || text('PASS R9 internal helper packship__actor denied');
  ELSE f := f + 1; out := out || text('FAIL R9 packship__actor (' || e || ')'); END IF;
  FOR i IN 1 .. cardinality(out) LOOP RAISE NOTICE '%', out[i]; END LOOP;
  RAISE NOTICE 'SUMMARY: % passed, % failed', 6 - f, f;
END \$\$;
RESET ROLE;
ROLLBACK;
SQL
  } | "${PSQL[@]}" 2>&1
  rc=${PIPESTATUS[1]}
  [ "$rc" -eq 0 ] && echo "rehearse finished (ROLLBACK) rc=0" || echo "rehearse FAILED rc=$rc - nothing was kept"
  exit "$rc" ;;

create)
  [ "${CONFIRM:-}" = "CREATE-PACKSHIP-LOGIN" ] || { echo "set CONFIRM=CREATE-PACKSHIP-LOGIN"; exit 1; }
  [ -f "$CFG" ] || { echo "no $CFG"; exit 1; }
  node -e 'const c=require(process.argv[1]);if(c.packship)throw Error("config already has packship")' "$CFG" || exit 1
  PW=$(openssl rand -hex 32)
  VER=$(PW="$PW" node -e 'const c=require("crypto"),pw=process.env.PW,salt=c.randomBytes(16),it=4096;
    const sp=c.pbkdf2Sync(pw,salt,it,32,"sha256"),h=(k,m)=>c.createHmac("sha256",k).update(m).digest();
    const stored=c.createHash("sha256").update(h(sp,"Client Key")).digest();
    process.stdout.write(`SCRAM-SHA-256$${it}:${salt.toString("base64")}$${stored.toString("base64")}:${h(sp,"Server Key").toString("base64")}`)')
  echo "target: production, mode=create"
  { echo "BEGIN;"; role_sql "'$VER'"; echo "COMMIT;"; } | "${PSQL[@]}" 2>&1
  rc=${PIPESTATUS[1]}
  [ "$rc" -eq 0 ] || { unset PW VER; echo "create FAILED rc=$rc - nothing was committed, config untouched"; exit "$rc"; }
  echo "role created"
  BK="$CFG.bak-packship-$(date -u +%Y%m%dT%H%M%SZ)"; cp -p "$CFG" "$BK"
  PW="$PW" ROLE="$ROLE" node -e 'const fs=require("fs"),f=process.argv[1],c=JSON.parse(fs.readFileSync(f,"utf8"));
    const u=new URL(c.api.DATABASE_URL);u.username=process.env.ROLE;u.password=process.env.PW;
    c.packship={DATABASE_URL:u.toString()};const t=f+".tmp";fs.writeFileSync(t,JSON.stringify(c,null,2)+"\n",{mode:0o600});fs.renameSync(t,f)' "$CFG"
  unset PW VER
  echo "config.json: packship.DATABASE_URL written (mode $(stat -c %a "$CFG")); backup $BK"
  echo "next: bash $0 test" ;;

test)
  NODE_PATH=$NM node - "$CFG" <<'NODE'
const {Client}=require("pg"),cfg=require(process.argv[2]);
if(!cfg.packship||!cfg.packship.DATABASE_URL){console.log("no packship.DATABASE_URL in config");process.exit(1)}
(async()=>{const c=new Client({connectionString:cfg.packship.DATABASE_URL});await c.connect();let fail=0;
 const t=async(name,sql,ok)=>{let r;try{await c.query(sql);r="NO_ERROR"}catch(e){r=e.message}
   const pass=ok(r);if(!pass)fail++;console.log((pass?"PASS ":"FAIL ")+name+" ("+r+")")};
 const me=(await c.query("select current_user u, (select rolsuper or rolbypassrls from pg_roles where rolname=current_user) p")).rows[0];
 console.log((me.u==="tcds_login_packship"&&me.p===false?"PASS":"FAIL")+" T1 connected over the network as "+me.u+", no super/bypassrls");if(me.u!=="tcds_login_packship"||me.p!==false)fail++;
 await t("T2 get_task_v2 executes, unknown session refused","select warehouse.packship_get_task_v2(gen_random_uuid(),gen_random_uuid())",r=>r==="PACKSHIP_SESSION_INVALID");
 await t("T3 create_task_v2 denied","select warehouse.packship_create_task_v2(gen_random_uuid(),null,null,null,null,'psv16-test-0001',null,null)",r=>/^permission denied/.test(r));
 await t("T4 direct SELECT on packing_tasks denied","select count(*) from warehouse.packing_tasks",r=>/^permission denied/.test(r));
 await t("T5 identity tables denied","select count(*) from warehouse_identity.auth_sessions",r=>/^permission denied/.test(r));
 await t("T6 internal helper packship__actor denied","select warehouse.packship__actor(gen_random_uuid())",r=>/^permission denied/.test(r));
 await c.end();console.log("SUMMARY: "+(6-fail)+" passed, "+fail+" failed");process.exit(fail?1:0)})().catch(e=>{console.log("connect/test error: "+e.message);process.exit(1)});
NODE
  ;;

drop)
  [ "${CONFIRM:-}" = "DROP-PACKSHIP-LOGIN" ] || { echo "set CONFIRM=DROP-PACKSHIP-LOGIN"; exit 1; }
  echo "BEGIN; SET LOCAL lock_timeout = '5s'; DROP ROLE IF EXISTS $ROLE; COMMIT;" | "${PSQL[@]}" 2>&1 || { echo "drop FAILED"; exit 1; }
  if node -e 'process.exit(require(process.argv[1]).packship?0:1)' "$CFG"; then
    BK="$CFG.bak-packship-drop-$(date -u +%Y%m%dT%H%M%SZ)"; cp -p "$CFG" "$BK"
    node -e 'const fs=require("fs"),f=process.argv[1],c=JSON.parse(fs.readFileSync(f,"utf8"));delete c.packship;
      const t=f+".tmp";fs.writeFileSync(t,JSON.stringify(c,null,2)+"\n",{mode:0o600});fs.renameSync(t,f)' "$CFG"
    echo "role dropped; packship removed from config.json (backup $BK)"
  else echo "role dropped; config.json had no packship entry"; fi ;;

*) echo "usage: $0 rehearse|create|test|drop"; exit 2 ;;
esac
