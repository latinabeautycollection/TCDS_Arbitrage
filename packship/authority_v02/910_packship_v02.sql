-- =====================================================================================================================
-- 910  Pack/Ship Backend Authority V0.2  (TCDS Domain 6)
-- Interface: PACKSHIP_BACKEND_AUTHORITY_V0.2_INTERFACE.md
-- Built against the production catalog of 2026-11-12. Runs inside the caller's transaction (no BEGIN/COMMIT here).
-- Re-runnable: CREATE OR REPLACE / IF NOT EXISTS throughout.
-- =====================================================================================================================

-- ---------------------------------------------------------------------------------------------------------------------
-- 0. Roles (NOLOGIN; the API's login role is granted one of these)
-- ---------------------------------------------------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'tcds_packship_api') THEN
    CREATE ROLE tcds_packship_api NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'tcds_packship_system') THEN
    CREATE ROLE tcds_packship_system NOLOGIN;
  END IF;
END $$;

-- ---------------------------------------------------------------------------------------------------------------------
-- 1. Tables
-- ---------------------------------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS warehouse.packship_settings (
  setting_key   text PRIMARY KEY,
  setting_value jsonb NOT NULL,
  description   text NOT NULL,
  updated_at    timestamptz NOT NULL DEFAULT clock_timestamp()
);
INSERT INTO warehouse.packship_settings (setting_key, setting_value, description) VALUES
  ('claim_lease_seconds',            '900',             'Claim lease; every mutation by the holder extends it'),
  ('required_permission',            '"PACKSHIP_PACK"', 'warehouse_identity.roles.permissions value required for operator functions'),
  ('label_requires_print_job',       'true',            'Label-pair verification requires a PRINTED/VERIFICATION_PENDING/VERIFIED print job'),
  ('manual_weight_requires_override','true',            'Manual weight requires an APPROVED MANUAL_WEIGHT override by another user')
ON CONFLICT (setting_key) DO NOTHING;

-- Idempotency ledger: one row per committed operation (accepted or rejected-with-evidence). Append-only.
CREATE TABLE IF NOT EXISTS warehouse.packship_operations (
  idempotency_key  text PRIMARY KEY,
  operation        text NOT NULL,
  request_sha256   bytea NOT NULL,
  actor_user_id    uuid,
  actor_device_id  uuid,
  auth_session_id  uuid,
  packing_task_id  uuid,
  ok               boolean NOT NULL,
  result_code      text NOT NULL,
  result           jsonb NOT NULL,
  request_id       uuid,
  correlation_id   uuid,
  created_at       timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT packship_operations_key_len CHECK (length(idempotency_key) BETWEEN 8 AND 200)
);
CREATE INDEX IF NOT EXISTS ix_packship_operations_task ON warehouse.packship_operations (packing_task_id, created_at DESC);

-- Physical label pair (tracking scan + package scan) for 6.2E reconstruction. Append-only.
CREATE TABLE IF NOT EXISTS warehouse.packship_label_pairs (
  label_pair_id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_label_pair_id          text,
  shipping_handoff_id           uuid NOT NULL REFERENCES warehouse.shipping_handoffs (shipping_handoff_id),
  packing_task_id               uuid NOT NULL REFERENCES warehouse.packing_tasks (packing_task_id),
  package_id                    uuid NOT NULL REFERENCES warehouse.packages (package_id),
  tracking_scan_event_id        bigint NOT NULL REFERENCES warehouse_telemetry.barcode_scan_events (scan_event_id),
  package_scan_event_id         bigint NOT NULL REFERENCES warehouse_telemetry.barcode_scan_events (scan_event_id),
  result_code                   text NOT NULL,
  print_job_id                  uuid REFERENCES warehouse_control.print_jobs (print_job_id),
  capture_source                text,
  tracking_client_operation_id  text,
  tracking_correlation_id       text,
  package_client_operation_id   text,
  package_correlation_id        text,
  physical_evidence             jsonb,
  verified_by                   uuid NOT NULL,
  device_id                     uuid NOT NULL REFERENCES warehouse.devices (device_id),
  auth_session_id               uuid NOT NULL,
  idempotency_key               text NOT NULL UNIQUE,
  correlation_id                uuid,
  verified_at                   timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX IF NOT EXISTS ix_packship_label_pairs_handoff ON warehouse.packship_label_pairs (shipping_handoff_id, verified_at DESC);

CREATE OR REPLACE TRIGGER trg_packship_operations_append_only BEFORE UPDATE OR DELETE ON warehouse.packship_operations
  FOR EACH ROW EXECUTE FUNCTION warehouse.prevent_update_delete();
CREATE OR REPLACE TRIGGER trg_packship_label_pairs_append_only BEFORE UPDATE OR DELETE ON warehouse.packship_label_pairs
  FOR EACH ROW EXECUTE FUNCTION warehouse.prevent_update_delete();

ALTER TABLE warehouse.packship_settings    ENABLE ROW LEVEL SECURITY;
ALTER TABLE warehouse.packship_operations  ENABLE ROW LEVEL SECURITY;
ALTER TABLE warehouse.packship_label_pairs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON warehouse.packship_settings, warehouse.packship_operations, warehouse.packship_label_pairs
  FROM PUBLIC, anon, authenticated, service_role;

-- Row-version and updated_at triggers (today only items bumps row_version)
CREATE OR REPLACE TRIGGER trg_packing_tasks_bump_row_version BEFORE UPDATE ON warehouse.packing_tasks
  FOR EACH ROW EXECUTE FUNCTION warehouse.bump_row_version();
CREATE OR REPLACE TRIGGER trg_packing_tasks_updated_at BEFORE UPDATE ON warehouse.packing_tasks
  FOR EACH ROW EXECUTE FUNCTION warehouse.set_updated_at();
CREATE OR REPLACE TRIGGER trg_packing_task_items_bump_row_version BEFORE UPDATE ON warehouse.packing_task_items
  FOR EACH ROW EXECUTE FUNCTION warehouse.bump_row_version();
CREATE OR REPLACE TRIGGER trg_packing_task_claims_bump_row_version BEFORE UPDATE ON warehouse.packing_task_claims
  FOR EACH ROW EXECUTE FUNCTION warehouse.bump_row_version();
CREATE OR REPLACE TRIGGER trg_packages_bump_row_version BEFORE UPDATE ON warehouse.packages
  FOR EACH ROW EXECUTE FUNCTION warehouse.bump_row_version();

-- Actor resolved from the session
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_type t JOIN pg_catalog.pg_namespace n ON n.oid = t.typnamespace
                 WHERE n.nspname = 'warehouse' AND t.typname = 'packship_actor_t') THEN
    CREATE TYPE warehouse.packship_actor_t AS (
      auth_session_id   uuid,
      user_id           uuid,
      employee_id       uuid,
      employee_number   text,
      device_id         uuid,
      device_station_id uuid,
      facility_id       uuid,
      device_session_id uuid
    );
  END IF;
END $$;

-- ---------------------------------------------------------------------------------------------------------------------
-- 2. Internal helpers (not granted to anyone)
-- ---------------------------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION warehouse.packship__fail(p_code text, p_detail jsonb DEFAULT '{}'::jsonb)
RETURNS void LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = p_code, DETAIL = coalesce(p_detail, '{}'::jsonb)::text;
END $$;

CREATE OR REPLACE FUNCTION warehouse.packship__setting(p_key text)
RETURNS jsonb LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp AS $$
  SELECT setting_value FROM warehouse.packship_settings WHERE setting_key = p_key
$$;

CREATE OR REPLACE FUNCTION warehouse.packship__uuid(p text)
RETURNS uuid LANGUAGE plpgsql IMMUTABLE SET search_path = pg_catalog, pg_temp AS $$
BEGIN RETURN p::uuid; EXCEPTION WHEN others THEN RETURN NULL; END $$;

-- Normalized barcode as plain upper-case text. Same rule as warehouse_control.normalize_barcode (trim, drop spaces
-- and dashes, upper-case), re-implemented because that function casts to citext and has no search_path of its own,
-- so it fails when called from a function pinned to pg_catalog.
CREATE OR REPLACE FUNCTION warehouse.packship__n(p text)
RETURNS text LANGUAGE sql IMMUTABLE STRICT SET search_path = pg_catalog, pg_temp AS $$
  SELECT upper(regexp_replace(btrim(p), '[[:space:]-]+', '', 'g'))
$$;

CREATE OR REPLACE FUNCTION warehouse.packship__input_barcode(p_raw text)
RETURNS text LANGUAGE plpgsql IMMUTABLE SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  IF p_raw IS NULL OR btrim(p_raw) = '' OR length(p_raw) > 256 OR warehouse.packship__n(p_raw) = '' THEN
    PERFORM warehouse.packship__fail('PACKSHIP_INPUT_INVALID', '{"field":"barcode"}');
  END IF;
  RETURN warehouse.packship__n(p_raw);
END $$;

CREATE OR REPLACE FUNCTION warehouse.packship__check_capture(p_capture jsonb)
RETURNS jsonb LANGUAGE plpgsql IMMUTABLE SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  IF p_capture IS NULL THEN RETURN '{}'::jsonb; END IF;
  IF jsonb_typeof(p_capture) <> 'object'
     OR (p_capture ? 'source' AND coalesce(p_capture->>'source', '') NOT IN ('CAMERA', 'MANUAL', 'HID')) THEN
    PERFORM warehouse.packship__fail('PACKSHIP_INPUT_INVALID', '{"field":"capture"}');
  END IF;
  RETURN p_capture;
END $$;

CREATE OR REPLACE FUNCTION warehouse.packship__hash(p_operation text, p_inputs jsonb)
RETURNS bytea LANGUAGE sql IMMUTABLE SET search_path = pg_catalog, pg_temp AS $$
  SELECT sha256(convert_to(p_operation || '|' || coalesce(p_inputs, 'null'::jsonb)::text, 'UTF8'))
$$;

-- Validates the key, serializes same-key callers, returns the stored result for a true replay, refuses misuse.
CREATE OR REPLACE FUNCTION warehouse.packship__idem_lookup(p_operation text, p_key text, p_hash bytea, p_actor_user uuid)
RETURNS jsonb LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
DECLARE o warehouse.packship_operations%ROWTYPE;
BEGIN
  IF p_key IS NULL OR length(p_key) < 8 OR length(p_key) > 200 THEN
    PERFORM warehouse.packship__fail('PACKSHIP_IDEMPOTENCY_KEY_INVALID');
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('packship:' || p_key, 0));
  SELECT * INTO o FROM warehouse.packship_operations WHERE idempotency_key = p_key;
  IF NOT FOUND THEN RETURN NULL; END IF;
  IF o.operation <> p_operation OR o.request_sha256 <> p_hash OR o.actor_user_id IS DISTINCT FROM p_actor_user THEN
    PERFORM warehouse.packship__fail('PACKSHIP_IDEMPOTENCY_KEY_REUSED', jsonb_build_object('operation', o.operation));
  END IF;
  RETURN o.result || jsonb_build_object('replayed', true);
END $$;

