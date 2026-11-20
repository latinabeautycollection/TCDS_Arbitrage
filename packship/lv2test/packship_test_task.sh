#!/usr/bin/env bash
# One clearly labelled Pack/Ship TEST task at the LV2TEST facility on PRODUCTION (vfxlrkqgakqqbnbbgecp), so the pilot
# users can run the whole flow end to end. Every record is tagged with the run id PSTEST-MMDDHHMM (order marketplace
# 'PSTEST', barcodes/locations/items prefixed with the run id). Only touches the LV2TEST facility.
#   rehearse        create everything + the packing task (create_task_v2) + read it back, then ROLLBACK.
#   create          CONFIRM=CREATE-PSTEST: same, COMMIT. Prints the task id and every barcode to scan or type.
#   approve-weight  CONFIRM=APPROVE-PSTEST-WEIGHT RUN=… PACKER=<username> [APPROVER=tictac]: after the package is
#                   selected, records an APPROVED MANUAL_WEIGHT supervisor override (approver must differ from the
#                   packer; there is no scale). Prints the overrideDecisionId the measurements call must send.
#   simulate-label  CONFIRM=SIMULATE-PSTEST-LABEL RUN=…: TEST ONLY, stands in for the not-yet-built shipping/label
#                   service once the task is sealed (PACKED): a shipping handoff with a fake 1ZPSTEST… tracking
#                   number and a print job marked PRINTED. Prints the shipmentId and the two label barcodes.
#   status          RUN=…: read only, the task as the database sees it.
#   retire          CONFIRM=RETIRE-PSTEST RUN=…: cancel the test task and order. Records stay (the operation ledger
#                   and scan evidence are append-only by design) and remain tagged PSTEST.
# Prints no secrets.  Usage: [RUN=PSTEST-…] bash /tmp/domain6_scanner/packship_test_task.sh <mode>
set -uo pipefail
FAC=b1a24146-8493-4b45-9fac-0b78eb4497d5     # LV2TEST
cd /srv/arb-system/api || exit 1
eval "$(grep -E '^(PGHOST|PGPORT|PGDATABASE|PGUSER|PGPASSWORD|PGSSLMODE)=' .env | sed -E "s/^([A-Z_]+)=(.*)$/export \1='\2'/")"
case "${PGHOST:-}${PGUSER:-}" in *vfxlrkqgakqqbnbbgecp*) ;; *) echo "not the production database - stopping"; exit 1;; esac
export PAGER=cat
run_ok(){ [[ "${RUN:-}" =~ ^PSTEST-[0-9]{8}$ ]] || { echo "set RUN=PSTEST-MMDDHHMM (printed by create)"; exit 1; }; }
user_ok(){ [[ "$1" =~ ^[A-Za-z0-9._@-]{1,80}$ ]] || { echo "bad username: $1"; exit 1; }; }
PSQL(){ psql -X -q -At -v ON_ERROR_STOP=1 -v fac="$FAC" -v run="${RUN:-}" "$@"; }

