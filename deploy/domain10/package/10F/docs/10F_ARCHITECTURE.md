# Domain 10F — Enterprise Certification, Replay Verification & Release Evidence

## Mission
10F is the final Domain 10 slice. It proves that the Domain 10 system built in 10A–10E is structurally intact, historically reproducible, operationally tested and supported by signed/hashed certification evidence.

10F does **not** authorize deployment. It produces a `CERTIFIED` or `REJECTED` Domain-10 certification record. The release/deployment system may consume that record under its own governance.

## Ownership
- **10A:** authoritative event/notification/delivery/incident/audit truth.
- **10B:** notification decision authority.
- **10C:** Graph/Telnyx delivery execution.
- **10D:** incident/ACK/escalation orchestration.
- **10E:** communication SLO/assurance evaluation.
- **10F:** certification profiles, certification runs, automated check results and external test attestations only.

## Important non-overlap
10F has no worker, no provider client, no event producer, no notification planner, no incident command and no SLO calculator. It reads prior-slice evidence and stores certification evidence in its own `_10f` objects.

## Certification model
A frozen 10F profile defines:
1. fixed check keys (never arbitrary SQL),
2. minimum sample sizes,
3. required external attestations,
4. settlement grace.

Automated checks run in a repeatable-read transaction through TypeScript. Required checks must be PASS, not merely non-FAIL. Required external attestations must also be PASS before the run can become `CERTIFIED`.

## Replay verification
`DECISION_POLICY_REPLAY` invokes the reviewed 10B `resolve_authoritative_notification_policy(event_id)` over historical decision evidence. 10F does not copy the 10B policy algorithm into TypeScript and does not create a second notification decision.

## External attestations
10F records evidence that tests were actually run; it does not perform provider delivery itself. Required evidence includes PostgreSQL migrations/tests, root npm/build/Jest, concurrency, Graph/Telnyx live drills, STOP-before-send, ACK/escalation, 10E breach/recovery and repository collision preflight.


## Finalization semantics
Automated failures do not stop evidence collection. The run remains `AWAITING_ATTESTATIONS` so the complete certification record can be assembled. Finalization is prohibited while any required attestation is missing. Once all evidence exists, any required FAIL/ERROR/INCONCLUSIVE or failed attestation produces a sealed `REJECTED` run; only all-PASS evidence produces `CERTIFIED`.
