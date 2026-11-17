#!/usr/bin/env bash
# READ ONLY. Inspects how the arb API (src/server.ts) mounts routes and authenticates Warehouse PWA requests, so the
# Pack/Ship routes and the capture-snapshot endpoint can be mounted on the real session/CSRF/device middleware with a
# dedicated database login. Changes nothing: no writes, no restarts, no SET ROLE. Prints .env key NAMES only, no values.
# Usage: bash /tmp/domain6_scanner/packship_routes_v16/inspect_mount.sh 2>&1 | tee ~/inspect_mount.txt
set -uo pipefail
REPO=/srv/arb-system/api
cd "$REPO" || { echo "no $REPO"; exit 1; }
h(){ echo; echo "################ $*"; }

h "1. repo"
echo "branch=$(git rev-parse --abbrev-ref HEAD) head=$(git rev-parse --short HEAD) origin/develop=$(git rev-parse --short origin/develop 2>/dev/null)"
echo "modified tracked files: $(git status --porcelain --untracked-files=no | wc -l)"
node -e 'const p=require("./package.json");console.log("name="+p.name+" type="+(p.type||"commonjs")+" main="+p.main);console.log("scripts: "+Object.keys(p.scripts||{}).join(", "));const d={...p.dependencies};for(const k of ["express","pg","redis","cookie-parser","helmet","cors","zod"])console.log("  "+k+"="+(d[k]||"-"))'
echo "src/server.ts: $(wc -l < src/server.ts) lines; dist/server.js: $( [ -f dist/server.js ] && stat -c %y dist/server.js | cut -c1-19 || echo missing)"

h "2. src/server.ts: imports, app.use, mountApiRoutes"
grep -nE "^import|require\(|app\.use\(|mountApiRoutes|listen\(|new Pool|createPool|Router\(" src/server.ts | head -80
n=$(grep -nE "function mountApiRoutes|mountApiRoutes *=|const mountApiRoutes" src/server.ts | head -1 | cut -d: -f1)
if [ -n "$n" ]; then echo "--- mountApiRoutes body (from line $n)"; sed -n "${n},$((n+90))p" src/server.ts; fi

h "3. auth / session / CSRF / device middleware in src"
grep -rlE "auth_session|authSession|attachSession|requireAuth|requireSession|csrf|x-csrf|deviceAssertion|device_assertion|requirePermission|warehouse_identity" src --include='*.ts' 2>/dev/null | grep -v node_modules | sort | head -60
echo "--- exports of those files"
for f in $(grep -rlE "attachSession|requireAuth|requireSession|csrf|deviceAssertion|requirePermission" src --include='*.ts' 2>/dev/null | grep -v node_modules | head -25); do
  echo "## $f"; grep -nE "^export (async )?(function|const|class|type|interface)|^export \{|module\.exports" "$f" | head -15
done
echo "--- src/express (6.1B layout) if present"; ls -la src/express 2>/dev/null | head -40

h "4. PWA identity routes: source and compiled"
grep -rnE "['\"\`]/api/v1/(auth|identity|session|warehouse-control|packing|shipments|warehouse)" src --include='*.ts' 2>/dev/null | grep -v node_modules | awk -F: '{print $1": "$3}' | sed -E 's/ +/ /g' | sort | uniq | head -50
echo "--- compiled dist counts"; for p in /api/v1/auth /api/v1/packing /api/v1/warehouse-control; do echo "  $p: $(grep -rl "$p" dist 2>/dev/null | wc -l) file(s)"; done

h "5. how a request is authenticated (cookie names, header names, CSRF header)"
grep -rnoE "cookies?\[['\"][A-Za-z0-9_.-]+['\"]\]|cookies\.[A-Za-z_][A-Za-z0-9_]*|['\"]x-[a-z0-9-]+['\"]|__Host-[A-Za-z0-9_-]+|SameSite[^,;)]*" src --include='*.ts' 2>/dev/null | grep -v node_modules | awk -F: '{print $NF}' | sort | uniq -c | sort -rn | head -40

h "6. running processes (PM2: name, status, script, cwd; no env)"
pm2 jlist 2>/dev/null | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{for(const p of JSON.parse(s)){const e=p.pm2_env||{};console.log([p.name,e.status,e.pm_exec_path,e.pm_cwd,"port="+((e.env||{}).PORT||"-")].join(" | "))}}catch(e){console.log("pm2 jlist unavailable")}})'
echo "--- listening TCP"; ss -ltn 2>/dev/null | awk 'NR>1{print $4}' | sort -u | tr '\n' ' '; echo

