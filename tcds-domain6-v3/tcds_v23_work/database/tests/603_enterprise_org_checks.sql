-- Structure and exposure checks for enterprise_org. Read only.
SELECT 'installed | tables=' || count(*) || ' rls_forced=' || bool_and(c.relrowsecurity AND c.relforcerowsecurity)
  || ' policies=' || (SELECT count(*) FROM pg_policies WHERE schemaname='enterprise_org')
  || ' holder_index=' || (to_regclass('enterprise_org.ux_enterprise_org_one_current_holder') IS NOT NULL)
FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='enterprise_org' AND c.relkind='r';
SELECT 'exposure | anon_usage=' || has_schema_privilege('anon','enterprise_org','USAGE')
  || ' auth_usage=' || has_schema_privilege('authenticated','enterprise_org','USAGE')
  || ' anon_select=' || has_table_privilege('anon','enterprise_org.contact_points','SELECT')
  || ' auth_select=' || has_table_privilege('authenticated','enterprise_org.contact_points','SELECT')
  || ' service_role_select=' || CASE WHEN EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role')
       THEN has_table_privilege('service_role','enterprise_org.contact_points','SELECT')::text ELSE 'n/a' END;
SELECT 'rows | people=' || (SELECT count(*) FROM enterprise_org.leadership_people)
  || ' positions=' || (SELECT count(*) FROM enterprise_org.positions)
  || ' appointments=' || (SELECT count(*) FROM enterprise_org.leadership_appointments)
  || ' contacts=' || (SELECT count(*) FROM enterprise_org.contact_points);
