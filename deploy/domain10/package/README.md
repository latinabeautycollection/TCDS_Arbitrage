# TCDS Domain 10A–10F Peer-Reviewed Master

This master package contains the latest reviewed 10A–10F slices plus the
cross-slice remediation found during the enterprise peer review.

## Required deployment order

10A → 10B → 10C → 10D → 10E → 10F

## Mandatory before overlay

1. Install production-root AJV dependencies:
   `npm install --save-exact ajv@8.17.1 ajv-formats@3.0.1`
2. Run `production-integration/preflight-domain10-enterprise-repo.sh`.
3. Confirm legacy email workers are not scheduled.
4. Apply the reviewed DB migrations in slice order.
5. Run every slice certification script and the 10F profile-v2 release evidence.

Read `DOMAIN10_ENTERPRISE_PEER_REVIEW.md` before production implementation.
