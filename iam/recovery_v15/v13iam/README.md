# Domain 6.4 V1.3: IAM-side 624 + 625 (central IAM staging)

Vendor `624_eoc_governed_binding_approvals_v13.sql` and `625_eoc_bridge_retention_v13.sql` are **unchanged** (sha256-pinned
in `stg_v13_iam.sh`). They are wrapped by:

- `v13_pre.sql`: preflight (623 and `webauthn_verification_evidence` present; the function owner does not already hold
  any privilege 624/625 grant it), then the **Supabase PG17 fix**: a temporary
  `GRANT CREATE ON SCHEMA warehouse_identity TO tcds_identity_function_owner`. The vendor files copy 623's temporary role
  membership but not this grant, so their `ALTER FUNCTION ... OWNER TO tcds_identity_function_owner` is refused on Supabase.
- `v13_post.sql`: restores the schema privilege and self-verifies (function owner/definer/search_path, no execute for
  PUBLIC/anon/authenticated/service_role/tcds_login_api, 5 tables with forced RLS, 4 NOLOGIN roles).
- `v13_rollback.sql`: our rollback (the package ships none for 624/625). Revokes exactly what 624/625 granted; refuses
  while any V1.3 row exists or the approver capability is assigned.
- `v13_test.sql`: 19 checks (structure, binding writer, retention, legal holds), run as each V1.3 role.

`stg_v13_iam.sh rehearse` installs, tests, runs the rollback and requires the catalog snapshot to be identical, all in one
transaction that is rolled back. Local PG17 replica with 623 stand-ins: 19/19 PASS, `catalog_identical=true`.

Not functional until the dev team supplies the central WebAuthn step-up verifier and signer: every binding needs two
approvers with fresh AAL2 WebAuthn evidence, the same missing ceremony that blocks recovery approvals (6.2).
