#!/usr/bin/env bash
# STAGING ONLY. Item 3 (Anthony decision 3): login-v2-api consume as ONE transaction
#   guard (621 recovery_reset_guard_v15: policy + supplemental proof) -> consume_password_reset_v5 -> iam_advance_session_epoch_v15
# Routes unchanged except an OPTIONAL proofId on /password-reset/consume (unknown keys were already stripped).
#   db-install    apply 621 on the staging DB (one transaction, self-verifying)
#   db-uninstall  621 rollback (CONFIRM=UNINSTALL-621); must run before stg_recovery_install.sh uninstall
#   patch         back up src+dist, patch passwordResetService.ts + registerIdentityRoutes.ts, typecheck, compile to a
#                 scratch dir, copy ONLY the two compiled files into dist (refuses if the current dist for those two files
#                 is not what the unpatched src compiles to), restart login-v2-api-staging
#   test          HTTP certification on the staging API with the synthetic users (prints status/codes only)
#   revert        restore the backed-up src+dist files, restart (CONFIRM=REVERT-ITEM3)
# Needs /tmp/recov15/{621_*.sql, stg_testuser.sh}. Usage: bash /tmp/recov15/stg_item3.sh <cmd>  (from /srv/arb-system/api)
set -euo pipefail
cd /srv/arb-system/api
eval "$(grep -E '^(PGHOST|PGPORT|PGDATABASE|PGUSER|PGPASSWORD|PGSSLMODE)=' .env | sed -E "s/^([A-Z_]+)=(.*)$/export \1='\2'/")"
export PGHOST=db.kqcdqtazcqaawdkmcfed.supabase.co PGPORT=5432 PGDATABASE=postgres PGUSER=postgres
[ "$PGHOST" = "db.kqcdqtazcqaawdkmcfed.supabase.co" ] || { echo "not the staging host - stopping"; exit 1; }
D=/tmp/recov15
S=$HOME/stg_login
B=$S/6.1B
BK=$S/item3_backup
API=http://127.0.0.1:8195
APP=login-v2-api-staging
grep -q kqcdqtazcqaawdkmcfed "$S/config.json" || { echo "$S/config.json is not the staging config - stopping"; exit 1; }
q() { PAGER=cat psql -X -At -v ON_ERROR_STOP=1 "$@"; }
clean_pm2() { env -i HOME="$HOME" PATH="$PATH" USER="$USER" LANG=C.UTF-8 pm2 "$@"; }
FILES="src/services/passwordResetService.ts src/express/registerIdentityRoutes.ts"
OUTS="dist/services/passwordResetService.js dist/express/registerIdentityRoutes.js"
umask 077

restart_api() {
  clean_pm2 restart "$APP" >/dev/null
  for i in $(seq 1 30); do
    code=$(curl -s -o /dev/null -m 3 -w '%{http_code}' "$API/" || true)
    [ "$code" = "404" ] && { echo "$APP restarted, answering ($code)"; return 0; }
    sleep 1
  done
  echo "!! $APP not answering after restart; last log lines:"; pm2 logs "$APP" --nostream --lines 30 2>&1 | tail -30; exit 1
}

case "${1:-}" in
db-install)
  [ -z "$(q -c "SELECT to_regprocedure('warehouse_identity.recovery_reset_guard_v15(uuid,uuid)')")" ] || { echo "621 already installed"; exit 1; }
  sha256sum $D/621_recovery_v15_reset_guard.sql $D/621_recovery_v15_reset_guard.rollback.sql
  q -q -f $D/621_recovery_v15_reset_guard.sql
  q -c "SELECT 'installed | ' || p.oid::regprocedure::text || ' owner=' || pg_get_userbyid(p.proowner) || ' definer=' || p.prosecdef::text
        || ' login_api=' || has_function_privilege('tcds_login_api', p.oid, 'EXECUTE')::text
        || ' public=' || has_function_privilege('public', p.oid, 'EXECUTE')::text
        FROM pg_proc p WHERE p.proname = 'recovery_reset_guard_v15'"
  echo "621 INSTALLED ON STAGING at $(date -u +%FT%TZ)"
  ;;