CREATE OR REPLACE FUNCTION warehouse.packship__idem_store(p_operation text, p_key text, p_hash bytea,
  p_actor warehouse.packship_actor_t, p_task_id uuid, p_result jsonb, p_request_id uuid, p_correlation_id uuid)
RETURNS jsonb LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  INSERT INTO warehouse.packship_operations (idempotency_key, operation, request_sha256, actor_user_id, actor_device_id,
    auth_session_id, packing_task_id, ok, result_code, result, request_id, correlation_id)
  VALUES (p_key, p_operation, p_hash, p_actor.user_id, p_actor.device_id, p_actor.auth_session_id, p_task_id,
    coalesce((p_result->>'ok')::boolean, false), coalesce(p_result->>'code', 'OK'), p_result, p_request_id, p_correlation_id);
  RETURN p_result;
END $$;

-- Session → actor. Fails closed on any inconsistency.
CREATE OR REPLACE FUNCTION warehouse.packship__actor(p_auth_session_id uuid)
RETURNS warehouse.packship_actor_t LANGUAGE plpgsql STABLE SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a warehouse.packship_actor_t;
  s warehouse_identity.auth_sessions%ROWTYPE;
  v_now timestamptz := clock_timestamp();
  v_perm text;
BEGIN
  IF p_auth_session_id IS NULL THEN
    PERFORM warehouse.packship__fail('PACKSHIP_SESSION_INVALID', '{"reason":"MISSING"}');
  END IF;
  SELECT * INTO s FROM warehouse_identity.auth_sessions WHERE auth_session_id = p_auth_session_id;
  IF NOT FOUND OR s.revoked_at IS NOT NULL OR s.idle_expires_at <= v_now OR s.absolute_expires_at <= v_now
     OR s.restricted_session THEN
    PERFORM warehouse.packship__fail('PACKSHIP_SESSION_INVALID', '{"reason":"NOT_ACTIVE"}');
  END IF;

  PERFORM 1 FROM warehouse_identity.users u
   WHERE u.user_id = s.user_id AND u.status = 'ACTIVE' AND u.archived_at IS NULL
     AND (u.locked_until IS NULL OR u.locked_until <= v_now);
  IF NOT FOUND THEN PERFORM warehouse.packship__fail('PACKSHIP_ACTOR_NOT_ALLOWED', '{"reason":"USER"}'); END IF;

  SELECT e.employee_number, e.facility_id INTO a.employee_number, a.facility_id
    FROM warehouse_identity.employees e
   WHERE e.employee_id = s.employee_id AND e.user_id = s.user_id AND e.employment_status = 'ACTIVE';
  IF NOT FOUND THEN PERFORM warehouse.packship__fail('PACKSHIP_ACTOR_NOT_ALLOWED', '{"reason":"EMPLOYEE"}'); END IF;

  SELECT d.station_id INTO a.device_station_id
    FROM warehouse.devices d
   WHERE d.device_id = s.device_id AND d.status::text = 'ACTIVE' AND d.retired_at IS NULL
     AND d.facility_id = a.facility_id;
  IF NOT FOUND THEN PERFORM warehouse.packship__fail('PACKSHIP_ACTOR_NOT_ALLOWED', '{"reason":"DEVICE"}'); END IF;

  v_perm := warehouse.packship__setting('required_permission') #>> '{}';
  IF v_perm IS NULL OR NOT EXISTS (
       SELECT 1 FROM warehouse_identity.user_role_assignments ura
       JOIN warehouse_identity.roles r ON r.role_id = ura.role_id
      WHERE ura.user_id = s.user_id AND ura.revoked_at IS NULL
        AND ura.valid_from <= v_now AND (ura.valid_until IS NULL OR ura.valid_until > v_now)
        AND (ura.facility_id IS NULL OR ura.facility_id = a.facility_id)
        AND (ura.station_id IS NULL OR ura.station_id = a.device_station_id)
        AND r.active AND v_perm = ANY (r.permissions)) THEN
    PERFORM warehouse.packship__fail('PACKSHIP_ACTOR_NOT_ALLOWED', '{"reason":"PERMISSION"}');
  END IF;

  a.auth_session_id   := s.auth_session_id;
  a.user_id           := s.user_id;
  a.employee_id       := s.employee_id;
  a.device_id         := s.device_id;
  a.device_session_id := s.warehouse_device_session_id;
  RETURN a;
END $$;

-- Locks the task and checks facility, station and terminal status.
CREATE OR REPLACE FUNCTION warehouse.packship__lock_task(p_task_id uuid, p_actor warehouse.packship_actor_t)
RETURNS warehouse.packing_tasks LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
DECLARE t warehouse.packing_tasks%ROWTYPE;
BEGIN
  SELECT * INTO t FROM warehouse.packing_tasks WHERE packing_task_id = p_task_id FOR UPDATE;
  IF NOT FOUND THEN PERFORM warehouse.packship__fail('PACKSHIP_TASK_NOT_FOUND'); END IF;
  IF t.facility_id <> p_actor.facility_id THEN PERFORM warehouse.packship__fail('PACKSHIP_FACILITY_MISMATCH'); END IF;
  IF t.assigned_station_id IS NOT NULL AND t.assigned_station_id IS DISTINCT FROM p_actor.device_station_id THEN
    PERFORM warehouse.packship__fail('PACKSHIP_STATION_MISMATCH');
  END IF;
  IF t.status IN ('CANCELLED', 'ABANDONED', 'EXCEPTION', 'HANDED_TO_CARRIER') THEN
    PERFORM warehouse.packship__fail('PACKSHIP_INVALID_STATUS', jsonb_build_object('status', t.status));
  END IF;
  RETURN t;
END $$;

CREATE OR REPLACE FUNCTION warehouse.packship__require_status(p_task warehouse.packing_tasks, p_allowed text[])
RETURNS void LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  IF NOT (p_task.status = ANY (p_allowed)) THEN
    PERFORM warehouse.packship__fail('PACKSHIP_INVALID_STATUS',
      jsonb_build_object('status', p_task.status, 'expected', to_jsonb(p_allowed)));
  END IF;
END $$;

CREATE OR REPLACE FUNCTION warehouse.packship__check_rv(p_current bigint, p_expected bigint, p_entity text DEFAULT 'task')
RETURNS void LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  IF p_expected IS NULL OR p_current <> p_expected THEN
    PERFORM warehouse.packship__fail('PACKSHIP_ROW_VERSION_CONFLICT',
      jsonb_build_object('entity', p_entity, 'currentRowVersion', p_current, 'expectedRowVersion', p_expected));
  END IF;
END $$;

