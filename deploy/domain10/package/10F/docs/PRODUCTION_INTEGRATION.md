# 10F Production Integration

1. Install and certify the latest reviewed 10A→10E packages first.
2. Run `REPO_ROOT=/srv/tcds-arbitrage ./scripts/preflight-domain10-10f-repo.sh` against the exact merge commit.
3. Overlay only `src/domains/operations/domain10Certification/**` plus 529–531 DB assets/scripts/tests.
4. Do **not** create or schedule a 10F worker. The existing generic production `certificationWorker.ts` is unrelated and remains untouched.
5. Run the 10F certification service from CI/QA or an explicit administrative release command.
6. Execute a certification against a bounded evidence window containing actual 10B/10C/10D/10E test activity.
7. Record every required live attestation with SHA-256 evidence.
8. Call finalization. Only `CERTIFIED` with a sealed `run_hash` is a Green Tier 1 Domain-10 certification artifact.
9. Deployment remains outside 10F; do not let a database certification row directly deploy production code.
