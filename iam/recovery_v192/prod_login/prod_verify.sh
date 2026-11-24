#!/usr/bin/env bash
# READ-ONLY. Confirms in the production database and services that the first end-to-end recovery test really completed:
# recovery email enrolled + approved by the approver's passkey, reset approved + code used once + password changed,
# sessions invalidated, nothing secret left in the outbox, services healthy. Prints PASS/FAIL, no secrets, no addresses.
#   bash /tmp/prod_recovery/login/prod_verify.sh   [UN=recovery.test] [APPROVER=anthony.malone]
set -uo pipefail
UN=${UN:-recovery.test}; APPROVER=${APPROVER:-anthony.malone}
cd /srv/arb-system/api
eval "$(grep -E '^(PGHOST|PGPORT|PGDATABASE|PGUSER|PGPASSWORD|PGSSLMODE)=' .env | sed -E "s/^([A-Z_]+)=(.*)$/export \1='\2'/")"
case "$PGHOST $PGUSER" in *vfxlrkqgakqqbnbbgecp*) ;; *) echo "not production - stopping"; exit 1;; esac
export PGOPTIONS='-c default_transaction_read_only=on'
PASSN=0; FAILN=0
chk() { # $1 label, $2 sql returning "t|detail"
  local r; r=$(PAGER=cat psql -X -q -At -v ON_ERROR_STOP=1 -v un="$UN" -v appr="$APPROVER" 2>&1 <<< "$2") || r="f|query error: $(echo "$r" | head -1)"
  local ok=${r%%|*} d=${r#*|}
  if [ "$ok" = t ] || [ "$ok" = true ]; then PASSN=$((PASSN+1)); echo "PASS $1 | $d"; else FAILN=$((FAILN+1)); echo "FAIL $1 | $d"; fi; }
U="(SELECT user_id FROM warehouse_identity.users WHERE normalized_username=lower(:'un'))"
A="(SELECT user_id FROM warehouse_identity.users WHERE normalized_username=lower(:'appr'))"

echo "== recovery email (TCDS 645)"
chk "test employee has exactly one verified, eligible recovery email" "SELECT (count(*)=1 AND bool_and(recovery_eligible_at<=now()))::text||'|count='||count(*)
  FROM warehouse_identity.user_recovery_contacts WHERE user_id=$U AND contact_type='EMAIL' AND status='VERIFIED';"
chk "latest enrollment APPROVED with an approval" "SELECT (e.status='APPROVED' AND (SELECT count(*) FROM warehouse_identity.recovery_contact_approvals_v645 a WHERE a.enrollment_id=e.enrollment_id)>=1)::text
  ||'|'||e.status||', '||e.contact_hint||', approvals='||(SELECT count(*) FROM warehouse_identity.recovery_contact_approvals_v645 a WHERE a.enrollment_id=e.enrollment_id)
  FROM warehouse_identity.recovery_contact_enrollments_v645 e WHERE e.user_id=$U ORDER BY e.created_at DESC LIMIT 1;"
chk "approval recorded as a security event" "SELECT (count(*)>=1)::text||'|events='||count(*) FROM warehouse_audit.security_events
  WHERE event_type='RECOVERY_CONTACT_APPROVED' AND details->>'enrollmentId' IN (SELECT enrollment_id::text FROM warehouse_identity.recovery_contact_enrollments_v645 WHERE user_id=$U);"
chk "approver has an active passkey on login.tcdsolutionsgroup.com" "SELECT (count(*)>=1)::text||'|active='||count(*) FROM warehouse_identity.central_passkeys
  WHERE user_id=$A AND security_state='ACTIVE' AND rp_id='login.tcdsolutionsgroup.com';"
chk "approver holds the recovery-email approver role" "SELECT (count(*)=1)::text||'|until '||coalesce(max(valid_until)::date::text,'-') FROM warehouse_identity.user_role_assignments
  WHERE user_id=$A AND revoked_at IS NULL AND (valid_until IS NULL OR valid_until>now())
    AND role_id=(SELECT role_id FROM warehouse_identity.roles WHERE role_code='IAM_RECOVERY_DESTINATION_APPROVER');"

echo "== password reset (V1.9.2 + 644)"
chk "latest reset request COMPLETED" "SELECT (status='COMPLETED')::text||'|'||status||', requested '||to_char(created_at,'YYYY-MM-DD HH24:MI')||' UTC'
  FROM warehouse_identity.password_reset_requests WHERE user_id=$U ORDER BY created_at DESC LIMIT 1;"
chk "exactly one emailed code (OTP proof) consumed for it" "SELECT (count(*) FILTER (WHERE p.consumed_at IS NOT NULL)=1)::text||'|consumed='||count(*) FILTER (WHERE p.consumed_at IS NOT NULL)
  FROM warehouse_identity.recovery_proofs_v1 p WHERE p.reset_request_id=(SELECT password_reset_request_id FROM warehouse_identity.password_reset_requests WHERE user_id=$U ORDER BY created_at DESC LIMIT 1);"
chk "code email delivered and its encrypted payload scrubbed" "SELECT (count(*)>=1 AND bool_and(o.status='ACCEPTED' AND o.encrypted_payload IS NULL))::text||'|emails='||count(*)||' statuses='||string_agg(DISTINCT o.status,',')
  FROM warehouse_identity.recovery_secret_outbox_v18 o JOIN warehouse_identity.recovery_contact_challenges_v1 c ON c.challenge_id=o.challenge_id
  WHERE c.reset_request_id=(SELECT password_reset_request_id FROM warehouse_identity.password_reset_requests WHERE user_id=$U ORDER BY created_at DESC LIMIT 1);"
# password_credentials has no updated_at on production: use the newest *_at timestamp in the active credential row
chk "password changed after the reset was requested" "SELECT (x.t > r.created_at)::text||'|credential last set '||to_char(x.t,'YYYY-MM-DD HH24:MI')||' UTC'
  FROM (SELECT max(j.v::timestamptz) t FROM warehouse_identity.password_credentials pc, jsonb_each_text(to_jsonb(pc)) j(k,v)
        WHERE pc.user_id=$U AND pc.revoked_at IS NULL AND j.k ~ '_at$' AND j.k <> 'revoked_at' AND j.v IS NOT NULL) x,
       (SELECT created_at FROM warehouse_identity.password_reset_requests WHERE user_id=$U ORDER BY created_at DESC LIMIT 1) r;"
chk "sessions invalidated (session epoch advanced)" "SELECT (epoch>=1)::text||'|epoch='||epoch FROM warehouse_identity.iam_session_epoch_status_v15($U);"
chk "no secret left anywhere in the outbox (all delivered rows scrubbed)" "SELECT (count(*)=0)::text||'|unscrubbed delivered rows='||count(*)
  FROM warehouse_identity.recovery_secret_outbox_v18 WHERE status='ACCEPTED' AND encrypted_payload IS NOT NULL;"
chk "nothing stuck in delivery" "SELECT (count(*)=0)::text||'|pending/quarantined='||count(*) FROM warehouse_identity.recovery_secret_outbox_v18
  WHERE status NOT IN ('ACCEPTED') AND created_at < now()-interval '15 minutes';"

echo "== services"
s() { local want=$1 got; got=$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "$2"); if [[ " $want " == *" $got "* ]]; then PASSN=$((PASSN+1)); echo "PASS $3 | $got"; else FAILN=$((FAILN+1)); echo "FAIL $3 | $got (want $want)"; fi; }
s 200 http://127.0.0.1:8095/api/v1/auth/ready "login API ready"
s 401 http://127.0.0.1:8095/api/v1/auth/recovery-email "recovery email API on (no session -> 401)"
s 200 https://login.tcdsolutionsgroup.com/approve/recovery/ "public approval page"
s 200 https://warehouse-app.tcdsolutionsgroup.com/auth/recovery "public forgot-password page"
L=$(pm2 logs login-v2-api --lines 80 --nostream --raw 2>/dev/null)
echo "$L" | grep -q 'packship routes mounted' && { PASSN=$((PASSN+1)); echo "PASS Pack/Ship routes still mounted"; } || { FAILN=$((FAILN+1)); echo "FAIL Pack/Ship routes not seen in the recent log"; }
echo "   recent errors in the login API log: $(echo "$L" | grep -ciE '"level":"error"|fatal|unhandled' || true)"
echo; echo "VERIFY RESULT: $PASSN passed, $FAILN failed (read-only, nothing changed)"