-- The caller must hold the active claim (same employee and device). Extends the lease.
CREATE OR REPLACE FUNCTION warehouse.packship__require_claim(p_task_id uuid, p_actor warehouse.packship_actor_t)
RETURNS uuid LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
DECLARE c warehouse.packing_task_claims%ROWTYPE; v_now timestamptz := clock_timestamp();
BEGIN
  SELECT * INTO c FROM warehouse.packing_task_claims
   WHERE packing_task_id = p_task_id AND released_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN PERFORM warehouse.packship__fail('PACKSHIP_CLAIM_REQUIRED', '{"reason":"NO_ACTIVE_CLAIM"}'); END IF;
  IF c.employee_id = p_actor.employee_id AND c.device_id = p_actor.device_id THEN
    UPDATE warehouse.packing_task_claims
       SET heartbeat_at = v_now,
           expires_at = v_now + make_interval(secs => (warehouse.packship__setting('claim_lease_seconds') #>> '{}')::int)
     WHERE packing_task_claim_id = c.packing_task_claim_id;
    RETURN c.packing_task_claim_id;
  ELSIF c.expires_at > v_now THEN
    PERFORM warehouse.packship__fail('PACKSHIP_TASK_CLAIMED_BY_OTHER', jsonb_build_object('expiresAt', c.expires_at));
  END IF;
  PERFORM warehouse.packship__fail('PACKSHIP_CLAIM_REQUIRED', '{"reason":"CLAIM_EXPIRED_HELD_BY_OTHER"}');
  RETURN NULL;
END $$;

-- Durable scan evidence (warehouse_telemetry.barcode_scan_events is append-only).
-- barcode_scan_events.task_id references work_tasks, so the packing task id goes in context.
CREATE OR REPLACE FUNCTION warehouse.packship__record_scan(p_actor warehouse.packship_actor_t, p_task_id uuid,
  p_scan_kind text, p_raw text, p_capture jsonb, p_result text, p_expected_type text, p_expected_id uuid,
  p_resolved_type text, p_resolved_id uuid, p_key text, p_error_code text)
RETURNS bigint LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
DECLARE v_sym text; v_ts timestamptz; v_id bigint;
BEGIN
  SELECT s.symbology_code::text INTO v_sym FROM warehouse_control.barcode_symbologies s
   WHERE upper(s.symbology_code::text) = upper(coalesce(p_capture->>'symbology', ''));
  BEGIN v_ts := (p_capture->>'capturedAt')::timestamptz; EXCEPTION WHEN others THEN v_ts := NULL; END;
  INSERT INTO warehouse_telemetry.barcode_scan_events (facility_id, station_id, device_session_id, operator_user_id,
    employee_number, symbology_code, raw_value, normalized_value, scan_result, expected_entity_type, expected_entity_id,
    resolved_entity_type, resolved_entity_id, client_occurred_at, idempotency_key, error_code, context)
  VALUES (p_actor.facility_id, p_actor.device_station_id, p_actor.device_session_id, p_actor.user_id,
    p_actor.employee_number, v_sym, p_raw, warehouse.packship__n(p_raw),
    p_result::warehouse_control.scan_result, p_expected_type, p_expected_id, p_resolved_type, p_resolved_id, v_ts,
    'packship:' || p_key || ':' || p_scan_kind, p_error_code,
    jsonb_build_object('packingTaskId', p_task_id, 'scanKind', p_scan_kind, 'capture', coalesce(p_capture, '{}'::jsonb),
                       'authSessionId', p_actor.auth_session_id, 'deviceId', p_actor.device_id, 'authority', 'packship_v0.2'))
  RETURNING scan_event_id INTO v_id;
  RETURN v_id;
END $$;

CREATE OR REPLACE FUNCTION warehouse.packship__current_package(p_task_id uuid)
RETURNS warehouse.packages LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp AS $$
  SELECT p.* FROM warehouse.packing_task_packages ptp
  JOIN warehouse.packages p ON p.package_id = ptp.package_id
  WHERE ptp.packing_task_id = p_task_id AND ptp.relationship_type = 'CREATED' AND p.status <> 'VOIDED'
  ORDER BY ptp.linked_at DESC LIMIT 1
$$;

CREATE OR REPLACE FUNCTION warehouse.packship__blockers(p_task_id uuid)
RETURNS text[] LANGUAGE plpgsql STABLE SET search_path = pg_catalog, pg_temp AS $$
DECLARE b text[] := ARRAY[]::text[]; t warehouse.packing_tasks%ROWTYPE; p warehouse.packages%ROWTYPE;
BEGIN
  SELECT * INTO t FROM warehouse.packing_tasks WHERE packing_task_id = p_task_id;
  IF NOT FOUND THEN RETURN b; END IF;
  IF NOT (t.context ? 'sourceVerification') THEN b := array_append(b, 'SOURCE_UNVERIFIED'); END IF;
  IF EXISTS (SELECT 1 FROM warehouse.packing_task_items i WHERE i.packing_task_id = p_task_id
              AND i.status NOT IN ('VERIFIED', 'PACKED', 'REMOVED', 'CANCELLED')) THEN
    b := array_append(b, 'ITEMS_UNVERIFIED');
  END IF;
  p := warehouse.packship__current_package(p_task_id);
  IF p.package_id IS NULL THEN b := array_append(b, 'PACKAGE_MISSING');
  ELSE
    IF p.actual_weight_oz IS NULL THEN b := array_append(b, 'WEIGHT_MISSING'); END IF;
    IF p.length_in IS NULL THEN b := array_append(b, 'DIMENSIONS_MISSING'); END IF;
  END IF;
  IF EXISTS (SELECT 1 FROM warehouse.packing_evidence_requirements r
              WHERE r.packing_task_id = p_task_id AND r.blocking AND r.status <> 'VOIDED'
                AND NOT (r.status = 'OVERRIDDEN' OR r.override_id IS NOT NULL
                         OR (r.status = 'ACCEPTED' AND r.accepted_count >= r.required_count
                             AND r.sha256_verified AND r.chain_verified))) THEN
    b := array_append(b, 'EVIDENCE_PENDING');
  END IF;
  IF EXISTS (SELECT 1 FROM warehouse.packing_exceptions x
              WHERE x.packing_task_id = p_task_id AND x.blocking
                AND x.status IN ('OPEN', 'INVESTIGATING', 'CONTAINED', 'REVIEW_REQUIRED')) THEN
    b := array_append(b, 'EXCEPTION_OPEN');
  END IF;
  IF EXISTS (SELECT 1 FROM warehouse.packing_task_items i JOIN warehouse.items it ON it.item_id = i.item_id
              WHERE i.packing_task_id = p_task_id AND i.status NOT IN ('REMOVED', 'CANCELLED')
                AND (it.archived_at IS NOT NULL OR it.status::text IN ('EXPECTED', 'RECEIVING', 'QA_HOLD', 'QUARANTINED',
                     'CLAIM_HOLD', 'DAMAGED', 'LOST', 'DISPOSED', 'ARCHIVED', 'SHIPPED', 'RETURN_IN_TRANSIT', 'RETURN_RECEIVED'))) THEN
    b := array_append(b, 'ITEM_NOT_PACKABLE');
  END IF;
  IF EXISTS (SELECT 1 FROM warehouse.packing_task_items i JOIN warehouse.item_holds h ON h.item_id = i.item_id
              WHERE i.packing_task_id = p_task_id AND h.released_at IS NULL) THEN
    b := array_append(b, 'ITEM_ON_HOLD');
  END IF;
  RETURN b;
END $$;

CREATE OR REPLACE FUNCTION warehouse.packship__snapshot(p_task_id uuid, p_actor warehouse.packship_actor_t)
RETURNS jsonb LANGUAGE plpgsql STABLE SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  t warehouse.packing_tasks%ROWTYPE; c warehouse.packing_task_claims%ROWTYPE;
  p warehouse.packages%ROWTYPE; h warehouse.shipping_handoffs%ROWTYPE;
  v_items jsonb; v_now timestamptz := clock_timestamp();
BEGIN
  SELECT * INTO t FROM warehouse.packing_tasks WHERE packing_task_id = p_task_id;
  IF NOT FOUND THEN RETURN NULL; END IF;
  SELECT * INTO c FROM warehouse.packing_task_claims WHERE packing_task_id = p_task_id AND released_at IS NULL;
  p := warehouse.packship__current_package(p_task_id);
  IF p.package_id IS NOT NULL THEN SELECT * INTO h FROM warehouse.shipping_handoffs WHERE package_id = p.package_id; END IF;
  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'packingTaskItemId', i.packing_task_item_id, 'itemId', i.item_id, 'expectedBarcode', i.expected_item_barcode,
           'expectedQuantity', i.expected_quantity, 'verifiedQuantity', i.verified_quantity, 'status', i.status,
           'rowVersion', i.row_version) ORDER BY i.packing_task_item_id), '[]'::jsonb)
    INTO v_items FROM warehouse.packing_task_items i WHERE i.packing_task_id = p_task_id;
  RETURN jsonb_build_object(
    'packingTaskId', t.packing_task_id, 'taskNumber', t.task_number, 'status', t.status, 'rowVersion', t.row_version,
    'facilityId', t.facility_id, 'assignedStationId', t.assigned_station_id, 'fulfillmentOrderId', t.fulfillment_order_id,
    'claim', CASE WHEN c.packing_task_claim_id IS NULL THEN NULL ELSE jsonb_build_object(
        'heldBySession', coalesce(c.employee_id = p_actor.employee_id AND c.device_id = p_actor.device_id
                                  AND c.expires_at > v_now, false),
        'employeeId', c.employee_id, 'deviceId', c.device_id, 'expiresAt', c.expires_at,
        'expired', c.expires_at <= v_now) END,
    'sourceVerified', t.context ? 'sourceVerification',
    'items', v_items,
    'package', CASE WHEN p.package_id IS NULL THEN NULL ELSE jsonb_build_object(
        'packageId', p.package_id, 'packageNumber', p.package_number::text, 'status', p.status, 'rowVersion', p.row_version,
        'weightOz', p.actual_weight_oz, 'lengthIn', p.length_in, 'widthIn', p.width_in, 'heightIn', p.height_in) END,
    'shipment', CASE WHEN h.shipping_handoff_id IS NULL THEN NULL ELSE jsonb_build_object(
        'shipmentId', h.shipment_id, 'shippingHandoffId', h.shipping_handoff_id, 'carrierCode', h.carrier_code,
        'status', h.status, 'trackingPresent', h.tracking_number IS NOT NULL) END,
    'blockers', to_jsonb(warehouse.packship__blockers(p_task_id)));
END $$;