create_sql() { cat <<'SQL'
SET LOCAL lock_timeout = '5s';
SELECT set_config('pstest.run', :'run', true), set_config('pstest.fac', :'fac', true);
DO $$
DECLARE run text := current_setting('pstest.run'); f uuid := current_setting('pstest.fac')::uuid;
  src uuid; stg uuid; prof uuid; pp uuid; i1 uuid; i2 uuid; o uuid; r jsonb;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM warehouse.facilities WHERE facility_id = f AND facility_code::text = 'LV2TEST') THEN
    RAISE EXCEPTION 'LV2TEST facility not found'; END IF;
  IF EXISTS (SELECT 1 FROM warehouse.fulfillment_orders WHERE marketplace = 'PSTEST' AND external_order_id = run) THEN
    RAISE EXCEPTION 'run % already exists', run; END IF;
  INSERT INTO warehouse.locations (facility_id, location_code, location_name, location_type, barcode_value, path_code)
  VALUES (f, run || '-SRC', 'TEST source bin ' || run, 'BIN', run || '-SRC', 'PSTEST/' || run || '/SRC') RETURNING location_id INTO src;
  INSERT INTO warehouse.locations (facility_id, location_code, location_name, location_type, barcode_value, path_code)
  VALUES (f, run || '-STG', 'TEST outbound staging ' || run, 'STAGING', run || '-STG', 'PSTEST/' || run || '/STG') RETURNING location_id INTO stg;
  INSERT INTO warehouse.product_profiles (title, source_system, source_record_id)
  VALUES ('TEST ITEM - Pack/Ship pilot ' || run, 'PSTEST', run) RETURNING product_profile_id INTO pp;
  INSERT INTO warehouse.items (facility_id, current_location_id, internal_barcode, status, product_profile_id)
  VALUES (f, src, run || '-ITEM-1', 'PICKED', pp) RETURNING item_id INTO i1;
  INSERT INTO warehouse.items (facility_id, current_location_id, internal_barcode, status, product_profile_id)
  VALUES (f, src, run || '-ITEM-2', 'PICKED', pp) RETURNING item_id INTO i2;
  INSERT INTO warehouse.fulfillment_orders (facility_id, external_order_id, marketplace, order_status, order_created_at, ship_by_at)
  VALUES (f, run, 'PSTEST', 'READY_TO_PACK', clock_timestamp(), clock_timestamp() + interval '1 day') RETURNING fulfillment_order_id INTO o;
  INSERT INTO warehouse.fulfillment_order_lines (fulfillment_order_id, item_id, external_line_id) VALUES (o, i1, 'L1'), (o, i2, 'L2');
  SELECT packaging_profile_id INTO prof FROM warehouse.packaging_profiles WHERE profile_code::text = 'PSTEST-BOX-S' AND version = 1;
  IF prof IS NULL THEN
    INSERT INTO warehouse.packaging_profiles (profile_code, profile_name, version, packaging_type_code)
    VALUES ('PSTEST-BOX-S', 'TEST small box (Pack/Ship pilot)', 1, 'BOX') RETURNING packaging_profile_id INTO prof;
  END IF;
  r := warehouse.packship_create_task_v2(o, NULL, NULL, NULL, clock_timestamp() + interval '20 hours',
         run || '-create', gen_random_uuid(), gen_random_uuid());
  IF r->>'ok' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'create_task_v2 failed: %', r->>'code'; END IF;
  RAISE NOTICE 'RUN            %', run;
  RAISE NOTICE 'taskId         %   (open /pack-ship?taskId=%)', r->'task'->>'packingTaskId', r->'task'->>'packingTaskId';
  RAISE NOTICE 'taskNumber     %   status %   items %', r->'task'->>'taskNumber', r->'task'->>'status', jsonb_array_length(r->'task'->'items');
  RAISE NOTICE 'scan 1 source  %', run || '-SRC';
  RAISE NOTICE 'scan 2 items   %  and  %', run || '-ITEM-1', run || '-ITEM-2';
  RAISE NOTICE 'package        profile PSTEST-BOX-S  profileId %', prof;
  RAISE NOTICE 'outbound       %   (after the label pair)', run || '-STG';
  RAISE NOTICE 'snapshot       version %  facility %  title %', r->'task'->>'snapshotVersion', r->'task'->'facility'->>'facilityCode',
               r->'task'->'items'->0->>'title';
END $$;
SQL
}

case "${1:-}" in
rehearse|create)
  if [ "$1" = create ]; then [ "${CONFIRM:-}" = "CREATE-PSTEST" ] || { echo "set CONFIRM=CREATE-PSTEST"; exit 1; }; fi
  RUN=PSTEST-$(date -u +%m%d%H%M)
  END=$([ "$1" = create ] && echo COMMIT || echo ROLLBACK)
  echo "target: production LV2TEST, mode=$1 ($END at the end)"
  { echo "BEGIN;"; create_sql; echo "$END;"; } | PSQL 2>&1 | sed 's/^NOTICE:  //'
  rc=${PIPESTATUS[1]}
  if [ "$rc" -ne 0 ]; then echo "$1 FAILED rc=$rc - nothing was kept"; exit "$rc"; fi
  [ "$1" = create ] && echo "CREATED. Keep the run id: RUN=$RUN" || echo "rehearse finished (ROLLBACK) rc=0" ;;

approve-weight)
  [ "${CONFIRM:-}" = "APPROVE-PSTEST-WEIGHT" ] || { echo "set CONFIRM=APPROVE-PSTEST-WEIGHT"; exit 1; }
  run_ok; user_ok "${PACKER:-}"; APPROVER=${APPROVER:-tictac}; user_ok "$APPROVER"
  [ "$(echo "$PACKER" | tr A-Z a-z)" != "$(echo "$APPROVER" | tr A-Z a-z)" ] || { echo "APPROVER must differ from PACKER"; exit 1; }
  PSQL -v packer="$PACKER" -v approver="$APPROVER" <<'SQL' 2>&1 | sed 's/^NOTICE:  //'
