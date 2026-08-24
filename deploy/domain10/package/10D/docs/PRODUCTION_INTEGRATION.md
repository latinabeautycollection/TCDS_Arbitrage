# Production Integration

1. Integrate/certify reviewed 10A, then 10B, then 10C.
2. Run `REPO_ROOT=/srv/tcds-arbitrage ./scripts/preflight-domain10-10d-repo.sh`.
3. Apply 519, 520, 521 through normal DB change control.
4. Configure one exact `incident_escalation_bindings_10d` row for each enabled 10A escalation step. The referenced 10B event contract/policy must be frozen and match audience/channels/ACK semantics.
5. At composition root, inject reviewed 10B intake:

```ts
configureIncidentIntegrationRegistry({
  notificationDecision: adaptReviewed10BEventIntake(acceptOperationalEvent)
});
```

6. Wire batch functions into the existing managed worker process:

```ts
runIncidentActivationBatch()
runAcknowledgementDeadlineBatch()
runIncidentEscalationBatch()
runIncidentEscalationSettlementBatch()
```

7. Existing verified Telnyx inbound handler may route only explicit `ACK/OWN/DECLINE <incident-key>` commands to 10D. START/STOP/HELP remain with consent handling.
8. Keep `DOMAIN10_INCIDENTS_ENABLED=false` until certification is signed off.
