# 10A Architecture
Originating Domain → immutable operational event → policy/version resolution → recipient authorization/audience snapshot → notification request → per-recipient EMAIL/SMS deliveries → transactional outbox → provider worker → provider receipt → incident/ack/escalation → immutable audit evidence.

`ACCEPTED_BY_PROVIDER` is not `DELIVERED`.

Domain 10 decides who must know, how, whether acknowledgement is required, and when escalation occurs. It does not rewrite the originating domain's business decision.