BEGIN;
SELECT set_config('pstest.run', :'run', true), set_config('pstest.packer', lower(:'packer'), true),
       set_config('pstest.approver', lower(:'approver'), true), set_config('pstest.fac', :'fac', true);
DO $$
DECLARE t warehouse.packing_tasks%ROWTYPE; p warehouse.packages%ROWTYPE; pk uuid; ap uuid; d uuid;
BEGIN
  SELECT pt.* INTO t FROM warehouse.packing_tasks pt JOIN warehouse.fulfillment_orders o ON o.fulfillment_order_id = pt.fulfillment_order_id
   WHERE o.marketplace = 'PSTEST' AND o.external_order_id = current_setting('pstest.run')
     AND pt.facility_id = current_setting('pstest.fac')::uuid AND pt.status NOT IN ('CANCELLED','ABANDONED');
  IF t.packing_task_id IS NULL THEN RAISE EXCEPTION 'no active PSTEST task for this run'; END IF;
  p := warehouse.packship__current_package(t.packing_task_id);
  IF p.package_id IS NULL THEN RAISE EXCEPTION 'no package yet: select the package in the PWA first (task status %)', t.status; END IF;
  SELECT user_id INTO pk FROM warehouse_identity.users WHERE normalized_username = current_setting('pstest.packer');
  SELECT user_id INTO ap FROM warehouse_identity.users WHERE normalized_username = current_setting('pstest.approver');
  IF pk IS NULL OR ap IS NULL THEN RAISE EXCEPTION 'PACKER or APPROVER username not found'; END IF;
  INSERT INTO warehouse.packing_override_decisions (packing_task_id, package_id, override_level, decision_type, status,
    reason_code, reason, requested_by, approved_by, correlation_id, decided_at)
  VALUES (t.packing_task_id, p.package_id, 'SUPERVISOR', 'MANUAL_WEIGHT', 'APPROVED', 'NO_SCALE',
          'LV2TEST pilot test ' || current_setting('pstest.run') || ': no scale', pk, ap, gen_random_uuid(), clock_timestamp())
  RETURNING packing_override_decision_id INTO d;
  RAISE NOTICE 'overrideDecisionId %', d;
  RAISE NOTICE 'measurements must send weightSource = {"type":"MANUAL","overrideDecisionId":"%"} and weightOz (ounces)', d;
  RAISE NOTICE 'only the PACKER (%) can use it; approved by %', current_setting('pstest.packer'), current_setting('pstest.approver');
END $$;
COMMIT;
SQL
  ;;

simulate-label)
  [ "${CONFIRM:-}" = "SIMULATE-PSTEST-LABEL" ] || { echo "set CONFIRM=SIMULATE-PSTEST-LABEL"; exit 1; }
  run_ok
  PSQL <<'SQL' 2>&1 | sed 's/^NOTICE:  //'
BEGIN;
SELECT set_config('pstest.run', :'run', true), set_config('pstest.fac', :'fac', true);
DO $$
DECLARE t warehouse.packing_tasks%ROWTYPE; p warehouse.packages%ROWTYPE; ship uuid := gen_random_uuid(); ho uuid;
  trk text := '1ZPSTEST' || lpad((floor(random() * 1e10))::bigint::text, 10, '0');