db-uninstall)
  [ "${CONFIRM:-}" = "UNINSTALL-621" ] || { echo "set CONFIRM=UNINSTALL-621"; exit 1; }
  q -q -f $D/621_recovery_v15_reset_guard.rollback.sql; echo "621 ROLLED BACK"
  ;;
patch)
  [ -n "$(q -c "SELECT to_regprocedure('warehouse_identity.recovery_reset_guard_v15(uuid,uuid)')")" ] || { echo "run db-install first"; exit 1; }
  [ -e "$BK" ] && { echo "$BK exists - already patched? (revert first)"; exit 1; }
  cd "$B"
  echo "== baseline typecheck (unpatched)"; ./node_modules/.bin/tsc -p tsconfig.json --noEmit
  SCR=$(mktemp -d "$S/item3_build.XXXX")
  echo "== does the deployed dist match the unpatched src for the two files?"
  ./node_modules/.bin/tsc -p tsconfig.json --outDir "$SCR/base"
  for o in $OUTS; do
    cmp -s "$SCR/base/${o#dist/}" "$o" || { echo "REFUSING: deployed $o differs from what src compiles to (hand-patched dist?)"; diff "$SCR/base/${o#dist/}" "$o" | head -20; exit 1; }
    echo "match: $o"
  done
  mkdir -p "$BK"; for f in $FILES $OUTS; do mkdir -p "$BK/$(dirname $f)"; cp -p "$f" "$BK/$f"; done
  echo "== patching src"
  node - "$B" <<'NODE'
const fs=require("fs"),path=require("path"),B=process.argv[2];
function edit(file,pairs){const p=path.join(B,file);let s=fs.readFileSync(p,"utf8");
 for(const [a,b] of pairs){const n=s.split(a).length-1;if(n!==1)throw Error(file+": expected 1 match, found "+n+" for: "+a.slice(0,70));s=s.replace(a,()=>b)}
 fs.writeFileSync(p,s);console.log("patched "+file+" ("+pairs.length+" edits)")}
edit("src/services/passwordResetService.ts",[
 ['import type {DbPool} from "../db/pool.js";','import {tx,type DbPool} from "../db/pool.js";'],
 ['newPassword:string,ids:RequestIds\n  ){','newPassword:string,ids:RequestIds,\n    proofId:string|null=null\n  ){'],
 ['    const r=await this.pool.query(\n      `SELECT warehouse_identity.consume_password_reset_v5($1,$2,$3,$4,$5,$6,$7,$8) AS result`,\n      [requestId,keyedHash(claimToken,this.env.SESSION_HASH_KEY),\n       keyedHash(browserBinding,this.env.SESSION_HASH_KEY),\n       h.hash,h.parameters,ids.requestId,ids.correlationId,policy.policyId]\n    );\n    return r.rows[0]?.result;',
`    // One transaction: supplemental-proof guard -> v5 consume -> IAM session epoch (+ security audit event).
    // Any failure rolls back all three. The slow checks above (HIBP, history, Argon2id) stay outside it.
    return tx(this.pool,async c=>{
      const g=await c.query(
        \`SELECT * FROM warehouse_identity.recovery_reset_guard_v15($1,$2)\`,
        [requestId,proofId]
      );
      if(g.rows[0]?.user_id!==row.user_id)throw new Error("RESET_SUBJECT_MISMATCH");
      const r=await c.query(
        \`SELECT warehouse_identity.consume_password_reset_v5($1,$2,$3,$4,$5,$6,$7,$8) AS result\`,
        [requestId,keyedHash(claimToken,this.env.SESSION_HASH_KEY),
         keyedHash(browserBinding,this.env.SESSION_HASH_KEY),
         h.hash,h.parameters,ids.requestId,ids.correlationId,policy.policyId]
      );
      if(r.rows[0]?.result!=="CONSUMED")throw new Error("RESET_NOT_CONSUMED");
      await c.query(
        \`SELECT warehouse_identity.iam_advance_session_epoch_v15($1,'PASSWORD_RESET',$2,$3) AS epoch\`,
        [row.user_id,ids.requestId,ids.correlationId]
      );
      return r.rows[0].result;
    });`]]);
