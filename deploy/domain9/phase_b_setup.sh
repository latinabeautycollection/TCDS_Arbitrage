#!/usr/bin/env bash
# Domain 9 Phase B: create the 11 dedicated LOGIN roles (non-super, non-bypassrls, distinct)
# and write bootstrap/domain9-production.env with role names + per-principal connection URLs.
# Passwords are generated here and never leave the box; the env file is chmod 600.
set -Eeuo pipefail
ROOT=/tmp/domain9_v3/domain9_enterprise_deployment_bootstrap_v3
ADMIN_URL="$(grep '^DATABASE_URL=' /srv/arb-system/api/.env | head -1 | cut -d= -f2- | sed 's/sslmode=no-verify/sslmode=require/')"
HOST=db.vfxlrkqgakqqbnbbgecp.supabase.co; PORT=5432; DB=postgres
ENVFILE="$ROOT/bootstrap/domain9-production.env"

order=(ARB WAREHOUSE DOMAIN8 EOC AI_WORKER AI_REVIEWER AI_ADMIN AI_AUDITOR TECHNICAL_APPROVER SECURITY_APPROVER EXECUTIVE_APPROVER)
declare -A ROLE=(
 [ARB]=d9_arb [WAREHOUSE]=d9_warehouse [DOMAIN8]=d9_domain8 [EOC]=d9_eoc
 [AI_WORKER]=d9_worker [AI_REVIEWER]=d9_reviewer [AI_ADMIN]=d9_admin [AI_AUDITOR]=d9_auditor
 [TECHNICAL_APPROVER]=d9_appr_technical [SECURITY_APPROVER]=d9_appr_security [EXECUTIVE_APPROVER]=d9_appr_executive
)
umask 077
: > "$ENVFILE"
echo "# Domain 9 Phase B dedicated logins (generated $(date -u +%FT%TZ)); hex passwords" >> "$ENVFILE"
for k in "${order[@]}"; do
  r="${ROLE[$k]}"; pw="$(openssl rand -hex 24)"
  psql "$ADMIN_URL" -v ON_ERROR_STOP=1 -c "CREATE ROLE $r LOGIN NOSUPERUSER NOBYPASSRLS PASSWORD '$pw'" 2>/dev/null \
    || psql "$ADMIN_URL" -v ON_ERROR_STOP=1 -c "ALTER ROLE $r LOGIN NOSUPERUSER NOBYPASSRLS PASSWORD '$pw'"
  echo "DOMAIN9_${k}_LOGIN=$r" >> "$ENVFILE"
  echo "DOMAIN9_${k}_DATABASE_URL=postgresql://$r:$pw@$HOST:$PORT/$DB?sslmode=require" >> "$ENVFILE"
done
echo "DOMAIN9_SERVICE_PRINCIPALS_ACTIVE=false" >> "$ENVFILE"
chmod 600 "$ENVFILE"
echo "PHASE_B_ROLES_CREATED: 11 roles + $ENVFILE (mode 600)"
grep -cE '_LOGIN=|_DATABASE_URL=' "$ENVFILE" | sed 's/^/env lines (expect 22): /'
