# Reviewed 10A Compatibility

10B is designed specifically for the reviewed 10A contract containing:

- `operations.operational_events`
- `operations.event_processing`
- `operations.notification_policies`
- `operations.notification_policy_versions`
- `operations.notification_templates`
- `operations.notification_template_versions`
- `operations.notification_requests`
- `operations.notification_recipients`
- `operations.notification_deliveries`
- `operations.notification_outbox`
- `operations.recipient_directory`
- `operations.notification_audiences`
- `operations.audience_members`
- `operations.recipient_authorizations`
- `operations.sms_subscriptions`
- `operations.suppression_rules`
- `operations.suppression_decisions`
- `operations.audit_ledger`
- reviewed 10A delivery-hash/state/consent hardening from migration 511.

10B adds migration `513_domain10_event_decision_engine.sql`; it does not replace or duplicate the 10A source-of-truth tables.

The 10B certification script explicitly refuses to run if reviewed 10A evidence tables are absent.
