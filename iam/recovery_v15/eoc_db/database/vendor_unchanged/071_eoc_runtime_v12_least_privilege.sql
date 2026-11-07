-- Domain 6.4 V1.2 EOC RETAIL DATABASE ONLY. Additive after 064. Never central IAM DB.
BEGIN;
SET LOCAL lock_timeout='5s';SET LOCAL statement_timeout='30s';
DO $$BEGIN IF to_regclass('eoc_iam.sessions') IS NULL OR to_regclass('eoc_iam.login_flows') IS NULL THEN RAISE EXCEPTION 'EOC_V11_SCHEMA_MISSING'; END IF; END$$;
DO $$BEGIN IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='eoc_iam_executor') THEN CREATE ROLE eoc_iam_executor NOLOGIN; END IF; END$$;
GRANT USAGE ON SCHEMA eoc_iam TO eoc_iam_executor;
GRANT SELECT,INSERT,DELETE ON eoc_iam.login_flows TO eoc_iam_executor;
GRANT SELECT,INSERT,UPDATE ON eoc_iam.sessions TO eoc_iam_executor;
GRANT SELECT ON eoc_iam.module_grants TO eoc_iam_executor;
GRANT INSERT ON eoc_iam.audit_events TO eoc_iam_executor;
GRANT USAGE ON SEQUENCE eoc_iam.audit_events_audit_id_seq TO eoc_iam_executor;
CREATE POLICY eoc_executor_flows ON eoc_iam.login_flows FOR ALL TO eoc_iam_executor USING(true) WITH CHECK(true);
CREATE POLICY eoc_executor_sessions ON eoc_iam.sessions FOR ALL TO eoc_iam_executor USING(true) WITH CHECK(true);
CREATE POLICY eoc_executor_grants ON eoc_iam.module_grants FOR SELECT TO eoc_iam_executor USING(true);
CREATE POLICY eoc_executor_audit ON eoc_iam.audit_events FOR INSERT TO eoc_iam_executor WITH CHECK(true);
REVOKE ALL ON eoc_iam.login_flows,eoc_iam.sessions,eoc_iam.module_grants,eoc_iam.audit_events FROM eoc_app_runtime;
DROP POLICY IF EXISTS eoc_app_flows ON eoc_iam.login_flows;
DROP POLICY IF EXISTS eoc_app_sessions ON eoc_iam.sessions;
DROP POLICY IF EXISTS eoc_app_grants_read ON eoc_iam.module_grants;
DROP POLICY IF EXISTS eoc_app_audit_write ON eoc_iam.audit_events;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA eoc_iam FROM eoc_app_runtime;

