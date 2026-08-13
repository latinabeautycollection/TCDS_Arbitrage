#!/usr/bin/env bash
set -Eeuo pipefail
: "${DATABASE_URL:?DATABASE_URL is required}"
TENANT_A="${DOMAIN8_TENANT_ID:-00000000-0000-0000-0000-000000000008}"
TENANT_B="${DOMAIN8_ADVERSARIAL_TENANT_ID:-00000000-0000-0000-0000-000000000099}"
ACTOR="${DOMAIN8_ACTOR_ID:-00000000-0000-0000-0000-000000000001}"
CID="$(uuidgen 2>/dev/null || python3 -c 'import uuid; print(uuid.uuid4())')"
psql "$DATABASE_URL" -X -v ON_ERROR_STOP=1 -v tenant_a="$TENANT_A" -v tenant_b="$TENANT_B" -v actor="$ACTOR" -v cid="$CID" <<'SQL'
BEGIN;
SET LOCAL app.tenant_id=:'tenant_a'; SET LOCAL app.actor_id=:'actor'; SET LOCAL app.actor_type='ADMIN'; SET LOCAL app.correlation_id=:'cid';
DO $$DECLARE pub_exec bigint;BEGIN
 SELECT count(*) INTO pub_exec FROM information_schema.routine_privileges WHERE specific_schema='return_defense' AND grantee='PUBLIC' AND privilege_type='EXECUTE';
 IF pub_exec<>0 THEN RAISE EXCEPTION 'PUBLIC retains EXECUTE on % functions',pub_exec; END IF;
END$$;
DO $$DECLARE ok boolean:=false;BEGIN
 BEGIN UPDATE return_defense.policy_versions SET policy_document=policy_document||'{"illegal":true}'::jsonb WHERE tenant_id=:'tenant_a'::uuid AND status='ACTIVE'; EXCEPTION WHEN SQLSTATE '55000' THEN ok:=true; END;
 IF NOT ok THEN RAISE EXCEPTION 'Active policy mutation was not blocked'; END IF;
END$$;
DO $$DECLARE a record;b record;c record;bad boolean:=false;BEGIN
 SELECT * INTO a FROM return_defense.claim_idempotency_key('CERT:IDEMPOTENCY','cert-key','{"a":1}',interval '5 minutes',:'cid');
 SELECT * INTO b FROM return_defense.claim_idempotency_key('CERT:IDEMPOTENCY','cert-key','{"a":1}',interval '5 minutes',:'cid');
 IF a.disposition NOT IN('CLAIMED','RECLAIMED') OR b.disposition<>'IN_PROGRESS' THEN RAISE EXCEPTION 'Idempotency claim behavior failed'; END IF;
 PERFORM return_defense.start_idempotent_processing(a.idempotency_id,a.owner_token,interval '5 minutes');
 PERFORM return_defense.heartbeat_idempotency(a.idempotency_id,a.owner_token,interval '5 minutes');
 PERFORM return_defense.complete_idempotency_key(a.idempotency_id,a.owner_token,'OK','{"done":true}');
 SELECT * INTO c FROM return_defense.claim_idempotency_key('CERT:IDEMPOTENCY','cert-key','{"a":1}',interval '5 minutes',:'cid');
 IF c.disposition<>'REPLAY' THEN RAISE EXCEPTION 'Idempotency replay failed'; END IF;
 BEGIN PERFORM * FROM return_defense.claim_idempotency_key('CERT:IDEMPOTENCY','cert-key','{"a":2}',interval '5 minutes',:'cid'); EXCEPTION WHEN unique_violation THEN bad:=true; END;
 IF NOT bad THEN RAISE EXCEPTION 'Idempotency payload collision not blocked'; END IF;
END$$;
DO $$DECLARE e uuid;o uuid;blocked boolean:=false;BEGIN
 e:=return_defense.append_domain_event('CERTIFICATION','case-1','CERT_EVENT','{"ok":true}','{}',:'cid','cert-event','ADMIN',:'actor','tcds.domain8.cert');
 SELECT outbox_event_id INTO o FROM return_defense.outbox_events WHERE domain_event_id=e;
 IF o IS NULL THEN RAISE EXCEPTION 'Transactional outbox missing'; END IF;
 BEGIN UPDATE return_defense.domain_events SET event_payload='{}' WHERE event_id=e; EXCEPTION WHEN SQLSTATE '55000' THEN blocked:=true; END;
 IF NOT blocked THEN RAISE EXCEPTION 'Domain event update not blocked'; END IF;
 blocked:=false; BEGIN UPDATE return_defense.outbox_events SET payload='{}' WHERE outbox_event_id=o; EXCEPTION WHEN SQLSTATE '55000' THEN blocked:=true; END;
 IF NOT blocked THEN RAISE EXCEPTION 'Outbox payload update not blocked'; END IF;
END$$;
DO $$DECLARE v record;BEGIN
 SELECT * INTO v FROM return_defense.verify_audit_chain(:'tenant_a','GOVERNANCE');
 IF NOT v.is_valid THEN RAISE EXCEPTION 'Audit chain invalid at %',v.first_bad_audit_id; END IF;
END$$;
DO $$DECLARE own bigint;other bigint;BEGIN
 SELECT count(*) INTO own FROM return_defense.policy_versions;
 PERFORM set_config('app.tenant_id',:'tenant_b',true);
 SELECT count(*) INTO other FROM return_defense.policy_versions;
 IF other<>0 THEN RAISE EXCEPTION 'Cross-tenant policy visibility detected'; END IF;
 PERFORM set_config('app.tenant_id',:'tenant_a',true);
 IF own<1 THEN RAISE EXCEPTION 'Expected tenant policy not visible'; END IF;
END$$;
ROLLBACK;
SQL
echo 'Domain 8 Slice 8A.1.1 behavioral/adversarial certification: PASS'
