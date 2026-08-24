# Production Repository Collision Review — 2026-08-13

The live public repository currently contains an existing `src/domains/operations` tree from the Domain 10 email work.

Observed existing files include:

- `config/emailEnv.ts`
- `config/emailPolicyConfig.ts`
- `errors/EmailProviderError.ts`
- `models/emailTypes.ts`
- `observability/emailLogger.ts`
- `observability/emailMetrics.ts`
- `observability/emailTracing.ts`
- `repositories/db.ts`
- `repositories/emailAuditRepository.ts`
- `repositories/emailControlRepository.ts`
- `repositories/emailDeliveryRepository.ts`
- `repositories/emailRateLimitRepository.ts`
- `repositories/emailTemplateRepository.ts`
- `repositories/recipientAuthorizationRepository.ts`
- `services/dataRedactionService.ts`
- `services/emailNotificationService.ts`
- `services/emailReconciliationService.ts`
- `services/emailTemplateService.ts`
- `services/recipientAuthorizationService.ts`
- `workers/emailDeliveryWorker.ts`
- `workers/emailReconciliationWorker.ts`
- `workers/emailRetryWorker.ts`

Revision 2 deliberately uses additive names. None of the 10B runtime file names in the reviewed package match the observed production files above.

The original 10B `repositories/db.ts` would have collided with the production Email `db.ts`; Revision 2 removes it and injects the existing pool via `infrastructure/operationsRuntime.ts`.

This review is time-sensitive. The supplied `scripts/preflight-domain10-10b-repo.sh` must be run against the exact production checkout immediately before merge and must fail if any destination path appears after this review.