GRANT CREATE ON SCHEMA eoc_iam TO eoc_iam_executor;
CREATE FUNCTION eoc_iam.create_flow_v12(p_hash text,p_verifier text,p_state text,p_nonce text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 IF p_hash !~ '^[a-f0-9]{64}$' OR length(p_verifier) NOT BETWEEN 43 AND 128 OR length(p_state)<16 OR length(p_nonce)<16 THEN RAISE EXCEPTION 'INVALID_FLOW' USING ERRCODE='22023'; END IF;
 INSERT INTO eoc_iam.login_flows(flow_hash,pkce_verifier,oidc_state,oidc_nonce,expires_at) VALUES(p_hash,p_verifier,p_state,p_nonce,clock_timestamp()+interval '5 minutes');
END $$;
CREATE FUNCTION eoc_iam.consume_flow_v12(p_hash text) RETURNS eoc_iam.login_flows
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE r eoc_iam.login_flows;
BEGIN
 DELETE FROM eoc_iam.login_flows WHERE flow_hash=p_hash AND expires_at>clock_timestamp() RETURNING * INTO r;
 RETURN r;
END $$;
CREATE FUNCTION eoc_iam.create_session_and_audit_v12(
 p_token_hash text,p_csrf_hash text,p_subject uuid,p_position text,p_appointment uuid,p_position_code text,
 p_person_version bigint,p_appointment_version bigint,p_iam_epoch bigint,p_methods text[],p_auth_time timestamptz,p_request_id uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE v_id uuid;
BEGIN
 IF p_token_hash !~ '^[a-f0-9]{64}$' OR p_csrf_hash !~ '^[a-f0-9]{64}$' OR p_subject IS NULL OR p_appointment IS NULL OR p_iam_epoch IS NULL OR p_iam_epoch<0 OR p_request_id IS NULL THEN RAISE EXCEPTION 'INVALID_SESSION' USING ERRCODE='22023'; END IF;
 INSERT INTO eoc_iam.sessions(token_hash,csrf_hash,subject_id,position,appointment_id,position_code,person_row_version,appointment_row_version,iam_epoch,authentication_methods,authenticated_at,idle_expires_at,absolute_expires_at)
 VALUES(p_token_hash,p_csrf_hash,p_subject,p_position,p_appointment,p_position_code,p_person_version,p_appointment_version,p_iam_epoch,p_methods,p_auth_time,clock_timestamp()+interval '30 minutes',clock_timestamp()+interval '8 hours') RETURNING session_id INTO v_id;
 INSERT INTO eoc_iam.audit_events(event_type,subject_id,session_id,request_id,reason_code) VALUES('LOGIN_SUCCESS',p_subject,v_id,p_request_id,'CENTRAL_OIDC');
 RETURN v_id;
END $$;
CREATE FUNCTION eoc_iam.session_by_hash_v12(p_hash text) RETURNS eoc_iam.sessions
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT s FROM eoc_iam.sessions s WHERE s.token_hash=p_hash AND s.revoked_at IS NULL AND s.idle_expires_at>clock_timestamp() AND s.absolute_expires_at>clock_timestamp()
$$;
CREATE FUNCTION eoc_iam.touch_session_v12(p_id uuid) RETURNS timestamptz
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE t timestamptz;
BEGIN
 UPDATE eoc_iam.sessions SET idle_expires_at=LEAST(absolute_expires_at,clock_timestamp()+interval '30 minutes')
 WHERE session_id=p_id AND revoked_at IS NULL AND idle_expires_at>clock_timestamp() AND absolute_expires_at>clock_timestamp()
 RETURNING idle_expires_at INTO t;
 RETURN t;
END $$;
CREATE FUNCTION eoc_iam.revoke_session_v12(p_id uuid) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 UPDATE eoc_iam.sessions SET revoked_at=clock_timestamp(),revocation_reason='LOCAL_LOGOUT' WHERE session_id=p_id AND revoked_at IS NULL;
 RETURN FOUND;
END $$;
CREATE FUNCTION eoc_iam.grants_for_subject_v12(p_subject uuid) RETURNS SETOF eoc_iam.module_grants
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT g FROM eoc_iam.module_grants g WHERE g.subject_id=p_subject AND g.revoked_at IS NULL AND g.valid_from<=clock_timestamp() AND g.valid_until>clock_timestamp()
$$;
CREATE FUNCTION eoc_iam.audit_event_v12(p_type text,p_subject uuid,p_session uuid,p_req uuid,p_reason text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 IF p_type NOT IN ('LOGIN_FAILURE','LOGOUT','SESSION_REVOKED','AUTHORITY_UNAVAILABLE','EOC_AUTHORIZATION_DENIED','STEP_UP_REQUIRED','MODULE_DENIED') OR p_req IS NULL THEN RAISE EXCEPTION 'AUDIT_INVALID' USING ERRCODE='22023'; END IF;
 INSERT INTO eoc_iam.audit_events(event_type,subject_id,session_id,request_id,reason_code) VALUES(p_type,p_subject,p_session,p_req,left(coalesce(p_reason,''),128));
END $$;

DO $$DECLARE p record;BEGIN
 FOR p IN SELECT n.nspname,pr.proname,pg_get_function_identity_arguments(pr.oid) args FROM pg_proc pr JOIN pg_namespace n ON n.oid=pr.pronamespace WHERE n.nspname='eoc_iam' AND pr.proname IN ('create_flow_v12','consume_flow_v12','create_session_and_audit_v12','session_by_hash_v12','touch_session_v12','revoke_session_v12','grants_for_subject_v12','audit_event_v12') LOOP
  EXECUTE format('ALTER FUNCTION %I.%I(%s) OWNER TO eoc_iam_executor',p.nspname,p.proname,p.args);
  EXECUTE format('REVOKE ALL ON FUNCTION %I.%I(%s) FROM PUBLIC',p.nspname,p.proname,p.args);
  EXECUTE format('GRANT EXECUTE ON FUNCTION %I.%I(%s) TO eoc_app_runtime',p.nspname,p.proname,p.args);
 END LOOP;
END $$;
REVOKE CREATE ON SCHEMA eoc_iam FROM eoc_iam_executor;
-- eoc_app_runtime cannot query login flows, sessions, grants or audit tables directly.
COMMIT;
