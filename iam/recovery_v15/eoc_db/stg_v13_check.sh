#!/usr/bin/env bash
# READ ONLY, STAGING ONLY (kqcdqtazcqaawdkmcfed). Domain 6.4 V1.3 checks:
#   P  624/625 prerequisites on the central IAM database
#   S  database separation: what V1.3's iam-db-preflight.sh / retail-stage-install.sh would conclude about this database
# Prints names, booleans and counts only. No secrets.
# Usage: bash /tmp/recov15/eoc_db/stg_v13_check.sh
set -uo pipefail
cd /srv/arb-system/api
eval "$(grep -E '^(PGHOST|PGPORT|PGDATABASE|PGUSER|PGPASSWORD|PGSSLMODE)=' .env | sed -E "s/^([A-Z_]+)=(.*)$/export \1='\2'/")"
export PGHOST=db.kqcdqtazcqaawdkmcfed.supabase.co PGPORT=5432 PGDATABASE=postgres PGUSER=postgres
[ "$PGHOST" = "db.kqcdqtazcqaawdkmcfed.supabase.co" ] || { echo "not the staging host - stopping"; exit 1; }
export PAGER=cat

# (R. runtime-role readiness: certified by eocdb_retail.sh test L1 and Codex's acquisition-side check; the EOC
#  credential now exists only on the acquisition server.)
echo; echo "===== P/S. catalog (read only)"
psql -X -At -v ON_ERROR_STOP=0 <<'SQL'
BEGIN READ ONLY;
SELECT 'S1 623 resolve_federation present: ' || (to_regprocedure('warehouse_identity.eoc_resolve_federation_v623(text,text,uuid)') IS NOT NULL);
SELECT 'S2 eoc_iam.sessions in THIS database: ' || (to_regclass('eoc_iam.sessions') IS NOT NULL)
       || '  (V1.3 iam-db-preflight.sh says WRONG_IAM_BASELINE if true)';
SELECT 'S3 warehouse_identity.password_credentials in THIS database: ' || (to_regclass('warehouse_identity.password_credentials') IS NOT NULL)
       || '  (V1.3 retail-stage-install.sh says WRONG_DATABASE if true)';
SELECT 'S4 server version: ' || current_setting('server_version') || '  postgres superuser: ' || (SELECT rolsuper FROM pg_roles WHERE rolname = 'postgres');
SELECT 'P1 webauthn_verification_evidence exists: ' || (to_regclass('warehouse_identity.webauthn_verification_evidence') IS NOT NULL);
SELECT 'P2 columns 624 needs: ' || coalesce(string_agg(a.attname || ':' || format_type(a.atttypid, a.atttypmod), ', ' ORDER BY a.attname), '<none>')
  FROM pg_attribute a WHERE a.attrelid = to_regclass('warehouse_identity.webauthn_verification_evidence')
   AND a.attname IN ('webauthn_verification_evidence_id', 'user_id', 'user_verified', 'verified_at') AND NOT a.attisdropped;
SELECT 'P3 webauthn evidence rows: ' || (xpath('/row/c/text()', query_to_xml('SELECT count(*) AS c FROM warehouse_identity.webauthn_verification_evidence', false, true, '')))[1]::text
  WHERE to_regclass('warehouse_identity.webauthn_verification_evidence') IS NOT NULL;
SELECT 'P4 tcds_identity_function_owner has CREATE on warehouse_identity: ' || has_schema_privilege('tcds_identity_function_owner', 'warehouse_identity', 'CREATE')
       || '  (false = 624/625 ALTER FUNCTION ... OWNER fails)';
SELECT 'P5 postgres can SET ROLE tcds_identity_function_owner: ' || pg_has_role('postgres', 'tcds_identity_function_owner', 'SET');
SELECT 'P6 existing V1.3 roles: ' || coalesce(string_agg(rolname, ','), 'none') FROM pg_roles
 WHERE rolname IN ('tcds_eoc_attestation_writer', 'tcds_eoc_binding_admin', 'tcds_eoc_audit_retention_worker', 'tcds_eoc_legal_hold_admin');
SELECT 'P7 roles carrying enterprise:identity:eoc_binding:approve: ' || count(*) FROM warehouse_identity.roles
 WHERE 'enterprise:identity:eoc_binding:approve' = ANY (permissions);
SELECT 'P8 auth_sessions by assurance (active): ' || coalesce(string_agg(assurance_level || '=' || n, ', '), 'none')
  FROM (SELECT assurance_level, count(*) n FROM warehouse_identity.auth_sessions
         WHERE revoked_at IS NULL AND absolute_expires_at > now() GROUP BY 1) x;
SELECT 'P9 bridge audit rows: ' || count(*) || ', oldest ' || coalesce(min(occurred_at)::date::text, '-') FROM warehouse_identity.eoc_bridge_audit_v12;
SELECT 'P10 verified federation bindings: ' || count(*) FILTER (WHERE binding_status = 'VERIFIED') || ' of ' || count(*)
  FROM warehouse_identity.eoc_federated_subject_bindings_v12;
ROLLBACK;
SQL
echo; echo "DONE (read only)"
