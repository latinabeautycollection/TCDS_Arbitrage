-- Catalog snapshot for the 626 rehearsal: everything 626 could add or change (warehouse_identity functions, tables,
-- grants, RLS, roles and memberships of the migrator). Usage: \set snap <name>, then \i this file.
CREATE TEMP TABLE IF NOT EXISTS _snap (name text, item text);
INSERT INTO _snap
SELECT :'snap', 'fn ' || p.oid::regprocedure || ' ' || pg_get_userbyid(p.proowner) || ' ' || p.prosecdef || ' ' || coalesce(p.proacl::text, '-') || ' ' || md5(p.prosrc)
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'warehouse_identity'
UNION ALL
SELECT :'snap', 'rel ' || c.relname || ' ' || c.relkind::text || ' ' || pg_get_userbyid(c.relowner) || ' ' || coalesce(c.relacl::text, '-') || ' ' || c.relrowsecurity || c.relforcerowsecurity
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'warehouse_identity'
UNION ALL
SELECT :'snap', 'col ' || c.relname || '.' || a.attname || ' ' || format_type(a.atttypid, a.atttypmod) || ' ' || a.attnotnull
  FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE n.nspname = 'warehouse_identity' AND c.relkind = 'r' AND a.attnum > 0 AND NOT a.attisdropped
UNION ALL
SELECT :'snap', 'con ' || conrelid::regclass || ' ' || conname || ' ' || pg_get_constraintdef(oid)
  FROM pg_constraint WHERE connamespace = 'warehouse_identity'::regnamespace
UNION ALL
SELECT :'snap', 'pol ' || polrelid::regclass || ' ' || polname FROM pg_policy p JOIN pg_class c ON c.oid = p.polrelid WHERE c.relnamespace = 'warehouse_identity'::regnamespace
UNION ALL
SELECT :'snap', 'role ' || rolname || ' ' || rolcanlogin || rolbypassrls FROM pg_roles WHERE rolname LIKE 'tcds\_%'
UNION ALL
SELECT :'snap', 'member ' || roleid::regrole || ' -> ' || member::regrole || ' ' || inherit_option || set_option || admin_option
  FROM pg_auth_members WHERE member = current_user::regrole OR roleid::regrole::text LIKE 'tcds\_%'
UNION ALL
SELECT :'snap', 'nsp ' || coalesce(nspacl::text, '-') FROM pg_namespace WHERE nspname = 'warehouse_identity';