CREATE OR REPLACE FUNCTION warehouse.packship__result(p_ok boolean, p_code text, p_task_id uuid,
  p_actor warehouse.packship_actor_t, p_extra jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp AS $$
  SELECT jsonb_build_object('ok', p_ok, 'code', p_code, 'replayed', false,
                            'task', warehouse.packship__snapshot(p_task_id, p_actor)) || coalesce(p_extra, '{}'::jsonb)
$$;

-- Resolves the handoff from shipment_id and the task holding that package as PACKED; locks both.
CREATE OR REPLACE FUNCTION warehouse.packship__shipment_task(p_shipment_id uuid, p_actor warehouse.packship_actor_t,
  OUT o_handoff warehouse.shipping_handoffs, OUT o_task warehouse.packing_tasks)
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
DECLARE n int; v_task uuid;
BEGIN
  SELECT count(*) INTO n FROM warehouse.shipping_handoffs WHERE shipment_id = p_shipment_id;
  IF n = 0 THEN PERFORM warehouse.packship__fail('PACKSHIP_SHIPMENT_NOT_FOUND'); END IF;
  IF n > 1 THEN PERFORM warehouse.packship__fail('PACKSHIP_SHIPMENT_AMBIGUOUS'); END IF;
  SELECT * INTO o_handoff FROM warehouse.shipping_handoffs WHERE shipment_id = p_shipment_id FOR UPDATE;
  SELECT ptp.packing_task_id INTO v_task FROM warehouse.packing_task_packages ptp
    JOIN warehouse.packing_tasks pt ON pt.packing_task_id = ptp.packing_task_id
   WHERE ptp.package_id = o_handoff.package_id AND ptp.relationship_type = 'PACKED'
     AND pt.status NOT IN ('CANCELLED', 'ABANDONED')
   ORDER BY ptp.linked_at DESC LIMIT 1;
  IF v_task IS NULL THEN
    PERFORM warehouse.packship__fail('PACKSHIP_PRECONDITION_FAILED', '{"blockers":["PACKAGE_NOT_PACKED"]}');
  END IF;
  o_task := warehouse.packship__lock_task(v_task, p_actor);
END $$;

-- ---------------------------------------------------------------------------------------------------------------------
-- 3. Public functions
-- ---------------------------------------------------------------------------------------------------------------------

-- 1. Create task (system caller, after picking)
CREATE OR REPLACE FUNCTION warehouse.packship_create_task_v2(
  p_fulfillment_order_id uuid, p_source_pick_task_id uuid, p_assigned_station_id uuid, p_priority smallint,
  p_carrier_cutoff_at timestamptz, p_idempotency_key text, p_request_id uuid, p_correlation_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  v_hash bytea; v_replay jsonb; o warehouse.fulfillment_orders%ROWTYPE; v_existing uuid;
  v_lines int; v_with_item int; v_distinct int; v_bad int; v_task uuid := gen_random_uuid(); v_number text;
  v_result jsonb; v_none warehouse.packship_actor_t;
BEGIN
  v_hash := warehouse.packship__hash('CREATE_TASK', jsonb_build_object('order', p_fulfillment_order_id,
    'pick', p_source_pick_task_id, 'station', p_assigned_station_id, 'priority', p_priority, 'cutoff', p_carrier_cutoff_at));
  v_replay := warehouse.packship__idem_lookup('CREATE_TASK', p_idempotency_key, v_hash, NULL);
  IF v_replay IS NOT NULL THEN RETURN v_replay; END IF;

  SELECT * INTO o FROM warehouse.fulfillment_orders WHERE fulfillment_order_id = p_fulfillment_order_id FOR UPDATE;
  IF NOT FOUND THEN PERFORM warehouse.packship__fail('PACKSHIP_ORDER_NOT_FOUND'); END IF;
  IF upper(o.order_status) IN ('CANCELLED', 'CANCELED', 'SHIPPED', 'DELIVERED', 'CLOSED', 'REFUNDED') THEN
    PERFORM warehouse.packship__fail('PACKSHIP_PRECONDITION_FAILED', '{"blockers":["ORDER_NOT_PACKABLE"]}');
  END IF;
  SELECT packing_task_id INTO v_existing FROM warehouse.packing_tasks
   WHERE fulfillment_order_id = o.fulfillment_order_id AND status NOT IN ('HANDED_TO_CARRIER', 'CANCELLED', 'ABANDONED');
  IF v_existing IS NOT NULL THEN
    PERFORM warehouse.packship__fail('PACKSHIP_ACTIVE_TASK_EXISTS', jsonb_build_object('packingTaskId', v_existing));
  END IF;
  IF p_assigned_station_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM warehouse.stations s
       WHERE s.station_id = p_assigned_station_id AND s.facility_id = o.facility_id AND s.is_active) THEN
    PERFORM warehouse.packship__fail('PACKSHIP_PRECONDITION_FAILED', '{"blockers":["STATION_INVALID"]}');
  END IF;

  SELECT count(*), count(item_id), count(DISTINCT item_id) INTO v_lines, v_with_item, v_distinct
    FROM warehouse.fulfillment_order_lines WHERE fulfillment_order_id = o.fulfillment_order_id;
  IF v_lines = 0 THEN PERFORM warehouse.packship__fail('PACKSHIP_PRECONDITION_FAILED', '{"blockers":["ORDER_HAS_NO_LINES"]}'); END IF;
  IF v_with_item < v_lines THEN PERFORM warehouse.packship__fail('PACKSHIP_PRECONDITION_FAILED', '{"blockers":["LINE_ITEM_MISSING"]}'); END IF;
  IF v_distinct < v_with_item THEN PERFORM warehouse.packship__fail('PACKSHIP_PRECONDITION_FAILED', '{"blockers":["DUPLICATE_ITEM_LINES"]}'); END IF;
  SELECT count(*) INTO v_bad FROM warehouse.fulfillment_order_lines l JOIN warehouse.items i ON i.item_id = l.item_id
   WHERE l.fulfillment_order_id = o.fulfillment_order_id
     AND (i.facility_id <> o.facility_id OR i.archived_at IS NOT NULL
          OR i.status::text IN ('EXPECTED', 'RECEIVING', 'QA_HOLD', 'QUARANTINED', 'CLAIM_HOLD', 'DAMAGED', 'LOST',
                                'DISPOSED', 'ARCHIVED', 'SHIPPED', 'RETURN_IN_TRANSIT', 'RETURN_RECEIVED', 'PACKED')
          OR EXISTS (SELECT 1 FROM warehouse.item_holds h WHERE h.item_id = i.item_id AND h.released_at IS NULL));
  IF v_bad > 0 THEN PERFORM warehouse.packship__fail('PACKSHIP_PRECONDITION_FAILED', '{"blockers":["ITEM_NOT_PACKABLE"]}'); END IF;

  v_number := 'PK-' || to_char(clock_timestamp() AT TIME ZONE 'UTC', 'YYMMDD') || '-'
              || upper(substr(replace(v_task::text, '-', ''), 1, 10));
  INSERT INTO warehouse.packing_tasks (packing_task_id, facility_id, fulfillment_order_id, source_pick_task_id,
    assigned_station_id, task_number, status, priority, carrier_cutoff_at, idempotency_key, correlation_id, context)
  VALUES (v_task, o.facility_id, o.fulfillment_order_id, p_source_pick_task_id, p_assigned_station_id, v_number, 'READY',
    coalesce(p_priority, o.priority), p_carrier_cutoff_at, p_idempotency_key, coalesce(p_correlation_id, gen_random_uuid()),
    jsonb_build_object('createdBy', 'SYSTEM', 'requestId', p_request_id, 'authority', 'packship_v0.2'));
  INSERT INTO warehouse.packing_task_items (packing_task_id, fulfillment_order_line_id, item_id, expected_quantity,
    expected_item_barcode)
  SELECT v_task, l.fulfillment_order_line_id, l.item_id, l.quantity_ordered, i.internal_barcode::text
    FROM warehouse.fulfillment_order_lines l JOIN warehouse.items i ON i.item_id = l.item_id
   WHERE l.fulfillment_order_id = o.fulfillment_order_id;
  INSERT INTO warehouse_control.barcodes (symbology_code, raw_value, normalized_value, status, entity_type, entity_id,
    namespace, source, activated_at, metadata)
  VALUES ('CODE128', v_number, warehouse.packship__n(v_number), 'ACTIVE', 'PACKING_TASK', v_task, 'TCDS',
    'GENERATED', clock_timestamp(), '{"authority":"packship_v0.2"}');

  v_result := warehouse.packship__result(true, 'OK', v_task, v_none);
  RETURN warehouse.packship__idem_store('CREATE_TASK', p_idempotency_key, v_hash, v_none, v_task, v_result,
    p_request_id, p_correlation_id);
END $$;

-- 2. Claim (or take over an expired claim, or refresh your own)
CREATE OR REPLACE FUNCTION warehouse.packship_claim_task_v2(p_auth_session_id uuid, p_packing_task_id uuid,
  p_idempotency_key text, p_request_id uuid, p_correlation_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a warehouse.packship_actor_t; v_hash bytea; v_replay jsonb; t warehouse.packing_tasks%ROWTYPE;
  c warehouse.packing_task_claims%ROWTYPE; v_now timestamptz := clock_timestamp(); v_exp timestamptz;
  v_takeover boolean := false; v_new boolean := true; v_token bytea; v_result jsonb;
BEGIN
  a := warehouse.packship__actor(p_auth_session_id);
  v_hash := warehouse.packship__hash('CLAIM_TASK', jsonb_build_object('task', p_packing_task_id));
  v_replay := warehouse.packship__idem_lookup('CLAIM_TASK', p_idempotency_key, v_hash, a.user_id);
  IF v_replay IS NOT NULL THEN RETURN v_replay; END IF;

  t := warehouse.packship__lock_task(p_packing_task_id, a);
  PERFORM warehouse.packship__require_status(t, ARRAY['READY', 'CLAIMED', 'CONTENTS_VERIFYING', 'PACKING', 'MEASURING',
    'EVIDENCE_PENDING', 'PACKED', 'SHIPPING_REVIEW', 'LABEL_PENDING', 'LABEL_PURCHASED', 'PRINTING', 'LABEL_VERIFIED']);
  v_exp := v_now + make_interval(secs => (warehouse.packship__setting('claim_lease_seconds') #>> '{}')::int);

  SELECT * INTO c FROM warehouse.packing_task_claims
   WHERE packing_task_id = t.packing_task_id AND released_at IS NULL FOR UPDATE;
  IF FOUND THEN
    IF c.employee_id = a.employee_id AND c.device_id = a.device_id THEN
      UPDATE warehouse.packing_task_claims SET heartbeat_at = v_now, expires_at = v_exp
       WHERE packing_task_claim_id = c.packing_task_claim_id;
      v_new := false;
    ELSIF c.expires_at > v_now THEN
      PERFORM warehouse.packship__fail('PACKSHIP_TASK_CLAIMED_BY_OTHER', jsonb_build_object('expiresAt', c.expires_at));
    ELSE
      UPDATE warehouse.packing_task_claims
         SET released_at = v_now, release_reason = 'CLAIM_EXPIRED_TAKEOVER', takeover_status = 'COMPLETED'
       WHERE packing_task_claim_id = c.packing_task_claim_id;
      v_takeover := true;
    END IF;
  END IF;

  IF v_new THEN
    v_token := sha256(convert_to(gen_random_uuid()::text || clock_timestamp()::text || gen_random_uuid()::text, 'UTF8'));
    INSERT INTO warehouse.packing_task_claims (packing_task_id, employee_id, device_id, claim_token_hash, claimed_at,
      heartbeat_at, expires_at, takeover_status)
    VALUES (t.packing_task_id, a.employee_id, a.device_id, v_token, v_now, v_now, v_exp,
      CASE WHEN v_takeover THEN 'COMPLETED' ELSE 'NONE' END);
    UPDATE warehouse.packing_tasks
       SET status = CASE WHEN status = 'READY' THEN 'CLAIMED' ELSE status END,
           claimed_by_user_id = a.user_id, claimed_device_id = a.device_id, claim_token_hash = v_token,
           claimed_at = v_now, claim_heartbeat_at = v_now, claim_expires_at = v_exp, released_at = NULL,
           release_reason = NULL, takeover_status = CASE WHEN v_takeover THEN 'COMPLETED' ELSE 'NONE' END,
           takeover_approved_by = NULL, started_at = coalesce(started_at, v_now)
     WHERE packing_task_id = t.packing_task_id;
  ELSE
    UPDATE warehouse.packing_tasks SET claim_heartbeat_at = v_now, claim_expires_at = v_exp
     WHERE packing_task_id = t.packing_task_id;
  END IF;

  v_result := warehouse.packship__result(true, 'OK', t.packing_task_id, a, jsonb_build_object('takeover', v_takeover));
  RETURN warehouse.packship__idem_store('CLAIM_TASK', p_idempotency_key, v_hash, a, t.packing_task_id, v_result,
    p_request_id, p_correlation_id);
END $$;

-- 3. Release your own claim
CREATE OR REPLACE FUNCTION warehouse.packship_release_task_v2(p_auth_session_id uuid, p_packing_task_id uuid,
  p_expected_row_version bigint, p_reason text, p_idempotency_key text, p_request_id uuid, p_correlation_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a warehouse.packship_actor_t; v_hash bytea; v_replay jsonb; t warehouse.packing_tasks%ROWTYPE; v_claim uuid;
  v_now timestamptz := clock_timestamp(); v_result jsonb; v_reason text := left(coalesce(nullif(btrim(p_reason), ''), 'RELEASED'), 200);
BEGIN
  a := warehouse.packship__actor(p_auth_session_id);
  v_hash := warehouse.packship__hash('RELEASE_TASK', jsonb_build_object('task', p_packing_task_id,
    'rv', p_expected_row_version, 'reason', v_reason));
  v_replay := warehouse.packship__idem_lookup('RELEASE_TASK', p_idempotency_key, v_hash, a.user_id);
  IF v_replay IS NOT NULL THEN RETURN v_replay; END IF;

  t := warehouse.packship__lock_task(p_packing_task_id, a);
  PERFORM warehouse.packship__check_rv(t.row_version, p_expected_row_version);
  v_claim := warehouse.packship__require_claim(t.packing_task_id, a);
  UPDATE warehouse.packing_task_claims SET released_at = v_now, release_reason = v_reason
   WHERE packing_task_claim_id = v_claim;
  UPDATE warehouse.packing_tasks
     SET status = CASE WHEN status = 'CLAIMED' THEN 'READY' ELSE status END,
         claimed_by_user_id = NULL, claimed_device_id = NULL, claim_token_hash = NULL, claimed_at = NULL,
         claim_heartbeat_at = NULL, claim_expires_at = NULL, released_at = v_now, release_reason = v_reason
   WHERE packing_task_id = t.packing_task_id;

  v_result := warehouse.packship__result(true, 'OK', t.packing_task_id, a);
  RETURN warehouse.packship__idem_store('RELEASE_TASK', p_idempotency_key, v_hash, a, t.packing_task_id, v_result,
    p_request_id, p_correlation_id);
END $$;

-- 4. Verify the pack source
CREATE OR REPLACE FUNCTION warehouse.packship_verify_source_v2(p_auth_session_id uuid, p_packing_task_id uuid,
  p_expected_row_version bigint, p_raw_barcode text, p_capture jsonb, p_idempotency_key text, p_request_id uuid,
  p_correlation_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a warehouse.packship_actor_t; v_hash bytea; v_replay jsonb; t warehouse.packing_tasks%ROWTYPE; v_n text;
  v_capture jsonb; v_kind text; v_resolved uuid; v_loc uuid; v_scan bigint; v_result jsonb; v_known boolean;
BEGIN
  a := warehouse.packship__actor(p_auth_session_id);
  v_n := warehouse.packship__input_barcode(p_raw_barcode);
  v_capture := warehouse.packship__check_capture(p_capture);
  v_hash := warehouse.packship__hash('VERIFY_SOURCE', jsonb_build_object('task', p_packing_task_id,
    'rv', p_expected_row_version, 'barcode', p_raw_barcode, 'capture', v_capture));
  v_replay := warehouse.packship__idem_lookup('VERIFY_SOURCE', p_idempotency_key, v_hash, a.user_id);
  IF v_replay IS NOT NULL THEN RETURN v_replay; END IF;

  t := warehouse.packship__lock_task(p_packing_task_id, a);
  PERFORM warehouse.packship__require_status(t, ARRAY['CLAIMED', 'CONTENTS_VERIFYING']);
  PERFORM warehouse.packship__check_rv(t.row_version, p_expected_row_version);
  PERFORM warehouse.packship__require_claim(t.packing_task_id, a);

  -- (a) the task's own TCDS label
  IF v_n = warehouse.packship__n(t.task_number) OR EXISTS (SELECT 1 FROM warehouse_control.barcodes b
       WHERE b.entity_type = 'PACKING_TASK' AND b.entity_id = t.packing_task_id AND b.status = 'ACTIVE'
         AND warehouse.packship__n(b.normalized_value::text) = v_n) THEN
    v_kind := 'PACKING_TASK'; v_resolved := t.packing_task_id;
  ELSE
    -- (b) the location currently holding every item of the task
    SELECT l.location_id INTO v_loc FROM warehouse.locations l
     WHERE warehouse.packship__n(l.barcode_value::text) = v_n AND l.facility_id = t.facility_id
       AND l.is_active AND l.archived_at IS NULL;
    IF v_loc IS NOT NULL AND EXISTS (SELECT 1 FROM warehouse.packing_task_items i WHERE i.packing_task_id = t.packing_task_id)
       AND NOT EXISTS (SELECT 1 FROM warehouse.packing_task_items i JOIN warehouse.items it ON it.item_id = i.item_id
                        WHERE i.packing_task_id = t.packing_task_id AND i.status NOT IN ('REMOVED', 'CANCELLED')
                          AND it.current_location_id IS DISTINCT FROM v_loc) THEN
      v_kind := 'LOCATION'; v_resolved := v_loc;
    END IF;
  END IF;

  IF v_kind IS NOT NULL THEN
    v_scan := warehouse.packship__record_scan(a, t.packing_task_id, 'source', p_raw_barcode, v_capture, 'ACCEPTED',
      'PACK_SOURCE', t.packing_task_id, v_kind, v_resolved, p_idempotency_key, NULL);
    UPDATE warehouse.packing_tasks
       SET status = 'CONTENTS_VERIFYING',
           context = context || jsonb_build_object('sourceVerification', jsonb_build_object('scanEventId', v_scan,
                       'kind', v_kind, 'entityId', v_resolved, 'verifiedAt', clock_timestamp(), 'verifiedBy', a.user_id))
     WHERE packing_task_id = t.packing_task_id;
    v_result := warehouse.packship__result(true, 'OK', t.packing_task_id, a,
      jsonb_build_object('scanEventId', v_scan, 'scanResult', 'ACCEPTED'));
  ELSE
    v_known := v_loc IS NOT NULL OR EXISTS (SELECT 1 FROM warehouse_control.barcodes b
                 WHERE warehouse.packship__n(b.normalized_value::text) = v_n)
               OR EXISTS (SELECT 1 FROM warehouse.locations l WHERE warehouse.packship__n(l.barcode_value::text) = v_n);
    v_scan := warehouse.packship__record_scan(a, t.packing_task_id, 'source', p_raw_barcode, v_capture,
      CASE WHEN v_known THEN 'WRONG_ENTITY' ELSE 'NO_MATCH' END, 'PACK_SOURCE', t.packing_task_id, NULL, NULL,
      p_idempotency_key, 'WRONG_SOURCE');
    v_result := warehouse.packship__result(false, 'WRONG_SOURCE', t.packing_task_id, a,
      jsonb_build_object('scanEventId', v_scan, 'scanResult', CASE WHEN v_known THEN 'WRONG_ENTITY' ELSE 'NO_MATCH' END));
  END IF;
  RETURN warehouse.packship__idem_store('VERIFY_SOURCE', p_idempotency_key, v_hash, a, t.packing_task_id, v_result,
    p_request_id, p_correlation_id);
END $$;

-- 5. Verify one item scan
CREATE OR REPLACE FUNCTION warehouse.packship_verify_item_v2(p_auth_session_id uuid, p_packing_task_id uuid,
  p_expected_row_version bigint, p_raw_barcode text, p_capture jsonb, p_idempotency_key text, p_request_id uuid,
  p_correlation_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a warehouse.packship_actor_t; v_hash bytea; v_replay jsonb; t warehouse.packing_tasks%ROWTYPE; v_n text; v_alt text;
  v_capture jsonb; it warehouse.packing_task_items%ROWTYPE; v_scan bigint; v_result jsonb; v_known boolean;
BEGIN
  a := warehouse.packship__actor(p_auth_session_id);
  v_n := warehouse.packship__input_barcode(p_raw_barcode);
  v_capture := warehouse.packship__check_capture(p_capture);
  v_hash := warehouse.packship__hash('VERIFY_ITEM', jsonb_build_object('task', p_packing_task_id,
    'rv', p_expected_row_version, 'barcode', p_raw_barcode, 'capture', v_capture));
  v_replay := warehouse.packship__idem_lookup('VERIFY_ITEM', p_idempotency_key, v_hash, a.user_id);
  IF v_replay IS NOT NULL THEN RETURN v_replay; END IF;

  t := warehouse.packship__lock_task(p_packing_task_id, a);
  PERFORM warehouse.packship__require_status(t, ARRAY['CONTENTS_VERIFYING']);
  PERFORM warehouse.packship__check_rv(t.row_version, p_expected_row_version);
  PERFORM warehouse.packship__require_claim(t.packing_task_id, a);

  -- UPC-A decodes as 13-digit EAN with a leading 0 (6.2B device matrix); accept either form
  v_alt := CASE WHEN v_n ~ '^0[0-9]{12}$' THEN substr(v_n, 2) WHEN v_n ~ '^[0-9]{12}$' THEN '0' || v_n END;

  SELECT pti.* INTO it FROM warehouse.packing_task_items pti JOIN warehouse.items i ON i.item_id = pti.item_id
   WHERE pti.packing_task_id = t.packing_task_id AND pti.status NOT IN ('REMOVED', 'CANCELLED')
     AND (warehouse.packship__n(pti.expected_item_barcode) IN (v_n, v_alt)
          OR warehouse.packship__n(i.internal_barcode::text) IN (v_n, v_alt)
          OR EXISTS (SELECT 1 FROM warehouse.item_identifiers ii WHERE ii.item_id = pti.item_id AND ii.verified
                       AND warehouse.packship__n(ii.normalized_value::text) IN (v_n, v_alt)))
   ORDER BY (pti.verified_quantity < pti.expected_quantity) DESC, pti.packing_task_item_id
   LIMIT 1 FOR UPDATE OF pti;

  IF it.packing_task_item_id IS NOT NULL AND it.verified_quantity < it.expected_quantity THEN
    v_scan := warehouse.packship__record_scan(a, t.packing_task_id, 'item', p_raw_barcode, v_capture, 'ACCEPTED',
      'PACK_ITEM', it.item_id, 'ITEM', it.item_id, p_idempotency_key, NULL);
    UPDATE warehouse.packing_task_items
       SET verified_quantity = verified_quantity + 1, scanned_item_barcode = left(p_raw_barcode, 256),
           status = CASE WHEN verified_quantity + 1 >= expected_quantity THEN 'VERIFIED' ELSE 'SCANNED' END,
           verified_by = a.user_id, verified_device_id = a.device_id, verified_at = clock_timestamp()
     WHERE packing_task_item_id = it.packing_task_item_id;
    UPDATE warehouse.packing_tasks
       SET status = CASE WHEN NOT EXISTS (SELECT 1 FROM warehouse.packing_task_items x
                                          WHERE x.packing_task_id = t.packing_task_id
                                            AND x.status NOT IN ('VERIFIED', 'REMOVED', 'CANCELLED'))
                         THEN 'PACKING' ELSE status END
     WHERE packing_task_id = t.packing_task_id;
    v_result := warehouse.packship__result(true, 'OK', t.packing_task_id, a,
      jsonb_build_object('scanEventId', v_scan, 'scanResult', 'ACCEPTED', 'packingTaskItemId', it.packing_task_item_id));
  ELSIF it.packing_task_item_id IS NOT NULL THEN
    v_scan := warehouse.packship__record_scan(a, t.packing_task_id, 'item', p_raw_barcode, v_capture, 'DUPLICATE',
      'PACK_ITEM', it.item_id, 'ITEM', it.item_id, p_idempotency_key, 'ITEM_ALREADY_VERIFIED');
    v_result := warehouse.packship__result(false, 'ITEM_ALREADY_VERIFIED', t.packing_task_id, a,
      jsonb_build_object('scanEventId', v_scan, 'scanResult', 'DUPLICATE'));
  ELSE
    v_known := EXISTS (SELECT 1 FROM warehouse.items i WHERE warehouse.packship__n(i.internal_barcode::text) IN (v_n, v_alt))
            OR EXISTS (SELECT 1 FROM warehouse.item_identifiers ii WHERE warehouse.packship__n(ii.normalized_value::text) IN (v_n, v_alt));
    v_scan := warehouse.packship__record_scan(a, t.packing_task_id, 'item', p_raw_barcode, v_capture,
      CASE WHEN v_known THEN 'WRONG_ENTITY' ELSE 'NO_MATCH' END, 'PACK_ITEM', NULL, NULL, NULL, p_idempotency_key, 'WRONG_ITEM');
    v_result := warehouse.packship__result(false, 'WRONG_ITEM', t.packing_task_id, a,
      jsonb_build_object('scanEventId', v_scan, 'scanResult', CASE WHEN v_known THEN 'WRONG_ENTITY' ELSE 'NO_MATCH' END));
  END IF;
  RETURN warehouse.packship__idem_store('VERIFY_ITEM', p_idempotency_key, v_hash, a, t.packing_task_id, v_result,
    p_request_id, p_correlation_id);
END $$;

-- 6. Select packaging → creates the package
CREATE OR REPLACE FUNCTION warehouse.packship_select_package_v2(p_auth_session_id uuid, p_packing_task_id uuid,
  p_expected_row_version bigint, p_packaging_profile_id uuid, p_reason text, p_idempotency_key text, p_request_id uuid,
  p_correlation_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a warehouse.packship_actor_t; v_hash bytea; v_replay jsonb; t warehouse.packing_tasks%ROWTYPE;
  pr warehouse.packaging_profiles%ROWTYPE; v_pkg uuid := gen_random_uuid(); v_number text; v_result jsonb;
  v_now timestamptz := clock_timestamp();
BEGIN
  a := warehouse.packship__actor(p_auth_session_id);
  v_hash := warehouse.packship__hash('SELECT_PACKAGE', jsonb_build_object('task', p_packing_task_id,
    'rv', p_expected_row_version, 'profile', p_packaging_profile_id, 'reason', p_reason));
  v_replay := warehouse.packship__idem_lookup('SELECT_PACKAGE', p_idempotency_key, v_hash, a.user_id);
  IF v_replay IS NOT NULL THEN RETURN v_replay; END IF;

  t := warehouse.packship__lock_task(p_packing_task_id, a);
  PERFORM warehouse.packship__require_status(t, ARRAY['PACKING']);
  PERFORM warehouse.packship__check_rv(t.row_version, p_expected_row_version);
  PERFORM warehouse.packship__require_claim(t.packing_task_id, a);
  IF (warehouse.packship__current_package(t.packing_task_id)).package_id IS NOT NULL THEN
    PERFORM warehouse.packship__fail('PACKSHIP_PRECONDITION_FAILED', '{"blockers":["PACKAGE_ALREADY_SELECTED"]}');
  END IF;
  SELECT * INTO pr FROM warehouse.packaging_profiles
   WHERE packaging_profile_id = p_packaging_profile_id AND active AND effective_at <= v_now
     AND (expires_at IS NULL OR expires_at > v_now);
  IF NOT FOUND THEN
    PERFORM warehouse.packship__fail('PACKSHIP_PRECONDITION_FAILED', '{"blockers":["PACKAGING_PROFILE_INVALID"]}');
  END IF;

  v_number := 'TCDS-PKG-' || upper(substr(replace(v_pkg::text, '-', ''), 1, 12));
  INSERT INTO warehouse.packages (package_id, fulfillment_order_id, package_number, packing_station_id, status,
    packaging_type_code, metadata)
  VALUES (v_pkg, t.fulfillment_order_id, v_number, a.device_station_id, 'OPEN', pr.packaging_type_code,
    jsonb_build_object('packagingProfileId', pr.packaging_profile_id, 'profileCode', pr.profile_code,
                       'profileVersion', pr.version, 'reason', left(p_reason, 500), 'authority', 'packship_v0.2'));
  INSERT INTO warehouse.packing_task_packages (packing_task_id, package_id, relationship_type, linked_by, correlation_id)
  VALUES (t.packing_task_id, v_pkg, 'CREATED', a.user_id, coalesce(p_correlation_id, t.correlation_id));
  INSERT INTO warehouse_control.barcodes (symbology_code, raw_value, normalized_value, status, entity_type, entity_id,
    namespace, source, activated_at, issued_by, metadata)
  VALUES ('CODE128', v_number, warehouse.packship__n(v_number), 'ACTIVE', 'PACKAGE', v_pkg, 'TCDS',
    'GENERATED', clock_timestamp(), a.user_id, '{"authority":"packship_v0.2"}');
  UPDATE warehouse.packing_tasks SET status = 'MEASURING', packing_profile_code = pr.profile_code
   WHERE packing_task_id = t.packing_task_id;

  v_result := warehouse.packship__result(true, 'OK', t.packing_task_id, a, jsonb_build_object('packageId', v_pkg));
  RETURN warehouse.packship__idem_store('SELECT_PACKAGE', p_idempotency_key, v_hash, a, t.packing_task_id, v_result,
    p_request_id, p_correlation_id);
END $$;

-- 7. Record weight and dimensions (scale reading, or manual with a supervisor override)
CREATE OR REPLACE FUNCTION warehouse.packship_record_measurements_v2(p_auth_session_id uuid, p_packing_task_id uuid,
  p_expected_row_version bigint, p_package_id uuid, p_expected_package_row_version bigint, p_weight_oz numeric,
  p_length_in numeric, p_width_in numeric, p_height_in numeric, p_weight_source jsonb, p_idempotency_key text,
  p_request_id uuid, p_correlation_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a warehouse.packship_actor_t; v_hash bytea; v_replay jsonb; t warehouse.packing_tasks%ROWTYPE;
  p warehouse.packages%ROWTYPE; v_type text := upper(coalesce(p_weight_source->>'type', '')); v_weight numeric;
  ws warehouse_control.weigh_sessions%ROWTYPE; m warehouse_telemetry.scale_measurements%ROWTYPE; v_factor numeric;
  v_override uuid; v_source jsonb; v_result jsonb; v_now timestamptz := clock_timestamp();
BEGIN
  a := warehouse.packship__actor(p_auth_session_id);
  v_hash := warehouse.packship__hash('RECORD_MEASUREMENTS', jsonb_build_object('task', p_packing_task_id,
    'rv', p_expected_row_version, 'package', p_package_id, 'prv', p_expected_package_row_version, 'w', p_weight_oz,
    'l', p_length_in, 'wd', p_width_in, 'h', p_height_in, 'source', p_weight_source));
  v_replay := warehouse.packship__idem_lookup('RECORD_MEASUREMENTS', p_idempotency_key, v_hash, a.user_id);
  IF v_replay IS NOT NULL THEN RETURN v_replay; END IF;

  t := warehouse.packship__lock_task(p_packing_task_id, a);
  PERFORM warehouse.packship__require_status(t, ARRAY['MEASURING', 'EVIDENCE_PENDING']);
  PERFORM warehouse.packship__check_rv(t.row_version, p_expected_row_version);
  PERFORM warehouse.packship__require_claim(t.packing_task_id, a);
  p := warehouse.packship__current_package(t.packing_task_id);
  IF p.package_id IS NULL OR p.package_id <> p_package_id OR p.status <> 'OPEN' THEN
    PERFORM warehouse.packship__fail('PACKSHIP_PRECONDITION_FAILED', '{"blockers":["PACKAGE_NOT_CURRENT"]}');
  END IF;
  SELECT * INTO p FROM warehouse.packages WHERE package_id = p_package_id FOR UPDATE;
  PERFORM warehouse.packship__check_rv(p.row_version, p_expected_package_row_version, 'package');
  IF p_length_in IS NULL OR p_width_in IS NULL OR p_height_in IS NULL
     OR p_length_in <= 0 OR p_width_in <= 0 OR p_height_in <= 0
     OR p_length_in > 240 OR p_width_in > 240 OR p_height_in > 240 THEN
    PERFORM warehouse.packship__fail('PACKSHIP_INPUT_INVALID', '{"field":"dimensions"}');
  END IF;

  IF v_type = 'SCALE' THEN
    SELECT * INTO ws FROM warehouse_control.weigh_sessions
     WHERE weigh_session_id = warehouse.packship__uuid(p_weight_source->>'weighSessionId')
       AND facility_id = a.facility_id AND package_id = p_package_id AND voided_at IS NULL
       AND accepted_measurement_id IS NOT NULL;
    IF NOT FOUND THEN PERFORM warehouse.packship__fail('PACKSHIP_PRECONDITION_FAILED', '{"blockers":["SCALE_READING_REQUIRED"]}'); END IF;
    SELECT * INTO m FROM warehouse_telemetry.scale_measurements
     WHERE scale_measurement_id = ws.accepted_measurement_id AND weigh_session_id = ws.weigh_session_id
       AND stable AND NOT overload AND NOT underload AND accepted_at IS NOT NULL;
    IF NOT FOUND THEN PERFORM warehouse.packship__fail('PACKSHIP_PRECONDITION_FAILED', '{"blockers":["SCALE_READING_NOT_STABLE"]}'); END IF;
    v_factor := CASE lower(m.unit_of_measure) WHEN 'oz' THEN 1 WHEN 'lb' THEN 16 WHEN 'lbs' THEN 16
                  WHEN 'g' THEN 0.0352739619 WHEN 'kg' THEN 35.2739619 END;
    IF v_factor IS NULL THEN PERFORM warehouse.packship__fail('PACKSHIP_PRECONDITION_FAILED', '{"blockers":["SCALE_UNIT_UNSUPPORTED"]}'); END IF;
    v_weight := round(m.net_weight * v_factor, 3);
    v_source := jsonb_build_object('type', 'SCALE', 'weighSessionId', ws.weigh_session_id,
                                   'scaleMeasurementId', m.scale_measurement_id, 'scaleAssetId', m.scale_asset_id);
  ELSIF v_type = 'MANUAL' THEN
    v_weight := round(p_weight_oz, 3);
    IF coalesce((warehouse.packship__setting('manual_weight_requires_override') #>> '{}')::boolean, true) THEN
      SELECT d.packing_override_decision_id INTO v_override FROM warehouse.packing_override_decisions d
       WHERE d.packing_override_decision_id = warehouse.packship__uuid(p_weight_source->>'overrideDecisionId')
         AND d.packing_task_id = t.packing_task_id AND (d.package_id IS NULL OR d.package_id = p_package_id)
         AND d.decision_type = 'MANUAL_WEIGHT' AND d.status = 'APPROVED' AND d.revoked_at IS NULL
         AND (d.expires_at IS NULL OR d.expires_at > v_now)
         AND d.approved_by IS NOT NULL AND d.approved_by <> a.user_id;
      IF v_override IS NULL THEN
        PERFORM warehouse.packship__fail('PACKSHIP_PRECONDITION_FAILED', '{"blockers":["MANUAL_WEIGHT_OVERRIDE_REQUIRED"]}');
      END IF;
    END IF;
    v_source := jsonb_build_object('type', 'MANUAL', 'overrideDecisionId', v_override);
  ELSE
    PERFORM warehouse.packship__fail('PACKSHIP_INPUT_INVALID', '{"field":"weightSource"}');
  END IF;
  IF v_weight IS NULL OR v_weight <= 0 OR v_weight > 2400 THEN
    PERFORM warehouse.packship__fail('PACKSHIP_INPUT_INVALID', '{"field":"weight"}');
  END IF;

  UPDATE warehouse.packages
     SET actual_weight_oz = v_weight, length_in = p_length_in, width_in = p_width_in, height_in = p_height_in,
         dimensional_weight_oz = round(p_length_in * p_width_in * p_height_in / 139 * 16, 3), measured_at = v_now,
         metadata = metadata || jsonb_build_object('weightSource', v_source, 'measuredBy', a.user_id)
   WHERE package_id = p_package_id;
  UPDATE warehouse.packing_tasks SET status = 'EVIDENCE_PENDING' WHERE packing_task_id = t.packing_task_id;

  v_result := warehouse.packship__result(true, 'OK', t.packing_task_id, a);
  RETURN warehouse.packship__idem_store('RECORD_MEASUREMENTS', p_idempotency_key, v_hash, a, t.packing_task_id, v_result,
    p_request_id, p_correlation_id);
END $$;

-- 8. Complete (seal) the pack
CREATE OR REPLACE FUNCTION warehouse.packship_complete_task_v2(p_auth_session_id uuid, p_packing_task_id uuid,
  p_expected_row_version bigint, p_package_id uuid, p_expected_package_row_version bigint, p_idempotency_key text,
  p_request_id uuid, p_correlation_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a warehouse.packship_actor_t; v_hash bytea; v_replay jsonb; t warehouse.packing_tasks%ROWTYPE;
  p warehouse.packages%ROWTYPE; v_blockers text[]; v_result jsonb; v_now timestamptz := clock_timestamp();
BEGIN
  a := warehouse.packship__actor(p_auth_session_id);
  v_hash := warehouse.packship__hash('COMPLETE_TASK', jsonb_build_object('task', p_packing_task_id,
    'rv', p_expected_row_version, 'package', p_package_id, 'prv', p_expected_package_row_version));
  v_replay := warehouse.packship__idem_lookup('COMPLETE_TASK', p_idempotency_key, v_hash, a.user_id);
  IF v_replay IS NOT NULL THEN RETURN v_replay; END IF;

  t := warehouse.packship__lock_task(p_packing_task_id, a);
  PERFORM warehouse.packship__require_status(t, ARRAY['EVIDENCE_PENDING']);
  PERFORM warehouse.packship__check_rv(t.row_version, p_expected_row_version);
  PERFORM warehouse.packship__require_claim(t.packing_task_id, a);
  p := warehouse.packship__current_package(t.packing_task_id);
  IF p.package_id IS NULL OR p.package_id <> p_package_id OR p.status <> 'OPEN' THEN
    PERFORM warehouse.packship__fail('PACKSHIP_PRECONDITION_FAILED', '{"blockers":["PACKAGE_NOT_CURRENT"]}');
  END IF;
  SELECT * INTO p FROM warehouse.packages WHERE package_id = p_package_id FOR UPDATE;
  PERFORM warehouse.packship__check_rv(p.row_version, p_expected_package_row_version, 'package');
  v_blockers := warehouse.packship__blockers(t.packing_task_id);
  IF cardinality(v_blockers) > 0 THEN
    PERFORM warehouse.packship__fail('PACKSHIP_PRECONDITION_FAILED', jsonb_build_object('blockers', to_jsonb(v_blockers)));
  END IF;

  BEGIN
    INSERT INTO warehouse.package_items (package_id, item_id, quantity, packed_sequence_no, packed_by, packed_at)
    SELECT p_package_id, i.item_id, i.verified_quantity, row_number() OVER (ORDER BY i.packing_task_item_id), a.user_id, v_now
      FROM warehouse.packing_task_items i
     WHERE i.packing_task_id = t.packing_task_id AND i.status = 'VERIFIED';
  EXCEPTION WHEN unique_violation THEN
    PERFORM warehouse.packship__fail('PACKSHIP_PRECONDITION_FAILED', '{"blockers":["ITEM_ALREADY_PACKED"]}');
  END;
  UPDATE warehouse.items SET status = 'PACKED'
   WHERE item_id IN (SELECT item_id FROM warehouse.packing_task_items WHERE packing_task_id = t.packing_task_id AND status = 'VERIFIED');
  UPDATE warehouse.packing_task_items SET status = 'PACKED'
   WHERE packing_task_id = t.packing_task_id AND status = 'VERIFIED';
  UPDATE warehouse.packages SET status = 'PACKED', packed_by = a.user_id, packed_at = v_now, sealed_at = v_now
   WHERE package_id = p_package_id;
  INSERT INTO warehouse.packing_task_packages (packing_task_id, package_id, relationship_type, linked_by, correlation_id)
  VALUES (t.packing_task_id, p_package_id, 'PACKED', a.user_id, coalesce(p_correlation_id, t.correlation_id));
  UPDATE warehouse.packing_tasks
     SET status = 'PACKED', result = result || jsonb_build_object('packedAt', v_now, 'packageId', p_package_id, 'packedBy', a.user_id)
   WHERE packing_task_id = t.packing_task_id;

  v_result := warehouse.packship__result(true, 'OK', t.packing_task_id, a);
  RETURN warehouse.packship__idem_store('COMPLETE_TASK', p_idempotency_key, v_hash, a, t.packing_task_id, v_result,
    p_request_id, p_correlation_id);
END $$;

-- 9. Verify the physical label pair (tracking label + package label)
CREATE OR REPLACE FUNCTION warehouse.packship_verify_label_pair_v2(p_auth_session_id uuid, p_shipment_id uuid,
  p_tracking_barcode text, p_package_barcode text, p_physical_evidence jsonb, p_capture jsonb, p_idempotency_key text,
  p_request_id uuid, p_correlation_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a warehouse.packship_actor_t; v_hash bytea; v_replay jsonb; h warehouse.shipping_handoffs%ROWTYPE;
  t warehouse.packing_tasks%ROWTYPE; p warehouse.packages%ROWTYPE; pj warehouse_control.print_jobs%ROWTYPE;
  v_nt text; v_np text; v_ok_t boolean; v_ok_p boolean; v_code text; v_capture jsonb; v_ev jsonb := p_physical_evidence;
  v_scan_t bigint; v_scan_p bigint; v_pair uuid; v_result jsonb; v_now timestamptz := clock_timestamp(); st record;
BEGIN
  a := warehouse.packship__actor(p_auth_session_id);
  v_nt := warehouse.packship__input_barcode(p_tracking_barcode);
  v_np := warehouse.packship__input_barcode(p_package_barcode);
  v_capture := warehouse.packship__check_capture(p_capture);
  IF v_ev IS NOT NULL THEN
    IF jsonb_typeof(v_ev) <> 'object' OR v_ev->>'labelPairId' IS NULL
       OR (v_ev->'tracking'->>'labelPairId') IS DISTINCT FROM (v_ev->>'labelPairId')
       OR (v_ev->'tracking'->>'barcode' IS NOT NULL AND warehouse.packship__n(v_ev->'tracking'->>'barcode') IS DISTINCT FROM v_nt) THEN
      PERFORM warehouse.packship__fail('PACKSHIP_INPUT_INVALID', '{"field":"physicalEvidence","reason":"EVIDENCE_INCONSISTENT"}');
    END IF;
  END IF;
  v_hash := warehouse.packship__hash('VERIFY_LABEL_PAIR', jsonb_build_object('shipment', p_shipment_id,
    'tracking', p_tracking_barcode, 'package', p_package_barcode, 'evidence', v_ev, 'capture', v_capture));
  v_replay := warehouse.packship__idem_lookup('VERIFY_LABEL_PAIR', p_idempotency_key, v_hash, a.user_id);
  IF v_replay IS NOT NULL THEN RETURN v_replay; END IF;

  SELECT * INTO st FROM warehouse.packship__shipment_task(p_shipment_id, a);
  h := st.o_handoff; t := st.o_task;
  PERFORM warehouse.packship__require_status(t, ARRAY['PACKED', 'SHIPPING_REVIEW', 'LABEL_PENDING', 'LABEL_PURCHASED', 'PRINTING']);
  PERFORM warehouse.packship__require_claim(t.packing_task_id, a);
  IF h.tracking_number IS NULL THEN
    PERFORM warehouse.packship__fail('PACKSHIP_PRECONDITION_FAILED', '{"blockers":["LABEL_NOT_PURCHASED"]}');
  END IF;
  IF upper(h.status) IN ('VOIDED', 'CANCELLED', 'CANCELED') THEN
    PERFORM warehouse.packship__fail('PACKSHIP_PRECONDITION_FAILED', '{"blockers":["SHIPMENT_VOIDED"]}');
  END IF;
  SELECT * INTO pj FROM warehouse_control.print_jobs
   WHERE shipping_handoff_id = h.shipping_handoff_id AND status::text IN ('PRINTED', 'VERIFICATION_PENDING', 'VERIFIED')
   ORDER BY completed_at DESC NULLS LAST, created_at DESC LIMIT 1 FOR UPDATE;
  IF pj.print_job_id IS NULL AND coalesce((warehouse.packship__setting('label_requires_print_job') #>> '{}')::boolean, true) THEN
    PERFORM warehouse.packship__fail('PACKSHIP_PRECONDITION_FAILED', '{"blockers":["LABEL_NOT_PRINTED"]}');
  END IF;
  SELECT * INTO p FROM warehouse.packages WHERE package_id = h.package_id;

  v_ok_t := v_nt = warehouse.packship__n(h.tracking_number::text);
  v_ok_p := v_np = warehouse.packship__n(p.package_number::text)
            OR EXISTS (SELECT 1 FROM warehouse_control.barcodes b WHERE b.entity_type = 'PACKAGE' AND b.entity_id = p.package_id
                         AND b.status = 'ACTIVE' AND warehouse.packship__n(b.normalized_value::text) = v_np);
  v_code := CASE WHEN NOT v_ok_t THEN 'TRACKING_MISMATCH' WHEN NOT v_ok_p THEN 'PACKAGE_MISMATCH' ELSE 'OK' END;

  v_scan_t := warehouse.packship__record_scan(a, t.packing_task_id, 'tracking', p_tracking_barcode,
    v_capture || jsonb_build_object('evidence', v_ev->'tracking'), CASE WHEN v_ok_t THEN 'ACCEPTED' ELSE 'WRONG_ENTITY' END,
    'SHIPPING_HANDOFF', h.shipping_handoff_id, CASE WHEN v_ok_t THEN 'SHIPPING_HANDOFF' END,
    CASE WHEN v_ok_t THEN h.shipping_handoff_id END, p_idempotency_key, CASE WHEN v_ok_t THEN NULL ELSE 'TRACKING_MISMATCH' END);
  v_scan_p := warehouse.packship__record_scan(a, t.packing_task_id, 'package', p_package_barcode,
    v_capture || jsonb_build_object('evidence', v_ev->'package'), CASE WHEN v_ok_p THEN 'ACCEPTED' ELSE 'WRONG_ENTITY' END,
    'PACKAGE', p.package_id, CASE WHEN v_ok_p THEN 'PACKAGE' END, CASE WHEN v_ok_p THEN p.package_id END,
    p_idempotency_key, CASE WHEN v_ok_p THEN NULL ELSE 'PACKAGE_MISMATCH' END);

  INSERT INTO warehouse.packship_label_pairs (client_label_pair_id, shipping_handoff_id, packing_task_id, package_id,
    tracking_scan_event_id, package_scan_event_id, result_code, print_job_id, capture_source,
    tracking_client_operation_id, tracking_correlation_id, package_client_operation_id, package_correlation_id,
    physical_evidence, verified_by, device_id, auth_session_id, idempotency_key, correlation_id)
  VALUES (left(v_ev->>'labelPairId', 200), h.shipping_handoff_id, t.packing_task_id, p.package_id, v_scan_t, v_scan_p,
    v_code, pj.print_job_id, coalesce(v_capture->>'source', CASE WHEN v_ev IS NULL THEN 'MANUAL' ELSE 'CAMERA' END),
    v_ev->'tracking'->>'trackingClientOperationId', v_ev->'tracking'->>'trackingCorrelationId',
    v_ev->'package'->>'packageClientOperationId', v_ev->'package'->>'packageCorrelationId',
    v_ev, a.user_id, a.device_id, a.auth_session_id, p_idempotency_key, p_correlation_id)
  RETURNING label_pair_id INTO v_pair;

  IF v_code = 'OK' THEN
    IF pj.print_job_id IS NOT NULL THEN
      INSERT INTO warehouse_control.print_verifications (print_job_id, barcode_scan_event_id, expected_barcode_value,
        scanned_barcode_value, barcode_match, verified_by, verified_at, result, metadata)
      VALUES (pj.print_job_id, v_scan_t, h.tracking_number, p_tracking_barcode, true, a.user_id, v_now, 'PASSED',
        jsonb_build_object('labelPairId', v_pair, 'packageScanEventId', v_scan_p, 'authority', 'packship_v0.2'))
      ON CONFLICT (print_job_id) DO NOTHING;
      UPDATE warehouse_control.print_jobs SET status = 'VERIFIED'
       WHERE print_job_id = pj.print_job_id AND status::text IN ('PRINTED', 'VERIFICATION_PENDING');
    END IF;
    UPDATE warehouse.packing_tasks SET status = 'LABEL_VERIFIED',
           result = result || jsonb_build_object('labelPairId', v_pair, 'labelVerifiedAt', v_now)
     WHERE packing_task_id = t.packing_task_id;
  END IF;

  v_result := warehouse.packship__result(v_code = 'OK', v_code, t.packing_task_id, a,
    jsonb_build_object('labelPairId', v_pair, 'trackingScanEventId', v_scan_t, 'packageScanEventId', v_scan_p));
  RETURN warehouse.packship__idem_store('VERIFY_LABEL_PAIR', p_idempotency_key, v_hash, a, t.packing_task_id, v_result,
    p_request_id, p_correlation_id);
END $$;

-- 10. Stage outbound
CREATE OR REPLACE FUNCTION warehouse.packship_stage_outbound_v2(p_auth_session_id uuid, p_shipment_id uuid,
  p_location_barcode text, p_capture jsonb, p_idempotency_key text, p_request_id uuid, p_correlation_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a warehouse.packship_actor_t; v_hash bytea; v_replay jsonb; h warehouse.shipping_handoffs%ROWTYPE;
  t warehouse.packing_tasks%ROWTYPE; lp warehouse.packship_label_pairs%ROWTYPE; l warehouse.locations%ROWTYPE;
  v_n text; v_capture jsonb; v_scan bigint; v_claim uuid; v_known boolean; v_result jsonb; v_now timestamptz := clock_timestamp(); st record;
BEGIN
  a := warehouse.packship__actor(p_auth_session_id);
  v_n := warehouse.packship__input_barcode(p_location_barcode);
  v_capture := warehouse.packship__check_capture(p_capture);
  v_hash := warehouse.packship__hash('STAGE_OUTBOUND', jsonb_build_object('shipment', p_shipment_id,
    'location', p_location_barcode, 'capture', v_capture));
  v_replay := warehouse.packship__idem_lookup('STAGE_OUTBOUND', p_idempotency_key, v_hash, a.user_id);
  IF v_replay IS NOT NULL THEN RETURN v_replay; END IF;

  SELECT * INTO st FROM warehouse.packship__shipment_task(p_shipment_id, a);
  h := st.o_handoff; t := st.o_task;
  PERFORM warehouse.packship__require_status(t, ARRAY['LABEL_VERIFIED']);
  v_claim := warehouse.packship__require_claim(t.packing_task_id, a);
  SELECT * INTO lp FROM warehouse.packship_label_pairs
   WHERE shipping_handoff_id = h.shipping_handoff_id AND packing_task_id = t.packing_task_id AND result_code = 'OK'
   ORDER BY verified_at DESC LIMIT 1;
  IF lp.label_pair_id IS NULL THEN
    PERFORM warehouse.packship__fail('PACKSHIP_PRECONDITION_FAILED', '{"blockers":["LABEL_NOT_VERIFIED"]}');
  END IF;

  SELECT * INTO l FROM warehouse.locations
   WHERE warehouse.packship__n(barcode_value::text) = v_n AND facility_id = t.facility_id AND is_active AND archived_at IS NULL;
  IF l.location_id IS NULL OR l.location_type::text NOT IN ('STAGING', 'SHIPPING_STATION') THEN
    v_known := l.location_id IS NOT NULL
               OR EXISTS (SELECT 1 FROM warehouse.locations x WHERE warehouse.packship__n(x.barcode_value::text) = v_n);
    v_scan := warehouse.packship__record_scan(a, t.packing_task_id, 'location', p_location_barcode, v_capture,
      CASE WHEN v_known THEN 'WRONG_LOCATION' ELSE 'NO_MATCH' END, 'OUTBOUND_LOCATION', NULL,
      CASE WHEN l.location_id IS NOT NULL THEN 'LOCATION' END, l.location_id, p_idempotency_key, 'WRONG_LOCATION');
    v_result := warehouse.packship__result(false, 'WRONG_LOCATION', t.packing_task_id, a,
      jsonb_build_object('scanEventId', v_scan, 'scanResult', CASE WHEN v_known THEN 'WRONG_LOCATION' ELSE 'NO_MATCH' END));
    RETURN warehouse.packship__idem_store('STAGE_OUTBOUND', p_idempotency_key, v_hash, a, t.packing_task_id, v_result,
      p_request_id, p_correlation_id);
  END IF;

  v_scan := warehouse.packship__record_scan(a, t.packing_task_id, 'location', p_location_barcode, v_capture, 'ACCEPTED',
    'OUTBOUND_LOCATION', l.location_id, 'LOCATION', l.location_id, p_idempotency_key, NULL);
  INSERT INTO warehouse.outbound_staging_events (packing_task_id, package_id, shipping_handoff_id, outbound_location_id,
    package_barcode_scan_event_id, tracking_barcode_scan_event_id, staged_by, device_id, staged_at, correlation_id,
    idempotency_key, metadata)
  VALUES (t.packing_task_id, h.package_id, h.shipping_handoff_id, l.location_id, lp.package_scan_event_id,
    lp.tracking_scan_event_id, a.user_id, a.device_id, v_now, coalesce(p_correlation_id, t.correlation_id), p_idempotency_key,
    jsonb_build_object('locationScanEventId', v_scan, 'labelPairId', lp.label_pair_id, 'authority', 'packship_v0.2'));
  UPDATE warehouse.packages SET status = 'STAGED' WHERE package_id = h.package_id;
  UPDATE warehouse.items SET status = 'SHIP_READY'
   WHERE item_id IN (SELECT item_id FROM warehouse.package_items WHERE package_id = h.package_id) AND status::text = 'PACKED';
  UPDATE warehouse.packing_task_claims SET released_at = v_now, release_reason = 'OUTBOUND_STAGED'
   WHERE packing_task_claim_id = v_claim;
  UPDATE warehouse.packing_tasks
     SET status = 'OUTBOUND_STAGED', claimed_by_user_id = NULL, claimed_device_id = NULL, claim_token_hash = NULL,
         claimed_at = NULL, claim_heartbeat_at = NULL, claim_expires_at = NULL, released_at = v_now,
         release_reason = 'OUTBOUND_STAGED',
         result = result || jsonb_build_object('stagedAt', v_now, 'outboundLocationId', l.location_id)
   WHERE packing_task_id = t.packing_task_id;

  v_result := warehouse.packship__result(true, 'OK', t.packing_task_id, a,
    jsonb_build_object('scanEventId', v_scan, 'scanResult', 'ACCEPTED', 'outboundLocationId', l.location_id));
  RETURN warehouse.packship__idem_store('STAGE_OUTBOUND', p_idempotency_key, v_hash, a, t.packing_task_id, v_result,
    p_request_id, p_correlation_id);
END $$;

-- 11. Read the task (also serves completionCheck)
CREATE OR REPLACE FUNCTION warehouse.packship_get_task_v2(p_auth_session_id uuid, p_packing_task_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE a warehouse.packship_actor_t; v_facility uuid;
BEGIN
  a := warehouse.packship__actor(p_auth_session_id);
  SELECT facility_id INTO v_facility FROM warehouse.packing_tasks WHERE packing_task_id = p_packing_task_id;
  IF v_facility IS NULL THEN PERFORM warehouse.packship__fail('PACKSHIP_TASK_NOT_FOUND'); END IF;
  IF v_facility <> a.facility_id THEN PERFORM warehouse.packship__fail('PACKSHIP_FACILITY_MISMATCH'); END IF;
  RETURN warehouse.packship__result(true, 'OK', p_packing_task_id, a);
END $$;

-- ---------------------------------------------------------------------------------------------------------------------
-- 4. Privileges
-- ---------------------------------------------------------------------------------------------------------------------
DO $$
DECLARE r record;
BEGIN
  -- Nothing in V0.2 is executable by PUBLIC or the Supabase API roles
  FOR r IN SELECT p.oid::regprocedure AS fn FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
            WHERE n.nspname = 'warehouse' AND (p.proname LIKE 'packship\_\_%' OR p.proname LIKE 'packship\_%\_v2') LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated, service_role', r.fn);
  END LOOP;
END $$;

GRANT USAGE ON SCHEMA warehouse TO tcds_packship_api, tcds_packship_system;
GRANT EXECUTE ON FUNCTION
  warehouse.packship_claim_task_v2(uuid, uuid, text, uuid, uuid),
  warehouse.packship_release_task_v2(uuid, uuid, bigint, text, text, uuid, uuid),
  warehouse.packship_verify_source_v2(uuid, uuid, bigint, text, jsonb, text, uuid, uuid),
  warehouse.packship_verify_item_v2(uuid, uuid, bigint, text, jsonb, text, uuid, uuid),
  warehouse.packship_select_package_v2(uuid, uuid, bigint, uuid, text, text, uuid, uuid),
  warehouse.packship_record_measurements_v2(uuid, uuid, bigint, uuid, bigint, numeric, numeric, numeric, numeric, jsonb, text, uuid, uuid),
  warehouse.packship_complete_task_v2(uuid, uuid, bigint, uuid, bigint, text, uuid, uuid),
  warehouse.packship_verify_label_pair_v2(uuid, uuid, text, text, jsonb, jsonb, text, uuid, uuid),
  warehouse.packship_stage_outbound_v2(uuid, uuid, text, jsonb, text, uuid, uuid),
  warehouse.packship_get_task_v2(uuid, uuid)
TO tcds_packship_api;
GRANT EXECUTE ON FUNCTION
  warehouse.packship_create_task_v2(uuid, uuid, uuid, smallint, timestamptz, text, uuid, uuid)
TO tcds_packship_system;

-- The two V0.1 functions are superseded. They are postgres-only today; keep it that way.
REVOKE ALL ON FUNCTION warehouse.complete_packing_task(uuid, uuid, uuid, text, uuid, uuid, uuid, text, bigint, bigint)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION warehouse.verify_label_and_stage_outbound(uuid, uuid, uuid, uuid, bigint, bigint, uuid, text, uuid, uuid, uuid, text, bigint, bigint)
  FROM PUBLIC, anon, authenticated, service_role;
COMMENT ON FUNCTION warehouse.complete_packing_task(uuid, uuid, uuid, text, uuid, uuid, uuid, text, bigint, bigint)
  IS 'SUPERSEDED by warehouse.packship_complete_task_v2 (Pack/Ship Backend Authority V0.2). Do not call.';
COMMENT ON FUNCTION warehouse.verify_label_and_stage_outbound(uuid, uuid, uuid, uuid, bigint, bigint, uuid, text, uuid, uuid, uuid, text, bigint, bigint)
  IS 'SUPERSEDED by warehouse.packship_verify_label_pair_v2 + packship_stage_outbound_v2 (V0.2). Do not call.';
