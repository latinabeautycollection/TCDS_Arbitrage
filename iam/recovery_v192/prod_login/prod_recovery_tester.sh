#!/usr/bin/env bash
# PRODUCTION: a dedicated test employee for the first end-to-end password-recovery test through the real app.
# Based on tcds_loginv2_r11_fixes/runtime/add_tester.sh + remove_tester.sh (same account shape: WAREHOUSE_OPERATOR at the
# Login V2 test facility LV2TEST only, never admin), plus a computer option and a readiness check.
#   ready                                  read-only: test facility, approver (tictac) can approve resets there and has a
#                                          warehouse passkey for the step-up, recovery on/off, test account state
#   add      CONFIRM=ADD-RECOVERY-TESTER [UN=recovery.test] [DEVICE=desktop|ios|android]
#            asks for the device's public key (from https://warehouse-app.tcdsolutionsgroup.com/device-setup on the TEST
#            device), creates device + account + password (printed ONCE, on this screen only - never paste it into chat)
#   remove   CONFIRM=REMOVE-RECOVERY-TESTER [UN=recovery.test]   disable (nothing deleted): sessions ended, password,
#            passkeys and device credential revoked, device retired
# Use a device/browser that does NOT already hold tictac's device key (the app keeps one device key per browser).
set -euo pipefail
P=/srv/arb-system/loginv2_runtime; APPROVER=${APPROVER:-tictac}; UN=${UN:-recovery.test}; DEVICE=${DEVICE:-desktop}
cd /srv/arb-system/api
eval "$(grep -E '^(PGHOST|PGPORT|PGDATABASE|PGUSER|PGPASSWORD|PGSSLMODE)=' .env | sed -E "s/^([A-Z_]+)=(.*)$/export \1='\2'/")"
case "$PGHOST $PGUSER" in *vfxlrkqgakqqbnbbgecp*) ;; *) echo ".env database is not production - stopping"; exit 1;; esac
export PGSSLMODE=${PGSSLMODE:-require}
[[ "$UN" =~ ^[a-z0-9._-]{3,64}$ && "$APPROVER" =~ ^[a-z0-9._-]{3,64}$ ]] || { echo "bad UN / APPROVER"; exit 1; }
q() { PAGER=cat psql -X -q -At -F ' | ' -v ON_ERROR_STOP=1 -v un="$UN" -v appr="$APPROVER" "$@"; }
need() { [ "${CONFIRM:-}" = "$1" ] || { echo "set CONFIRM=$1"; exit 1; }; }

case "${1:-}" in
ready) q <<'SQL'
\pset footer off
WITH f AS (SELECT facility_id FROM warehouse.facilities WHERE facility_code='LV2TEST')
SELECT 'test facility LV2TEST: '||coalesce((SELECT facility_id::text FROM f),'MISSING')||' | station LV2STATION: '||
  coalesce((SELECT station_id::text FROM warehouse.stations s WHERE s.station_code='LV2STATION' AND s.facility_id=(SELECT facility_id FROM f)),'MISSING');
SELECT 'approver '||u.username||': '||u.status
  ||' | can approve resets at LV2TEST: '||EXISTS(SELECT 1 FROM warehouse_identity.user_role_assignments ra JOIN warehouse_identity.roles r USING (role_id)
       WHERE ra.user_id=u.user_id AND ra.revoked_at IS NULL AND (ra.valid_until IS NULL OR ra.valid_until>now())
         AND r.permissions::text LIKE '%warehouse:identity:password:reset_approve%'
         AND (ra.facility_id IS NULL OR ra.facility_id=(SELECT facility_id FROM warehouse.facilities WHERE facility_code='LV2TEST')))
  ||' | warehouse passkeys (for the approval step-up): '||(SELECT count(*) FROM warehouse_identity.passkeys p WHERE p.user_id=u.user_id
       AND p.revoked_at IS NULL AND p.security_state='ACTIVE')
 FROM warehouse_identity.users u WHERE u.normalized_username=lower(:'appr');
