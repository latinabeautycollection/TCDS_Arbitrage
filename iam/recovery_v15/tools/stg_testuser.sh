#!/usr/bin/env bash
# Synthetic test identities on STAGING only (kqcdqtazcqaawdkmcfed), for driving the real 6.1B routes on the staging
# login-v2-api (127.0.0.1:8195). Facility LV2TEST. Passwords/tokens are random, kept in ~/stg_login/*.env (600), never printed.
#   seed        3 users: stg_employee_1 (WAREHOUSE_OPERATOR), stg_approver_1 + stg_approver_2 (IAM_ADMIN), with employees,
#               Argon2id credentials hashed exactly like passwordService.ts (password\0pepper, policy cost settings)
#   reset       new TOKEN_ISSUED reset request for stg_employee_1 (30 min), token hashed like approveReset (HMAC-SHA256)
#   http-reset  POST /api/v1/auth/password-reset/claim then /consume on the staging API (prints status codes only)
#   check       state of the test identities (no secrets)
#   unseed      delete the test identities and their reset requests (CONFIRM=UNSEED-STG)
# Usage: bash /tmp/recov15/stg_testuser.sh <cmd>   (run from /srv/arb-system/api)
set -euo pipefail
cd /srv/arb-system/api
eval "$(grep -E '^(PGHOST|PGPORT|PGDATABASE|PGUSER|PGPASSWORD|PGSSLMODE)=' .env | sed -E "s/^([A-Z_]+)=(.*)$/export \1='\2'/")"
export PGHOST=db.kqcdqtazcqaawdkmcfed.supabase.co PGPORT=5432 PGDATABASE=postgres PGUSER=postgres
[ "$PGHOST" = "db.kqcdqtazcqaawdkmcfed.supabase.co" ] || { echo "not the staging host - stopping"; exit 1; }
S=$HOME/stg_login
CFG=$S/config.json
grep -q kqcdqtazcqaawdkmcfed "$CFG" || { echo "$CFG is not the staging config - stopping"; exit 1; }
export NODE_PATH=$S/6.1B/node_modules
FACILITY=LV2TEST
API=http://127.0.0.1:8195
umask 077
q() { PAGER=cat psql -X -At -v ON_ERROR_STOP=1 "$@"; }

case "${1:-}" in
seed)
  [ "$(q -c "SELECT count(*) FROM warehouse_identity.users WHERE normalized_username LIKE 'stg\_%'")" = "0" ] || { echo "test users already exist (unseed first)"; exit 1; }
  POLICY=$(q -c "SELECT to_jsonb(p)::text FROM warehouse_identity.password_policies p WHERE active")
  FAC=$(q -c "SELECT facility_id FROM warehouse.facilities WHERE facility_code='$FACILITY' AND status='ACTIVE'")
  [ -n "$FAC" ] || { echo "facility $FACILITY not found"; exit 1; }
  # Hashes and the SQL are produced in node; passwords go only to testusers.env.
  POLICY="$POLICY" FAC="$FAC" CFG="$CFG" OUT="$S" node -e '
    const fs=require("fs"),crypto=require("crypto"),argon2=require("argon2");
    const p=JSON.parse(process.env.POLICY),cfg=JSON.parse(fs.readFileSync(process.env.CFG,"utf8"));
    const pepper=cfg.api.PASSWORD_PEPPER_CURRENT;
    const roles={stg_employee_1:"WAREHOUSE_OPERATOR",stg_approver_1:"IAM_ADMIN",stg_approver_2:"IAM_ADMIN"};
    const pw=()=>"Q"+crypto.randomBytes(15).toString("base64url")+"z9!";
    const lit=s=>"\x27"+String(s).replace(/\x27/g,"\x27\x27")+"\x27";
    (async()=>{
     const o={type:argon2.argon2id,memoryCost:p.argon2_memory_cost,timeCost:p.argon2_time_cost,parallelism:p.argon2_parallelism,hashLength:p.argon2_hash_length};
     let env="",sql="BEGIN;\n",n=0;
     for(const [u,role] of Object.entries(roles)){
      n++;const id=crypto.randomUUID(),pass=pw();
      const hash=await argon2.hash(Buffer.from(`${pass}\u0000${pepper}`,"utf8"),o);
      const params={algorithm:"ARGON2ID",policyId:p.password_policy_id,policyVersion:p.policy_version,policyChecksum:p.policy_sha256,...o};
      env+=`${u.toUpperCase()}_USER_ID=${id}\n${u.toUpperCase()}_PASSWORD=${pass}\n`;
      sql+=`INSERT INTO warehouse_identity.users(user_id,username,display_name,password_changed_at) VALUES(${lit(id)},${lit(u)},${lit("Staging Test "+n)},clock_timestamp());\n`;
      sql+=`INSERT INTO warehouse_identity.employees(user_id,employee_number,facility_id) VALUES(${lit(id)},${lit("STG-"+String(9000+n))},${lit(process.env.FAC)});\n`;
      sql+=`INSERT INTO warehouse_identity.password_credentials(user_id,password_hash,parameters,must_change,expires_at) VALUES(${lit(id)},${lit(hash)},${lit(JSON.stringify(params))}::jsonb,false,clock_timestamp()+interval ${lit(p.maximum_age_days+" days")});\n`;
      sql+=`INSERT INTO warehouse_identity.user_role_assignments(user_id,role_id,facility_id) SELECT ${lit(id)},role_id,${lit(process.env.FAC)} FROM warehouse_identity.roles WHERE role_code=${lit(role)} AND active;\n`;
     }
     sql+="COMMIT;\n";
     fs.writeFileSync(process.env.OUT+"/testusers.env",env,{mode:0o600});
     fs.writeFileSync(process.env.OUT+"/seed.sql",sql,{mode:0o600});
    })().catch(e=>{console.error("seed generation failed:",e.message);process.exit(1)});'
  q -q -f "$S/seed.sql"; rm -f "$S/seed.sql"
  echo "SEEDED (passwords in $S/testusers.env, 600)"; bash "$0" check
  ;;
