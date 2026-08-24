\set ON_ERROR_STOP on
DO $$ BEGIN
 IF to_regclass('operations.incident_runtime_10d') IS NULL OR to_regclass('operations.incident_escalation_emissions_10d') IS NULL THEN RAISE EXCEPTION '10D tables missing'; END IF;
 IF to_regprocedure('operations.apply_incident_command_10d(text,text,text,uuid,text,timestamptz,uuid,text)') IS NULL THEN RAISE EXCEPTION '10D incident command function missing'; END IF;
 IF to_regprocedure('operations.settle_escalation_emission_10d(uuid,text)') IS NULL THEN RAISE EXCEPTION '10D escalation settlement missing'; END IF;
END $$;
DO $$ DECLARE def text; BEGIN
 SELECT pg_get_functiondef('operations.claim_incident_activation_10d(text,integer,integer)'::regprocedure) INTO def;
 IF position('SKIP LOCKED' IN upper(def))=0 THEN RAISE EXCEPTION 'Incident activation claim lacks SKIP LOCKED'; END IF;
 SELECT pg_get_functiondef('operations.claim_due_incident_escalations_10d(text,integer,integer)'::regprocedure) INTO def;
 IF position('SKIP LOCKED' IN upper(def))=0 THEN RAISE EXCEPTION 'Escalation claim lacks SKIP LOCKED'; END IF;
END $$;
DO $$ BEGIN
 IF has_function_privilege('public','operations.apply_incident_command_10d(text,text,text,uuid,text,timestamptz,uuid,text)','EXECUTE') THEN RAISE EXCEPTION 'PUBLIC can execute incident command'; END IF;
END $$;
DO $$ DECLARE def text; BEGIN
 SELECT pg_get_functiondef('operations.settle_escalation_emission_10d(uuid,text)'::regprocedure) INTO def;
 IF position('notification_decisions' IN def)=0 OR position('notification_deliveries' IN def)=0 OR position('incident_escalation_executions' IN def)=0 THEN RAISE EXCEPTION '10D settlement does not integrate 10B/10C/10A evidence'; END IF;
END $$;
\echo 'PASS: Domain 10D database contract tests.'
