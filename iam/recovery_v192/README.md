# Warehouse password recovery V1.9.2 — staging integration (ours)

Vendor package: `TCDS_Warehouse_LoginV2_Recovery_V1_9_2_Final_Integration_Hardening_Candidate.zip` (self-declared RED).
Vendor SQL in `sql/63x–643` is byte-identical to the vendor manifest. `602`/`602a` are copies of Slice 6.2, used only if a
rehearsal target lacks them.

## Install order (staging; production only after the full end-to-end gate)
1. `644_pre_install_ledger.sql`: records the exact 621 guard and the function owner's direct grants
2. vendor `634`, `635`, `637`, `640`, `641` (unchanged). **Vendor 636 and 638 are not used.**
3. `644_recovery_v192_runtime_interface.sql`
4. Full rollback: `644_rollback_full.sql`, which returns the catalog to the ledger state

## Why 644 replaces vendor 636/638
The staging rehearsal (`v192_rehearse.sh`, 2026-11-22) showed the vendor's three NOLOGIN roles cannot run the vendor code:
- no row-security rules on `password_reset_requests` and `auth_sessions`;
- SELECT-only grants under `FOR UPDATE`;
- no SELECT on proofs;
- `tcds_login_api` has no table access for intake and the queue.

The vendor's own 643 gate fails against 636. 644 instead gives `tcds_login_api` EXECUTE on 20 narrow
`SECURITY DEFINER` functions (`recovery_*_v192`), owned by `tcds_identity_function_owner`, and no table access. It removes
the vendor roles and fixes:

- **D4:** a stale code no longer blocks new codes.
- **D8:** single clock reading for created/expires.
- **D9:** a second proof for the same reset.
- **D10:** intake hides the 24h limit.

## Evidence
- **`v192_rehearse.sh`:** vendor 634–641 as shipped, with probes. Confirmed D3a/b/c and D4; D6 withdrawn on staging.
  Vendor rollbacks leave grants, policies and roles.
- **`v192_644_rehearse.sh`:** our bundle. Functional flow 30/30 as `tcds_login_api`. Full rollback catalog-identical, twice.
- **`graph_mail_check.sh`:** Microsoft Graph Mail.Send confirmed, sender `alerts@tcdsolutionsgroup.com`.

## Staging
`stg_v192_install.sh status|install|verify|uninstall`. After install, the 635 guard requires an OTP proof for every reset.

## Still open
- **Adapter in login-v2-api:**
  - bind the vendor router to 6.1B claim/consume and the v192 functions;
  - encrypted reset-token store;
  - approve through `approve_password_reset_v3`;
  - EXECUTE on `authorize_password_recovery_override_v62` for the manager override.
- **PWA:**
  - `rowVersion` vs `expectedRowVersion`;
  - code and new password in one step;
  - hide the unsupported decisions.
- **Recovery-contact enrollment:** policy decision with Anthony.
- **Real passkey step-up test:** needs a staging sign-in.