reset)
  # shellcheck disable=SC1090
  . "$S/testusers.env"
  CFG="$CFG" OUT="$S" EMP="$STG_EMPLOYEE_1_USER_ID" A1="$STG_APPROVER_1_USER_ID" A2="$STG_APPROVER_2_USER_ID" node -e '
    const fs=require("fs"),crypto=require("crypto");const cfg=JSON.parse(fs.readFileSync(process.env.CFG,"utf8"));
    const token=crypto.randomBytes(32).toString("base64url");
    const th=crypto.createHmac("sha256",cfg.api.SESSION_HASH_KEY).update(token).digest("hex");
    const id=crypto.randomUUID();
    fs.writeFileSync(process.env.OUT+"/reset.env",`RESET_REQUEST_ID=${id}\nRESET_TOKEN=${token}\n`,{mode:0o600});
    fs.writeFileSync(process.env.OUT+"/reset.sql",`INSERT INTO warehouse_identity.password_reset_requests
     (password_reset_request_id,user_id,request_type,status,token_hash,requested_by,approved_by,reason_code,reason,expires_at,request_id,correlation_id)
     VALUES(\x27${id}\x27,\x27${process.env.EMP}\x27,\x27ADMIN_RESET\x27,\x27TOKEN_ISSUED\x27,decode(\x27${th}\x27,\x27hex\x27),
     \x27${process.env.A1}\x27,\x27${process.env.A2}\x27,\x27STAGING_TEST\x27,\x27staging route test\x27,clock_timestamp()+interval \x2730 minutes\x27,
     gen_random_uuid(),gen_random_uuid());\n`,{mode:0o600});'
  q -q -f "$S/reset.sql"; rm -f "$S/reset.sql"
  echo "RESET REQUEST CREATED: TOKEN_ISSUED for stg_employee_1, expires in 30 min (token in $S/reset.env)"
  ;;
