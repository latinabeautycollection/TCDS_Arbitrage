# 10E Production Integration

1. Merge/certify reviewed 10A, then 10B, then 10C, then the latest reviewed 10D.
2. Run `REPO_ROOT=/srv/tcds-arbitrage ./scripts/preflight-domain10-10e-repo.sh`.
3. Overlay only `src/domains/operations/assurance/**`.
4. Apply DB 524, 525, security 526 and integration seed through normal migration governance.
5. Configure the 10E event-intake port around reviewed 10B `acceptOperationalEvent`.
6. Add `runAssuranceEvaluationBatch()` and `runAssuranceEventEmissionBatch()` to the existing managed worker scheduler.
7. Keep `DOMAIN10_ASSURANCE_ENABLED=false` until live SLO tests pass.
8. Create/approve real frozen SLO thresholds. The package intentionally does not invent production SLO targets.
9. Configure normal 10B notification policies for assurance breach/recovery only after leadership approves routing/escalation behavior.

10E does not need Microsoft Graph or Telnyx credentials.