edit("src/express/registerIdentityRoutes.ts",[
 ['      newPassword:z.string().min(1).max(1024)\n    }).parse(req.body);\n    const result=await guarded(req,d,\'PASSWORD_RESET_CONSUME\'',
  '      newPassword:z.string().min(1).max(1024),\n      proofId:U.optional()\n    }).parse(req.body);\n    const result=await guarded(req,d,\'PASSWORD_RESET_CONSUME\''],
 ['d.resets.consume(b.requestId,b.claimToken,b.browserBinding,b.newPassword,ids(req))',
  'd.resets.consume(b.requestId,b.claimToken,b.browserBinding,b.newPassword,ids(req),b.proofId??null)']]);
NODE
  echo "== typecheck + compile (patched)"
  ./node_modules/.bin/tsc -p tsconfig.json --noEmit
  ./node_modules/.bin/tsc -p tsconfig.json --outDir "$SCR/new"
  for o in $OUTS; do cp "$SCR/new/${o#dist/}" "$o"; chmod 644 "$o"; done
  echo "== other dist files differing from src (informational, untouched):"
  (cd "$SCR/base" && find . -name '*.js' | while read -r f; do cmp -s "$f" "$B/dist/$f" || echo "  differs: dist/${f#./}"; done) | head -20
  rm -rf "$SCR"
  sha256sum $FILES $OUTS
  restart_api
  echo "PATCHED (backup in $BK)"
  ;;
patch-errors)
  # Password-rule rejections were plain Errors -> the host's handler answered 500 INTERNAL_ERROR (T6).
  # Typed IdentityError(code,status) instead; the codes are unchanged. Only the reset service is touched.
  [ -d "$BK" ] || { echo "run patch first"; exit 1; }
  [ -e "$BK/errors_step" ] && { echo "patch-errors already applied"; exit 1; }
  cd "$B"
  SCR=$(mktemp -d "$S/item3_build.XXXX")
  ./node_modules/.bin/tsc -p tsconfig.json --outDir "$SCR/base"
  cmp -s "$SCR/base/services/passwordResetService.js" dist/services/passwordResetService.js \
    || { echo "REFUSING: deployed dist/services/passwordResetService.js is not the current src"; exit 1; }
  node - "$B" <<'NODE'
const fs=require("fs"),path=require("path"),p=path.join(process.argv[2],"src/services/passwordResetService.ts");
let s=fs.readFileSync(p,"utf8");
for(const [a,b] of [
 ['import {keyedHash,randomToken} from "../security/crypto.js";',
  'import {keyedHash,randomToken} from "../security/crypto.js";\nimport {IdentityError} from "../errors/errors.js";'],
 ['if(!row)throw new Error("RESET_NOT_FOUND");','if(!row)throw new IdentityError("RESET_NOT_FOUND",404);'],
 ['    this.passwords.enforceBasic(newPassword,policy,[row.username,row.employee_number]);\n\n    if(await this.passwords.breached(newPassword,policy.breachedCheckRequired))\n      throw new Error("PASSWORD_BREACHED");',
  '    try{this.passwords.enforceBasic(newPassword,policy,[row.username,row.employee_number]);}\n    catch(e){throw new IdentityError(e instanceof Error?e.message:"PASSWORD_POLICY",400);}\n\n    let breached:boolean;\n    try{breached=await this.passwords.breached(newPassword,policy.breachedCheckRequired);}\n    catch{throw new IdentityError("BREACHED_PASSWORD_SERVICE_UNAVAILABLE",503);}\n    if(breached)throw new IdentityError("PASSWORD_BREACHED",400);'],
 ['      throw new Error("PASSWORD_REUSE");','      throw new IdentityError("PASSWORD_REUSE",400);']]){
 const n=s.split(a).length-1;if(n!==1)throw Error("expected 1 match, found "+n+" for: "+a.slice(0,70));s=s.replace(a,()=>b)}
fs.writeFileSync(p,s);console.log("patched src/services/passwordResetService.ts (4 edits)");
NODE
  ./node_modules/.bin/tsc -p tsconfig.json --noEmit
  ./node_modules/.bin/tsc -p tsconfig.json --outDir "$SCR/new"
  cp "$SCR/new/services/passwordResetService.js" dist/services/passwordResetService.js; chmod 644 dist/services/passwordResetService.js
  rm -rf "$SCR"; touch "$BK/errors_step"
  sha256sum src/services/passwordResetService.ts dist/services/passwordResetService.js
  restart_api
  echo "PATCHED ERRORS (revert restores the original files)"
  ;;
