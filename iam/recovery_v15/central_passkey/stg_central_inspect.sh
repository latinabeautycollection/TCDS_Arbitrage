#!/usr/bin/env bash
# READ ONLY. Inventory for the central laptop passkey ceremony (EOC_OIDC_LOGIN) on STAGING (kqcdqtazcqaawdkmcfed).
# Prints: staging PM2 apps (name/status/cwd), what is under ~/stg_login, staging config key SHAPE (no secret values),
# the WebAuthn tables/columns/constraints/functions/roles the design depends on, row counts, 623/624 state, and whether
# the four people named by the dev team exist as IAM users (user id, username, status, passkey counts; no email, no
# phone). Changes nothing. Usage: bash /tmp/recov15/central_passkey/stg_central_inspect.sh   (run from /srv/arb-system/api)
set -uo pipefail
cd /srv/arb-system/api || exit 1
eval "$(grep -E '^(PGHOST|PGPORT|PGDATABASE|PGUSER|PGPASSWORD|PGSSLMODE)=' .env | sed -E "s/^([A-Z_]+)=(.*)$/export \1='\2'/")"
export PGHOST=db.kqcdqtazcqaawdkmcfed.supabase.co PGPORT=5432 PGDATABASE=postgres PGUSER=postgres
S=$HOME/stg_login
grep -q kqcdqtazcqaawdkmcfed "$S/config.json" || { echo "$S/config.json is not the staging config - stopping"; exit 1; }
export PAGER=cat

echo "===== PM2 apps (name status cwd)"
pm2 jlist 2>/dev/null | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{for(const a of JSON.parse(s))console.log(" ",a.name,a.pm2_env?.status,a.pm2_env?.pm_cwd)}catch{console.log("  (pm2 jlist unreadable)")}})'

echo "===== ~/stg_login (top level)"
ls -1 "$S" | sed 's/^/  /'
for b in 6.1B 6.1C; do
  [ -f "$S/$b/package.json" ] && node -e "const p=require('$S/$b/package.json');console.log('  $b',p.name,p.version,'simplewebauthn='+(p.dependencies?.['@simplewebauthn/server']||'-'))" || echo "  $b: not present"
done

echo "===== staging config.json (key shape only; secrets shown as length)"
node -e '
const safe=/^(NODE_ENV|HOST|PORT|PUBLIC_APP_ORIGIN|PASSKEY_RP_ID|RP_ID|RP_ORIGIN|EXPECTED_ORIGIN|RP_NAME|.*_URL|.*_(MINUTES|SECONDS|TTL))$/;
function show(k,v){if(typeof v!=="string")return typeof v==="object"?"":"="+JSON.stringify(v);
 if(/URL$/.test(k)||/^(postgres|redis)/.test(v)){const m=v.match(/^(\w+):\/\/(?:([^:@\/]+)(?::[^@]*)?@)?([^\/?]+)/);return m?` (${m[1]} user=${m[2]||"-"} host=${m[3]})`:" (url)"}
 if(safe.test(k))return "="+v;return ` (string, ${v.length} chars)`}
function walk(o,p){for(const [k,v] of Object.entries(o)){const q=p?p+"."+k:k;if(v&&typeof v==="object"&&!Array.isArray(v))walk(v,q);else console.log("  "+q+show(k,v))}}
walk(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")),"")' "$S/config.json"

echo "===== database (staging)"
psql -X -At -v ON_ERROR_STOP=0 <<'SQL'
BEGIN READ ONLY;
SELECT '-- columns: ' || c.relname || '.' || a.attname || ' ' || format_type(a.atttypid, a.atttypmod) || CASE WHEN a.attnotnull THEN ' NOT NULL' ELSE '' END
  FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE n.nspname = 'warehouse_identity' AND c.relname IN ('passkeys', 'auth_challenges', 'webauthn_verification_evidence')
   AND a.attnum > 0 AND NOT a.attisdropped ORDER BY c.relname, a.attnum;
SELECT '-- check: ' || conrelid::regclass || ' ' || conname || ' ' || pg_get_constraintdef(oid)
  FROM pg_constraint WHERE conrelid IN ('warehouse_identity.passkeys'::regclass, 'warehouse_identity.auth_challenges'::regclass,
    'warehouse_identity.webauthn_verification_evidence'::regclass) AND contype IN ('c', 'u', 'f') ORDER BY 1;
SELECT '-- fn: ' || p.oid::regprocedure || ' owner=' || pg_get_userbyid(p.proowner) || ' definer=' || p.prosecdef
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'warehouse_identity' AND p.proname ~ '(webauthn|passkey|auth_challenge|eoc_)' ORDER BY 1;
SELECT '-- role: ' || rolname || ' login=' || rolcanlogin || ' bypassrls=' || rolbypassrls FROM pg_roles
 WHERE rolname ~ '^(tcds_identity_|tcds_login|tcds_eoc)' ORDER BY 1;
SELECT '-- rows: passkeys=' || (SELECT count(*) FROM warehouse_identity.passkeys)
    || ' (no device ' || (SELECT count(*) FROM warehouse_identity.passkeys WHERE enrolled_device_id IS NULL) || ')'
    || ' auth_challenges=' || (SELECT count(*) FROM warehouse_identity.auth_challenges)
    || ' evidence=' || (SELECT count(*) FROM warehouse_identity.webauthn_verification_evidence)
    || ' users=' || (SELECT count(*) FROM warehouse_identity.users);
SELECT '-- 623 bindings=' || coalesce((SELECT count(*)::text FROM warehouse_identity.eoc_federated_subject_bindings_v12), 'table missing');
SELECT '-- 624 installed=' || (to_regclass('warehouse_identity.eoc_binding_approvals_v13') IS NOT NULL)
    || ' 625 installed=' || (to_regclass('warehouse_identity.eoc_bridge_audit_archive_v13') IS NOT NULL);
SELECT '-- enterprise_org: ' || coalesce((SELECT string_agg(table_name, ',' ORDER BY table_name) FROM information_schema.tables WHERE table_schema = 'enterprise_org'), 'schema missing');
-- The four people named by the dev team (2026-11-18). Display-name match only; prints no email/phone.
SELECT '-- person: ' || x.name || ' -> ' || coalesce((
         SELECT string_agg(u.user_id || ' username=' || u.username || ' status=' || u.status
           || ' passkeys=' || (SELECT count(*) FROM warehouse_identity.passkeys p WHERE p.user_id = u.user_id AND p.revoked_at IS NULL), '; ')
           FROM warehouse_identity.users u WHERE u.display_name ILIKE '%' || x.last || '%' AND u.display_name ILIKE '%' || x.first || '%'), 'NO IAM USER')
  FROM (VALUES ('Anthony Malone', 'Anthony', 'Malone'), ('Korina Korva', 'Korina', 'Korva'),
               ('Yahaira Rosario Malone', 'Yahaira', 'Malone'), ('Robert Mahoney', 'Robert', 'Mahoney')) x(name, first, last);
ROLLBACK;
SQL
echo "INSPECT DONE (read only)"
