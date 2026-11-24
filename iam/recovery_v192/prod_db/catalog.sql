-- Catalog fingerprint for the recovery rollout: warehouse* + enterprise_org schemas, tcds_* roles and their memberships.
-- One line per object: kind|name|hash. Definitions, owners and grants are hashed, never printed.
-- Line breaks, tabs and backslashes inside names are flattened to spaces so every entry is exactly one line.
SELECT coalesce(regexp_replace(x, '[\n\r\t\\]', ' ', 'g'), 'NULL-LINE|'||md5(random()::text)) FROM (
WITH ns AS (SELECT oid, nspname, nspacl FROM pg_namespace WHERE nspname LIKE 'warehouse%' OR nspname = 'enterprise_org')
SELECT 'schema|'||ns.nspname||'|'||md5(coalesce((SELECT string_agg(x::text,',' ORDER BY x::text) FROM unnest(ns.nspacl) x),'')) FROM ns
UNION ALL SELECT 'table|'||ns.nspname||'.'||c.relname||'|'||md5(c.relkind::text||c.relrowsecurity::text||c.relforcerowsecurity::text||pg_get_userbyid(c.relowner)
    ||coalesce((SELECT string_agg(x::text,',' ORDER BY x::text) FROM unnest(c.relacl) x),''))
  FROM pg_class c JOIN ns ON ns.oid=c.relnamespace WHERE c.relkind IN ('r','p','v','m','S')
UNION ALL SELECT 'column|'||ns.nspname||'.'||c.relname||'.'||a.attname||'|'||md5(format_type(a.atttypid,a.atttypmod)||a.attnotnull::text
    ||coalesce(pg_get_expr(d.adbin,d.adrelid),'')||coalesce((SELECT string_agg(x::text,',' ORDER BY x::text) FROM unnest(a.attacl) x),''))
  FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN ns ON ns.oid=c.relnamespace
  LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
  WHERE c.relkind IN ('r','p','v','m') AND a.attnum>0 AND NOT a.attisdropped
UNION ALL SELECT 'function|'||ns.nspname||'.'||p.proname||'('||pg_get_function_identity_arguments(p.oid)||')|'||md5(p.prokind::text||coalesce(p.prosrc,'')||p.prosecdef::text
    ||coalesce(array_to_string(p.proconfig,','),'')||coalesce(pg_get_userbyid(p.proowner),'')||coalesce(pg_get_function_result(p.oid),'(procedure)')
    ||coalesce((SELECT string_agg(x::text,',' ORDER BY x::text) FROM unnest(p.proacl) x),'(default)'))
  FROM pg_proc p JOIN ns ON ns.oid=p.pronamespace
UNION ALL SELECT 'constraint|'||ns.nspname||'.'||c.relname||'.'||k.conname||'|'||md5(pg_get_constraintdef(k.oid))
  FROM pg_constraint k JOIN pg_class c ON c.oid=k.conrelid JOIN ns ON ns.oid=c.relnamespace
UNION ALL SELECT 'index|'||ns.nspname||'.'||c.relname||'|'||md5(pg_get_indexdef(c.oid)) FROM pg_class c JOIN ns ON ns.oid=c.relnamespace WHERE c.relkind='i'
UNION ALL SELECT 'trigger|'||ns.nspname||'.'||c.relname||'.'||t.tgname||'|'||md5(pg_get_triggerdef(t.oid)||t.tgenabled::text)
  FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN ns ON ns.oid=c.relnamespace WHERE NOT t.tgisinternal
UNION ALL SELECT 'policy|'||ns.nspname||'.'||c.relname||'.'||po.polname||'|'||md5(po.polcmd::text||po.polpermissive::text
    ||coalesce((SELECT string_agg(r::regrole::text,',' ORDER BY r::regrole::text) FROM unnest(po.polroles) r),'')
    ||coalesce(pg_get_expr(po.polqual,po.polrelid),'')||coalesce(pg_get_expr(po.polwithcheck,po.polrelid),''))
  FROM pg_policy po JOIN pg_class c ON c.oid=po.polrelid JOIN ns ON ns.oid=c.relnamespace
UNION ALL SELECT 'role|'||rolname||'|'||md5(rolcanlogin::text||rolbypassrls::text||rolinherit::text||rolcreaterole::text) FROM pg_roles WHERE rolname LIKE 'tcds\_%'
UNION ALL SELECT 'member|'||r.rolname||'>'||m.rolname||'|'||am.admin_option::text||am.inherit_option::text||am.set_option::text
  FROM pg_auth_members am JOIN pg_roles r ON r.oid=am.roleid JOIN pg_roles m ON m.oid=am.member
  WHERE (r.rolname LIKE 'tcds\_%' OR m.rolname LIKE 'tcds\_%') AND m.rolname <> 'postgres'
UNION ALL SELECT 'postgres-member|'||r.rolname||'|'||bool_or(am.inherit_option)::text||bool_or(am.set_option)::text
  FROM pg_auth_members am JOIN pg_roles r ON r.oid=am.roleid WHERE am.member='postgres'::regrole AND r.rolname LIKE 'tcds\_%' GROUP BY r.rolname
) q(x);