http-reset)
  . "$S/reset.env"
  RID="$RESET_REQUEST_ID" TOK="$RESET_TOKEN" OUT="$S" API="$API" node -e '
    const fs=require("fs"),crypto=require("crypto");
    const H={"content-type":"application/json","origin":"https://warehouse-app.tcdsolutionsgroup.com"};
    const post=async(p,b)=>{const r=await fetch(process.env.API+p,{method:"POST",headers:H,body:JSON.stringify(b)});
      let j;try{j=await r.json()}catch{j={}};return [r.status,j]};
    (async()=>{
     let [s,j]=await post("/api/v1/auth/password-reset/claim",{requestId:process.env.RID,token:process.env.TOK});
     console.log("claim ->",s,j.error?JSON.stringify(j.error):"keys="+Object.keys(j).join(","), j.outcome?("outcome="+j.outcome):"");
     if(s!==200||!j.claimToken){process.exit(0)}
     const pw="R"+crypto.randomBytes(15).toString("base64url")+"x7#";
     const t0=Date.now();
     [s,j]=await post("/api/v1/auth/password-reset/consume",{requestId:process.env.RID,claimToken:j.claimToken,browserBinding:j.browserBinding,newPassword:pw});
     console.log("consume ->",s,JSON.stringify(j.error||j),"("+(Date.now()-t0)+" ms)");
     if(s===200)fs.appendFileSync(process.env.OUT+"/testusers.env",`STG_EMPLOYEE_1_PASSWORD_AFTER_RESET=${pw}\n`);
    })().catch(e=>{console.error("http-reset failed:",e.message);process.exit(1)});'
  bash "$0" check
  ;;
check)
  q <<'SQL'
SELECT 'user | ' || u.username || ' status=' || u.status || ' role=' || coalesce(string_agg(DISTINCT r.role_code, ','), '-')
  || ' facility=' || coalesce(max(f.facility_code::text), '-')
  || ' cred_changed=' || coalesce(to_char(max(pc.changed_at),'HH24:MI:SS'),'-') || ' must_change=' || coalesce(bool_or(pc.must_change)::text,'-')
  || ' active_sessions=' || (SELECT count(*) FROM warehouse_identity.auth_sessions s WHERE s.user_id=u.user_id AND s.revoked_at IS NULL)
FROM warehouse_identity.users u
LEFT JOIN warehouse_identity.employees e ON e.user_id=u.user_id LEFT JOIN warehouse.facilities f ON f.facility_id=e.facility_id
LEFT JOIN warehouse_identity.user_role_assignments a ON a.user_id=u.user_id AND a.revoked_at IS NULL
LEFT JOIN warehouse_identity.roles r ON r.role_id=a.role_id
LEFT JOIN warehouse_identity.password_credentials pc ON pc.user_id=u.user_id AND pc.revoked_at IS NULL
WHERE u.normalized_username LIKE 'stg\_%' GROUP BY u.user_id, u.username, u.status ORDER BY u.username;
SELECT 'reset | ' || left(r.password_reset_request_id::text,8) || ' status=' || r.status || ' attempts=' || r.token_attempt_count
  || ' claimed=' || (r.verification_claim_token_hash IS NOT NULL) || ' consumed=' || coalesce(to_char(r.token_consumed_at,'HH24:MI:SS'),'-')
  || ' completed=' || coalesce(to_char(r.completed_at,'HH24:MI:SS'),'-') || ' expires=' || coalesce(to_char(r.expires_at,'HH24:MI:SS'),'-')
FROM warehouse_identity.password_reset_requests r JOIN warehouse_identity.users u ON u.user_id=r.user_id
WHERE u.normalized_username LIKE 'stg\_%' ORDER BY r.created_at DESC LIMIT 5;
SQL
  ;;
unseed)
  [ "${CONFIRM:-}" = "UNSEED-STG" ] || { echo "set CONFIRM=UNSEED-STG"; exit 1; }
  q -q <<'SQL'
BEGIN;
CREATE TEMP TABLE t ON COMMIT DROP AS SELECT user_id FROM warehouse_identity.users WHERE normalized_username LIKE 'stg\_%';
DELETE FROM warehouse_identity.password_reset_requests WHERE user_id IN (SELECT user_id FROM t) OR requested_by IN (SELECT user_id FROM t) OR approved_by IN (SELECT user_id FROM t);
DELETE FROM warehouse_identity.auth_sessions WHERE user_id IN (SELECT user_id FROM t);
DELETE FROM warehouse_identity.employees WHERE user_id IN (SELECT user_id FROM t);
DELETE FROM warehouse_identity.users WHERE user_id IN (SELECT user_id FROM t);
COMMIT;
SQL
  rm -f "$S/testusers.env" "$S/reset.env"; echo "UNSEEDED"
  ;;
*) echo "usage: $0 seed|reset|http-reset|check|unseed"; exit 2;;
esac