h "7. nginx: warehouse-app vhost routing"
for f in /etc/nginx/sites-enabled/*; do grep -q "warehouse-app" "$f" 2>/dev/null && { echo "## $f"; grep -nE "server_name|listen|location|proxy_pass|proxy_set_header +(Host|X-Forwarded|Cookie)|add_header +(Content-Security|Strict)" "$f"; }; done

h "8. live probes (GET, no credentials)"
for u in https://warehouse-app.tcdsolutionsgroup.com/api/v1/auth/session https://warehouse-app.tcdsolutionsgroup.com/api/v1/health \
         https://warehouse-app.tcdsolutionsgroup.com/api/v1/packing/tasks/00000000-0000-4000-8000-000000000000 \
         https://warehouse-app.tcdsolutionsgroup.com/api/v1/warehouse-control/scanner/capture-snapshot; do
  echo "  $(curl -s -o /dev/null -m 10 -w '%{http_code} %{content_type}' "$u") $u"
done

h "9. .env key names only (identity / session / db / packship)"
grep -oE '^[A-Z][A-Z0-9_]*=' .env | tr -d '=' | grep -E "PG|DATABASE|IAM|IDENT|SESSION|CSRF|COOKIE|PASSKEY|WEBAUTHN|DEVICE|PACKSHIP|REDIS|ORIGIN|PEPPER" | sort | tr '\n' ' '; echo

h "10. database (read only)"
eval "$(grep -E '^(PGHOST|PGPORT|PGDATABASE|PGUSER|PGPASSWORD|PGSSLMODE)=' .env | sed -E "s/^([A-Z_]+)=(.*)$/export \1='\2'/")"
case "${PGHOST:-}${PGUSER:-}" in *vfxlrkqgakqqbnbbgecp*) echo "target: production";; *) echo "target: NOT production (${PGHOST:-?})";; esac
PAGER=cat psql -X -q -At -v ON_ERROR_STOP=1 <<'SQL'
BEGIN READ ONLY;
SELECT 'api pool login: ' || current_user || ' super=' || rolsuper || ' bypassrls=' || rolbypassrls FROM pg_roles WHERE rolname = current_user;
SELECT 'role ' || r.rolname || ' login=' || r.rolcanlogin || ' members=' ||
       coalesce((SELECT string_agg(m.rolname || CASE WHEN m.rolcanlogin THEN '(login)' ELSE '' END, ',')
                 FROM pg_auth_members am JOIN pg_roles m ON m.oid = am.member WHERE am.roleid = r.oid), '-')
  FROM pg_roles r WHERE r.rolname LIKE 'tcds\_packship%' OR r.rolname LIKE 'tcds\_identity%' OR r.rolname LIKE 'tcds\_warehouse%' ORDER BY 1;
SELECT 'login roles (tcds_*/eoc_*): ' || coalesce(string_agg(rolname, ', ' ORDER BY rolname), '-')
  FROM pg_roles WHERE rolcanlogin AND (rolname LIKE 'tcds\_%' OR rolname LIKE 'eoc\_%');
SELECT 'identity fn: ' || p.oid::regprocedure::text || CASE WHEN p.prosecdef THEN ' [definer]' ELSE '' END
  FROM pg_proc p WHERE p.pronamespace = 'warehouse_identity'::regnamespace
   AND p.proname ~ '(session|csrf|device|resolve|authenticat|principal|permission)' ORDER BY 1;
SELECT 'auth_sessions columns: ' || string_agg(column_name, ',' ORDER BY ordinal_position)
  FROM information_schema.columns WHERE table_schema = 'warehouse_identity' AND table_name = 'auth_sessions';
SELECT 'auth_sessions rows: ' || count(*) || ', live: ' || count(*) FILTER (WHERE revoked_at IS NULL AND idle_expires_at > now())
  FROM warehouse_identity.auth_sessions;
SELECT 'roles granting PACKSHIP_PACK: ' || coalesce(string_agg(role_code, ','), 'none') FROM warehouse_identity.roles
 WHERE 'PACKSHIP_PACK' = ANY (permissions);
SELECT 'scanner snapshot objects: ' || coalesce(string_agg(n.nspname || '.' || c.relname, ', '), 'none')
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE n.nspname = 'warehouse_control' AND c.relname ~ '(scanner_profile|capture|symbolog|device_binding)' AND c.relkind IN ('r','v');
ROLLBACK;
SQL
echo; echo "inspection finished (read only)"