BEGIN
  SELECT pt.* INTO t FROM warehouse.packing_tasks pt JOIN warehouse.fulfillment_orders o ON o.fulfillment_order_id = pt.fulfillment_order_id
   WHERE o.marketplace = 'PSTEST' AND o.external_order_id = current_setting('pstest.run')
     AND pt.facility_id = current_setting('pstest.fac')::uuid AND pt.status NOT IN ('CANCELLED','ABANDONED');
  IF t.packing_task_id IS NULL THEN RAISE EXCEPTION 'no active PSTEST task for this run'; END IF;
  IF t.status <> 'PACKED' THEN RAISE EXCEPTION 'task must be sealed (PACKED) first; it is %', t.status; END IF;
  p := warehouse.packship__current_package(t.packing_task_id);
  IF EXISTS (SELECT 1 FROM warehouse.shipping_handoffs WHERE package_id = p.package_id) THEN RAISE EXCEPTION 'label already simulated'; END IF;
  INSERT INTO warehouse.shipping_handoffs (package_id, shipment_id, carrier_code, service_code, tracking_number, status)
  VALUES (p.package_id, ship, 'UPS', 'GROUND', trk, 'LABEL_PURCHASED') RETURNING shipping_handoff_id INTO ho;
  INSERT INTO warehouse_control.print_jobs (facility_id, job_type, status, package_id, shipping_handoff_id, idempotency_key, completed_at)
  VALUES (t.facility_id, 'SHIPPING_LABEL', 'PRINTED', p.package_id, ho, current_setting('pstest.run') || '-print', clock_timestamp());
  RAISE NOTICE 'TEST LABEL (no real carrier)';
  RAISE NOTICE 'shipmentId     %', ship;
  RAISE NOTICE 'scan tracking  %', trk;
  RAISE NOTICE 'scan package   %', p.package_number;
  RAISE NOTICE 'then outbound  %', current_setting('pstest.run') || '-STG';
END $$;
COMMIT;
SQL
  ;;

status)
  run_ok
  PSQL <<'SQL'
BEGIN READ ONLY;
SELECT 'task ' || pt.task_number || ' status=' || pt.status || ' rowVersion=' || pt.row_version
       || ' blockers=' || coalesce(array_to_string(warehouse.packship__blockers(pt.packing_task_id), ','), '-')
       || E'\nsnapshot ' || (SELECT jsonb_build_object('taskId', s->'packingTaskId', 'items', (SELECT jsonb_agg(jsonb_build_object(
            'barcode', i->'expectedBarcode', 'status', i->'status', 'verified', i->'verifiedQuantity')) FROM jsonb_array_elements(s->'items') i),
            'package', s->'package', 'shipment', s->'shipment', 'printJob', s->'printJob', 'claim', s->'claim', 'evidence', s->'evidence')::text
          FROM (SELECT warehouse.packship__snapshot(pt.packing_task_id, NULL::warehouse.packship_actor_t) s) z)
  FROM warehouse.packing_tasks pt JOIN warehouse.fulfillment_orders o ON o.fulfillment_order_id = pt.fulfillment_order_id
 WHERE o.marketplace = 'PSTEST' AND o.external_order_id = :'run' ORDER BY pt.opened_at DESC LIMIT 1;
-- V0.2 puts the packing task id in context.packingTaskId (barcode_scan_events.task_id references work_tasks)
SELECT 'scan events: ' || count(*) || ' (' || coalesce(string_agg(e.context->>'scanKind' || '=' || e.scan_result::text, ', '
         ORDER BY e.scan_event_id), '-') || ')'
  FROM warehouse_telemetry.barcode_scan_events e
  JOIN warehouse.packing_tasks pt ON pt.packing_task_id::text = e.context->>'packingTaskId'
  JOIN warehouse.fulfillment_orders o ON o.fulfillment_order_id = pt.fulfillment_order_id
 WHERE o.marketplace = 'PSTEST' AND o.external_order_id = :'run';
ROLLBACK;
SQL
  ;;

retire)
  [ "${CONFIRM:-}" = "RETIRE-PSTEST" ] || { echo "set CONFIRM=RETIRE-PSTEST"; exit 1; }
  run_ok
  PSQL <<'SQL'
BEGIN;
UPDATE warehouse.packing_tasks pt SET status = 'CANCELLED'
  FROM warehouse.fulfillment_orders o
 WHERE o.fulfillment_order_id = pt.fulfillment_order_id AND o.marketplace = 'PSTEST' AND o.external_order_id = :'run'
   AND pt.facility_id = :'fac'::uuid AND pt.status NOT IN ('CANCELLED', 'ABANDONED', 'HANDED_TO_CARRIER');
UPDATE warehouse.fulfillment_orders SET order_status = 'CANCELLED'
 WHERE marketplace = 'PSTEST' AND external_order_id = :'run' AND facility_id = :'fac'::uuid;
SELECT 'retired ' || :'run' || ': task cancelled, order cancelled; records kept (tagged PSTEST)';
COMMIT;
SQL
  ;;

*) echo "usage: [RUN=PSTEST-…] bash $0 rehearse|create|approve-weight|simulate-label|status|retire"; exit 2 ;;
esac
