# EOC 6.4 V1.2 application schema (`eoc_iam`), staging

Status: **certified on staging only** (`kqcdqtazcqaawdkmcfed`), installed 2026-11-07T06:53:54Z. **Not applied to production.**

## What this is
Anthony's EOC backend keeps its own state in an `eoc_iam` schema: login flows, EOC sessions, module grants, two-approver
grant evidence, and audit. The package ships it as `064 → 071 → 072`, for a separate "retail/EOC" database.

Production is on hold, so it is staged on the **staging Supabase database** (`kqcdqtazcqaawdkmcfed`). That database also
holds the Warehouse IAM. This is a staging-only deviation from Anthony's layout, and the isolation is tested:
- `eoc_iam` references nothing outside itself;
- the EOC roles hold nothing outside it;
- the EOC backend login cannot read `warehouse_identity` or `enterprise_org`.

**Anthony's 064/071/072 are applied byte-for-byte unchanged.** The script checks their sha256 against the package. Our
corrections sit around them in the same transaction:

| File | Purpose |
|---|---|
| `eoc_v12_pre.sql` | Creates the five EOC roles first and gives `postgres` temporary INHERIT+SET membership. |
| `eoc_v12_post.sql` | Readiness probe, Supabase API-role lockdown, membership removal, self-verification. |
| `eoc_v12_rollback.sql` | Replaces Anthony's 073. |

## Defects found
| # | Vendor behaviour | Impact | Fix |
|---|---|---|---|
| 1 | `071`/`072` run `ALTER FUNCTION … OWNER TO` a role created in the same file. | On Supabase PG17, `postgres` is not a superuser and only gets ADMIN on roles it creates. The install fails: `must be able to SET ROLE "eoc_iam_executor"` (and `eoc_grant_fn_owner`). Reproduced on a PG17 mirror. | `eoc_v12_pre.sql` pre-creates the roles and grants `postgres` temporary INHERIT+SET, so ownership and the follow-up GRANT/REVOKE act as the owner. `eoc_v12_post.sql` removes the membership again, and the install verifies it is gone. |
| 2 | BFF `/api/eoc/auth/ready` runs `SELECT 1 FROM eoc_iam.sessions`, but 071 revokes all table access from `eoc_app_runtime`. | Ready can only ever return 503 `IAM_NOT_READY` (test A1). | New definer probe `eoc_iam.db_ready_v12()` (A2). **The BFF needs one line changed** in `server/index.mjs`: use `SELECT eoc_iam.db_ready_v12()`. |
| 3 | 064 revokes only PUBLIC. | On Supabase, default privileges can hand `anon`/`authenticated`/`service_role` rights on new objects. | `eoc_v12_post.sql` revokes everything from those roles in `eoc_iam`. The install verifies that no grantee exists outside the five EOC roles. |
| 4 | Anthony's rollback `073` uses `DROP OWNED BY`. | Fails for a non-superuser `postgres` that holds only ADMIN on those roles. | `eoc_v12_rollback.sql` grants temporary membership first. It refuses while any EOC row exists, and the rehearsal confirms the catalog ends up identical. |

## Staging certification (2026-11-07): rehearsal 36/36 PASS with `catalog_identical=true`; after install 41/41 PASS
The test runs as the real roles via `SET ROLE` in a transaction that is rolled back. The L checks log in as the staging backend login.
Staging inspect: PG 17.6; `postgres` createrole, not a superuser; `createrole_self_grant` empty.
Supabase's API-role default privileges cover only `public`/`storage` here. The defect 3 guard stays for other projects.


**S. Structure**
- 6 tables, all with forced row security.
- No PUBLIC, `anon`, `authenticated` or `service_role` privileges.
- Function owners: 9 owned by `eoc_iam_executor`, 1 by `eoc_grant_fn_owner`.
- `postgres` keeps no membership.

**A. App runtime**
- The direct table query is denied, and the probe works.
- A flow is created and consumed once; a second consume, or consuming an expired flow, finds nothing.
- Bad input is rejected.
- A session is created together with its `LOGIN_SUCCESS` audit row in one call.
- Look-up, touch and revoke work, and revoking twice returns false.
- A negative epoch is rejected.
- A forged audit type is rejected.
- The app runtime cannot call the grant writer.
- Direct UPDATE is denied.

**G. Governed grants**
- No approvals → refused. Same approver twice → refused. Approvals for another module → refused.
- Two valid approvals → grant created. Replaying them → refused.
- An expired attestation is blocked by row security.
- The attestation writer can insert but not read.
- The grant admin cannot write grants or attestations directly.
- The grant leaves one audit row and two consumed approvals.

**L. Backend login `eoc_iam_bff_stg`**
- Logs in and the probe returns true.
- Cannot read tables, cannot `SET ROLE` to the executor, and cannot read `warehouse_identity` or `enterprise_org`.

## Still open
- **The BFF one-line ready fix (defect 2).** Owner: Anthony's team or Codex.
- **No pruning of abandoned `login_flows`, expired `sessions` or `audit_events`.** Same retention question as the bridge
  audit.
- **The attestation writer `eoc_iam_verified_attestation_writer` has no login.** That needs Anthony's WebAuthn verifier
  service. Until it exists, no grant can be created, which is the intended fail-closed state.
- **Production placement (which database) is decided at release.**

## Usage (on the Warehouse server, from `/srv/arb-system/api`)

```bash
bash /tmp/recov15/eoc_db/stg_eoc_db.sh inspect     # read only
bash /tmp/recov15/eoc_db/stg_eoc_db.sh rehearse    # nothing kept; expect 36 PASS and catalog_identical=true
bash /tmp/recov15/eoc_db/stg_eoc_db.sh install
bash /tmp/recov15/eoc_db/stg_eoc_db.sh bind-login  # credentials to ~/stg_login/eoc_db.env, never printed
bash /tmp/recov15/eoc_db/stg_eoc_db.sh test        # rolled back; 36 + 5 checks
```

To remove it: `CONFIRM=UNINSTALL-EOC-DB … uninstall`.