revert)
  [ "${CONFIRM:-}" = "REVERT-ITEM3" ] || { echo "set CONFIRM=REVERT-ITEM3"; exit 1; }
  [ -d "$BK" ] || { echo "no backup in $BK"; exit 1; }
  for f in $FILES $OUTS; do cp -p "$BK/$f" "$B/$f"; done
  mv "$BK" "$BK.reverted.$(date +%s)"; restart_api; echo "REVERTED"
  ;;
test)
  . "$S/testusers.env"; U="$STG_EMPLOYEE_1_USER_ID"
  cat > "$S/item3_flow.cjs" <<'NODE'
const fs=require("fs"),crypto=require("crypto");
const H={"content-type":"application/json","origin":"https://warehouse-app.tcdsolutionsgroup.com"};
const post=async(p,b)=>{const t=Date.now(),r=await fetch(process.env.API+p,{method:"POST",headers:H,body:JSON.stringify(b)});
 let j;try{j=await r.json()}catch{j={}};return {s:r.status,j,code:j.error?j.error.code:(j.result||j.outcome||"-"),ms:Date.now()-t}};
const pw=()=>"R"+crypto.randomBytes(15).toString("base64url")+"x7#";
(async()=>{
 const RID=process.env.RID,c=await post("/api/v1/auth/password-reset/claim",{requestId:RID,token:process.env.TOK});
 console.log("claim "+c.s+" "+c.code);if(c.s!==200||!c.j.claimToken)return;
 const base={requestId:RID,claimToken:c.j.claimToken,browserBinding:c.j.browserBinding};
 for(const step of process.env.STEPS.split(",")){
  let body={...base,newPassword:pw()};
  const tags=step.split("+");
  if(tags.includes("proof"))body.proofId=process.env.PROOF;
  if(tags.includes("badclaim"))body.claimToken=crypto.randomBytes(32).toString("base64url");
  if(tags.includes("shortpw"))body.newPassword="short";
  if(tags.includes("identity"))body.newPassword="Zq!stg_employee_1_x9";
  if(tags.includes("breached"))body.newPassword="passwordpassword";
  if(tags.includes("reuse"))body.newPassword=process.env.PREV;
  const r=await post("/api/v1/auth/password-reset/consume",body);
  console.log("RESULT "+step+" "+r.s+" "+r.code+" ("+r.ms+" ms)");
  if(r.s===200)fs.appendFileSync(process.env.OUT+"/testusers.env","STG_EMPLOYEE_1_PASSWORD_AFTER_RESET="+body.newPassword+"\n");
 }
})().catch(e=>{console.error("flow failed:",e.message);process.exit(1)});
NODE
  flow() { . "$S/reset.env"; PREV=$(grep '^STG_EMPLOYEE_1_PASSWORD_AFTER_RESET=' "$S/testusers.env" | tail -1 | cut -d= -f2-) RID="$RESET_REQUEST_ID" TOK="$RESET_TOKEN" PROOF="${PROOF:-}" STEPS="$1" OUT="$S" API="$API" node "$S/item3_flow.cjs"; }
  state() { q -c "SELECT 'epoch=' || coalesce((SELECT epoch FROM warehouse_identity.iam_session_epochs_v15 WHERE user_id='$U'),0)
     || ' audit=' || (SELECT count(*) FROM warehouse_audit.security_events WHERE event_type='IAM_SESSION_EPOCH_ADVANCED' AND entity_id::text='$U')
     || ' cred_changed=' || (SELECT to_char(changed_at,'HH24:MI:SS.MS') FROM warehouse_identity.password_credentials WHERE user_id='$U' AND revoked_at IS NULL)
     || ' reset=' || coalesce((SELECT status FROM warehouse_identity.password_reset_requests WHERE password_reset_request_id='$RESET_REQUEST_ID'),'-')
     || ' proof_consumed=' || coalesce((SELECT (consumed_at IS NOT NULL)::text FROM warehouse_identity.recovery_proofs_v1 WHERE proof_id=nullif('${PROOF:-}','')::uuid),'-')"; }
  cleanup() { q -q -c "BEGIN; DELETE FROM warehouse_identity.recovery_proofs_v1 WHERE user_id='$U';
     DELETE FROM warehouse_identity.recovery_contact_challenges_v1 WHERE user_id='$U';
     DELETE FROM warehouse_identity.user_recovery_contacts WHERE user_id='$U'; COMMIT;"; }
  trap cleanup EXIT

  echo "===== T1 no recovery contact -> NO_SUPPLEMENTAL: consume works, epoch +1, audit +1, all in one commit"
  bash $D/stg_testuser.sh reset >/dev/null; . "$S/reset.env"; PROOF=
  echo "before: $(state)"; flow ok; echo "after:  $(state)"

  echo "===== T2-T5 verified+eligible contact -> REQUIRE_SUPPLEMENTAL"
  bash $D/stg_testuser.sh reset >/dev/null; . "$S/reset.env"
  PROOF=$(q -c "WITH ct AS (
      INSERT INTO warehouse_identity.user_recovery_contacts(user_id,contact_type,ciphertext,iv,tag,value_fingerprint,status,verification_method,verified_at,recovery_eligible_at,created_at,updated_at)
      VALUES('$U','EMAIL',uuid_send(gen_random_uuid())||uuid_send(gen_random_uuid()),substring(uuid_send(gen_random_uuid()) from 1 for 12),
             uuid_send(gen_random_uuid()),uuid_send(gen_random_uuid())||uuid_send(gen_random_uuid()),'VERIFIED','EMAIL_CODE',clock_timestamp()-interval '2 days',clock_timestamp()-interval '1 day',
             clock_timestamp()-interval '3 days',clock_timestamp()-interval '2 days')
      RETURNING contact_id),
    ch AS (
      INSERT INTO warehouse_identity.recovery_contact_challenges_v1(user_id,contact_id,purpose,reset_request_id,otp_hash,otp_salt,expires_at,consumed_at,delivery_state)
      SELECT '$U',contact_id,'PASSWORD_RESET','$RESET_REQUEST_ID',uuid_send(gen_random_uuid())||uuid_send(gen_random_uuid()),uuid_send(gen_random_uuid()),clock_timestamp()+interval '5 minutes',clock_timestamp(),'ACCEPTED' FROM ct
      RETURNING challenge_id)
    INSERT INTO warehouse_identity.recovery_proofs_v1(user_id,reset_request_id,challenge_id,assurance_method,expires_at)
    SELECT '$U','$RESET_REQUEST_ID',challenge_id,'VERIFIED_EMAIL_CODE',clock_timestamp()+interval '4 minutes' FROM ch RETURNING proof_id" | head -1)
  [ -n "$PROOF" ] || { echo "could not create the proof fixture"; exit 1; }
  echo "fixture: contact VERIFIED+eligible, proof for this reset request"
  echo "before: $(state)"
  echo "expect: T2 no proof -> 403 SUPPLEMENTAL_PROOF_REQUIRED | T3 proof+bad claim -> 403 RESET_INVALID (proof NOT consumed: rolled back)"
  echo "        T4 proof+good claim -> 200 CONSUMED | T5 replay -> 4xx, nothing changes"
  flow noproof,proof+badclaim,proof,proof
  echo "after:  $(state)"

  echo "===== T6-T9 password-rule rejections (before patch-errors: 500; after: 400 with the rule's code, nothing changes)"
  echo "expect: shortpw 400 PASSWORD_POLICY_LENGTH | identity 400 PASSWORD_CONTAINS_IDENTITY | breached 400 PASSWORD_BREACHED | reuse 400 PASSWORD_REUSE"
  cleanup; PROOF=
  bash $D/stg_testuser.sh reset >/dev/null; . "$S/reset.env"
  flow shortpw,identity,breached,reuse
  echo "after:  $(state)"
  echo "ITEM 3 TEST DONE (fixtures removed)"
  ;;
*) echo "usage: $0 db-install|db-uninstall|patch|patch-errors|test|revert"; exit 2;;
esac
