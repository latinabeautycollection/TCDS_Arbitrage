-- TCDS enterprise_org v0.3a -- our addendum to the vendor's v0.3 migration (applied in the same transaction).
-- 1. One current holder per position. The vendor's index is unique per (person, position), which lets two
--    people be ACTIVE in the same position at once. A successor may still be PENDING_VERIFICATION while the
--    current holder is ACTIVE, so only ACTIVE/ON_LEAVE are limited to one.
-- 2. A person may not leave VERIFIED (to PENDING_VERIFICATION or INACTIVE) while an appointment is ACTIVE or
--    ON_LEAVE. The vendor's trigger only blocked INACTIVE.

CREATE UNIQUE INDEX ux_enterprise_org_one_current_holder
  ON enterprise_org.leadership_appointments(position_code)
  WHERE appointment_status IN ('ACTIVE','ON_LEAVE');

-- CREATE OR REPLACE keeps the owner, grants and the existing trigger binding.
CREATE OR REPLACE FUNCTION enterprise_org.bump_person_version_v1()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog AS $f$
BEGIN
  NEW.row_version := OLD.row_version + 1;
  NEW.updated_at := clock_timestamp();
  IF OLD.iam_user_id IS NOT NULL AND NEW.iam_user_id IS DISTINCT FROM OLD.iam_user_id THEN
    RAISE EXCEPTION 'IAM_BINDING_IMMUTABLE_AFTER_VERIFICATION' USING ERRCODE='23514';
  END IF;
  IF NEW.record_status <> 'VERIFIED' AND EXISTS (
      SELECT 1 FROM enterprise_org.leadership_appointments a
       WHERE a.person_id=NEW.person_id AND a.appointment_status IN ('ACTIVE','ON_LEAVE')
  ) THEN
    RAISE EXCEPTION 'ACTIVE_APPOINTMENTS_MUST_END_BEFORE_PERSON_LEAVES_VERIFIED' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $f$;

REVOKE ALL ON FUNCTION enterprise_org.bump_person_version_v1() FROM PUBLIC, anon, authenticated;

DO $verify$
BEGIN
  IF to_regclass('enterprise_org.ux_enterprise_org_one_current_holder') IS NULL THEN
    RAISE EXCEPTION 'V0_3A_HOLDER_INDEX_MISSING';
  END IF;
  IF position('PERSON_LEAVES_VERIFIED' IN pg_get_functiondef('enterprise_org.bump_person_version_v1()'::regprocedure)) = 0 THEN
    RAISE EXCEPTION 'V0_3A_PERSON_GUARD_NOT_REPLACED';
  END IF;
  IF (SELECT count(*) FROM pg_policies WHERE schemaname='enterprise_org') <> 0 THEN
    RAISE EXCEPTION 'V0_3A_UNEXPECTED_POLICIES';
  END IF;
END $verify$;