SELECT 'test account '||:'un'||': '||coalesce((SELECT status FROM warehouse_identity.users WHERE normalized_username=lower(:'un')),'not created yet');
SELECT 'recovery-email approvers: '||coalesce(string_agg(u.username,', '),'nobody') FROM warehouse_identity.user_role_assignments ra
 JOIN warehouse_identity.users u USING (user_id) WHERE ra.revoked_at IS NULL AND (ra.valid_until IS NULL OR ra.valid_until>now())
  AND ra.role_id=(SELECT role_id FROM warehouse_identity.roles WHERE role_code='IAM_RECOVERY_DESTINATION_APPROVER');
SQL
  echo "login API recovery: $( [ "$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:8095/api/v1/auth/recovery-email)" = 401 ] && echo enabled || echo 'off (404)')" ;;

add)
  need ADD-RECOVERY-TESTER
  case "$DEVICE" in ios) DT=PWA_IOS;; android) DT=PWA_ANDROID;; desktop) DT=PWA_DESKTOP;; *) echo "DEVICE=desktop|ios|android"; exit 1;; esac
  FAC=$(q <<< "select facility_id from warehouse.facilities where facility_code='LV2TEST';")
  ST=$(q <<< "select station_id from warehouse.stations where station_code='LV2STATION' and facility_id='${FAC:-00000000-0000-0000-0000-000000000000}';")
  [ -n "$FAC" ] && [ -n "$ST" ] || { echo "LV2TEST / LV2STATION not found"; exit 1; }
  [ "$(q <<< "select count(*) from warehouse_identity.users where normalized_username=lower(:'un');")" = 0 ] || { echo "user '$UN' already exists"; exit 1; }
  echo "On the TEST device open https://warehouse-app.tcdsolutionsgroup.com/device-setup, select Copy public key, and paste it here, then Enter:"
  PUB=""; while [ ${#PUB} -lt 124 ] && IFS= read -r LINE; do PUB="$PUB$(printf '%s' "$LINE" | tr -d '[:space:]')"; done
  python3 -I - "$PUB" <<'PY' || exit 1
import base64, binascii, sys
k = sys.argv[1]
if any(not (c.isascii() and (c.isalnum() or c in '+/=')) for c in k): sys.exit("the key has characters a real key never has - copy it as text (Copy public key)")
if not k.startswith('MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAE'): sys.exit("this does not look like a device key (should start MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAE)")
try: der = base64.b64decode(k, validate=True)
except binascii.Error: sys.exit('the key is incomplete or damaged')
if len(der) != 91: sys.exit(f'the key is {len(der)} bytes, a device key is 91')
PY
  PW=$(python3 -I -c "import secrets,string;a=string.ascii_letters+string.digits;print(''.join(secrets.choice(a) for _ in range(20)))")
  POLICY=$(q -F, <<< "select memory_cost,time_cost,parallelism,hash_length from warehouse_identity.runtime_active_password_policy_v1();")
  HASH=$(LOGINV2_PW="$PW" LOGINV2_POLICY="$POLICY" node -e "
    const a=require('$P/build/6.1B/node_modules/argon2'), c=require('$P/config.json');
    const [m,t,p,h]=process.env.LOGINV2_POLICY.split(',').map(Number);
    a.hash(Buffer.from(process.env.LOGINV2_PW+'\u0000'+c.api.PASSWORD_PEPPER_CURRENT,'utf8'),
      {type:a.argon2id,memoryCost:m,timeCost:t,parallelism:p,hashLength:h}).then(x=>console.log(x))")
  OUT=$(PAGER=cat psql -X -At -F' ' -v ON_ERROR_STOP=1 -v un="$UN" -v dt="$DT" -v pub="$PUB" -v fac="$FAC" -v st="$ST" -v hash="$HASH" <<'SQL'
BEGIN;
WITH d AS (
  INSERT INTO warehouse.devices(facility_id,station_id,device_type,status,device_name,capabilities,hardware_fingerprint,serial_number)
  VALUES (:'fac',:'st',:'dt'::warehouse.device_type,'ACTIVE','Tester device: '||:'un','{"trusted":true}',
          'loginv2-'||gen_random_uuid(),'loginv2-'||gen_random_uuid())
  RETURNING device_id),
c AS (
  INSERT INTO warehouse_identity.device_credentials(device_id,credential_type,public_key,algorithm,status)
  SELECT device_id,'DEVICE_SIGNING_KEY',decode(:'pub','base64'),'ES256','ACTIVE' FROM d RETURNING device_id, device_credential_id),
u AS (INSERT INTO warehouse_identity.users(username,display_name,status) VALUES (:'un','Recovery Test','ACTIVE') RETURNING user_id),
e AS (INSERT INTO warehouse_identity.employees(user_id,employee_number,facility_id,default_station_id,employment_status)
  SELECT user_id,'TEST-RECOVERY',:'fac',:'st','ACTIVE' FROM u RETURNING employee_id),
p AS (INSERT INTO warehouse_identity.password_credentials(user_id,password_hash,hashing_algorithm,parameters,must_change)
  SELECT user_id,:'hash','ARGON2ID','{}',false FROM u RETURNING 1),
r AS (INSERT INTO warehouse_identity.user_role_assignments(user_id,role_id,facility_id,station_id)
  SELECT u.user_id, ro.role_id, :'fac', :'st' FROM u, warehouse_identity.roles ro WHERE ro.role_code='WAREHOUSE_OPERATOR' RETURNING 1)
SELECT c.device_id, c.device_credential_id, (SELECT count(*) FROM e)+(SELECT count(*) FROM p)+(SELECT count(*) FROM r) FROM c;
COMMIT;
SQL
)
  read -r DEV CRED N <<<"$(echo "$OUT" | grep -E '^[0-9a-f-]{36} ' | head -1)"
  [ "${N:-0}" = 3 ] || { echo "unexpected result: $OUT"; exit 1; }
  echo; echo "== Test employee '$UN' created (WAREHOUSE_OPERATOR at LV2TEST only). Shown ONCE - keep it on this screen, never paste it into chat:"
  echo "   Username:       $UN   (employee number TEST-RECOVERY)"
  echo "   Password:       $PW"
  echo "   On the test device, Set up this device, step 2:"
  echo "   Device id:      $DEV"; echo "   Credential id:  $CRED"; echo "   Facility id:    $FAC"; echo "   Station id:     $ST"
  unset PW HASH ;;

remove)
  need REMOVE-RECOVERY-TESTER
  q <<'SQL'
BEGIN;
SELECT set_config('tcds.un', :'un', true);
DO $$
DECLARE u uuid; s uuid;
BEGIN
  SELECT user_id INTO u FROM warehouse_identity.users WHERE normalized_username = current_setting('tcds.un');
  IF u IS NULL THEN RAISE EXCEPTION 'no such user'; END IF;
  IF EXISTS (SELECT 1 FROM warehouse_identity.user_role_assignments a JOIN warehouse_identity.roles r USING (role_id)
             WHERE a.user_id = u AND r.role_code <> 'WAREHOUSE_OPERATOR') THEN RAISE EXCEPTION 'refusing: user has roles other than WAREHOUSE_OPERATOR'; END IF;
  FOR s IN SELECT auth_session_id FROM warehouse_identity.auth_sessions WHERE user_id = u AND revoked_at IS NULL LOOP
    CALL warehouse_identity.revoke_session(s, 'TESTER_REMOVED', NULL);
  END LOOP;
  UPDATE warehouse_identity.users SET status = 'DISABLED' WHERE user_id = u;
  UPDATE warehouse_identity.password_credentials SET revoked_at = clock_timestamp() WHERE user_id = u AND revoked_at IS NULL;
  UPDATE warehouse_identity.passkeys SET revoked_at = clock_timestamp() WHERE user_id = u AND revoked_at IS NULL;
  UPDATE warehouse_identity.device_credentials dc SET status = 'REVOKED', revoked_at = clock_timestamp()
    FROM warehouse.devices d WHERE d.device_id = dc.device_id AND d.device_name = 'Tester device: '||current_setting('tcds.un') AND dc.status <> 'REVOKED';
  UPDATE warehouse.devices SET status = 'RETIRED', retired_at = clock_timestamp()
    WHERE device_name = 'Tester device: '||current_setting('tcds.un') AND status <> 'RETIRED';
END $$;
COMMIT;
SQL
  echo "test employee '$UN' disabled: sessions ended, password/passkeys/device credential revoked, device retired" ;;
*) sed -n '2,13p' "$0"; exit 2 ;;
esac
