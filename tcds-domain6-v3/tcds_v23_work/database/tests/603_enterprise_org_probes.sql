-- Leadership IAM probes. Synthetic data only. Run inside a transaction that ends in ROLLBACK.
INSERT INTO enterprise_org.positions(position_code,position_title,function_key,executive_all_modules)
VALUES ('QA_CEO','QA Chief Executive','EXECUTIVE',true), ('QA_MGR','QA Manager','WAREHOUSE',false);
INSERT INTO enterprise_org.leadership_people(person_key,full_name)
VALUES ('QA_PERSON_A','QA Person A'), ('QA_PERSON_B','QA Person B');

CREATE FUNCTION pg_temp.expect_fail(label text, stmt text) RETURNS text LANGUAGE plpgsql AS $$
BEGIN
  -- An allowed statement is undone too, so one probe never changes the data the next one sees.
  BEGIN
    EXECUTE stmt;
    RAISE EXCEPTION USING ERRCODE = 'P0099';
  EXCEPTION
    WHEN SQLSTATE 'P0099' THEN RETURN label || ' | ALLOWED';
    WHEN OTHERS THEN RETURN label || ' | BLOCKED (' || SQLERRM || ')';
  END;
END $$;

CREATE FUNCTION pg_temp.verify(key text) RETURNS void LANGUAGE sql AS $$
  UPDATE enterprise_org.leadership_people SET record_status='VERIFIED', iam_user_id=pg_catalog.gen_random_uuid(),
    iam_link_authority='QA', iam_link_evidence_reference='QA', iam_link_verified_at=pg_catalog.clock_timestamp()
  WHERE person_key=key;
$$;

-- 1. An unverified person cannot be activated.
INSERT INTO enterprise_org.leadership_appointments(person_id,position_code)
SELECT person_id,'QA_CEO' FROM enterprise_org.leadership_people WHERE person_key='QA_PERSON_A';
SELECT pg_temp.expect_fail('t1 activate unverified person (want BLOCKED)', $q$
  UPDATE enterprise_org.leadership_appointments a SET appointment_status='ACTIVE', effective_from=CURRENT_DATE,
    approved_by_iam_user_id=gen_random_uuid(), approval_reference='QA', approved_at=clock_timestamp()
  FROM enterprise_org.leadership_people p WHERE p.person_id=a.person_id AND p.person_key='QA_PERSON_A'$q$);

-- 2. Verify A, then activate.
SELECT pg_temp.verify('QA_PERSON_A');
UPDATE enterprise_org.leadership_appointments a SET appointment_status='ACTIVE', effective_from=CURRENT_DATE,
  approved_by_iam_user_id=gen_random_uuid(), approval_reference='QA', approved_at=clock_timestamp()
FROM enterprise_org.leadership_people p WHERE p.person_id=a.person_id AND p.person_key='QA_PERSON_A';
SELECT 't2 activate verified person (want ACTIVE) | ' || a.appointment_status || ' row_version=' || a.row_version
FROM enterprise_org.leadership_appointments a JOIN enterprise_org.leadership_people p USING (person_id) WHERE p.person_key='QA_PERSON_A';

-- 3. A successor may be pending, but a second ACTIVE holder of the same position is refused.
SELECT pg_temp.verify('QA_PERSON_B');
SELECT pg_temp.expect_fail('t3a pending successor for QA_CEO (want ALLOWED)', $q$
  INSERT INTO enterprise_org.leadership_appointments(person_id,position_code)
  SELECT person_id,'QA_CEO' FROM enterprise_org.leadership_people WHERE person_key='QA_PERSON_B'$q$);
SELECT pg_temp.expect_fail('t3b second ACTIVE holder of QA_CEO (want BLOCKED)', $q$
  INSERT INTO enterprise_org.leadership_appointments(person_id,position_code,appointment_status,effective_from,
    approved_by_iam_user_id,approval_reference,approved_at)
  SELECT person_id,'QA_CEO','ACTIVE',CURRENT_DATE,gen_random_uuid(),'QA',clock_timestamp()
  FROM enterprise_org.leadership_people WHERE person_key='QA_PERSON_B'$q$);

-- 4. Same person, same position, twice.
SELECT pg_temp.expect_fail('t4 duplicate current appointment same person (want BLOCKED)', $q$
  INSERT INTO enterprise_org.leadership_appointments(person_id,position_code)
  SELECT person_id,'QA_CEO' FROM enterprise_org.leadership_people WHERE person_key='QA_PERSON_A'$q$);

-- 5. Reporting cycle.
INSERT INTO enterprise_org.leadership_appointments(person_id,position_code)
SELECT person_id,'QA_MGR' FROM enterprise_org.leadership_people WHERE person_key='QA_PERSON_B';
UPDATE enterprise_org.leadership_appointments SET reports_to_appointment_id=(
  SELECT appointment_id FROM enterprise_org.leadership_appointments WHERE position_code='QA_CEO')
WHERE position_code='QA_MGR';
SELECT pg_temp.expect_fail('t5 reporting cycle (want BLOCKED)', $q$
  UPDATE enterprise_org.leadership_appointments SET reports_to_appointment_id=(
    SELECT appointment_id FROM enterprise_org.leadership_appointments WHERE position_code='QA_MGR')
  WHERE position_code='QA_CEO'$q$);

-- 6. Deactivate a person with an active appointment.
SELECT pg_temp.expect_fail('t6 deactivate person with active appointment (want BLOCKED)', $q$
  UPDATE enterprise_org.leadership_people SET record_status='INACTIVE' WHERE person_key='QA_PERSON_A'$q$);

-- 7. Downgrade a verified person while their appointment stays ACTIVE.
SELECT pg_temp.expect_fail('t7 un-verify person with active appointment (want BLOCKED)', $q$
  UPDATE enterprise_org.leadership_people SET record_status='PENDING_VERIFICATION' WHERE person_key='QA_PERSON_A'$q$);

-- 8. Change the IAM binding after verification.
SELECT pg_temp.expect_fail('t8 change iam_user_id after verification (want BLOCKED)', $q$
  UPDATE enterprise_org.leadership_people SET iam_user_id=gen_random_uuid() WHERE person_key='QA_PERSON_A'$q$);

-- 9. Bad contact format.
SELECT pg_temp.expect_fail('t9 malformed phone (want BLOCKED)', $q$
  INSERT INTO enterprise_org.contact_points(person_id,contact_type,contact_value)
  SELECT person_id,'PHONE','555-1234' FROM enterprise_org.leadership_people WHERE person_key='QA_PERSON_A'$q$);

-- 10. A verified person with no active appointment can still be moved back to pending.
SELECT pg_temp.expect_fail('t10 un-verify person with only a pending appointment (want ALLOWED)', $q$
  UPDATE enterprise_org.leadership_people SET record_status='PENDING_VERIFICATION' WHERE person_key='QA_PERSON_B'$q$);

-- 11. After the holder's appointment ends, a successor can become ACTIVE.
SELECT pg_temp.expect_fail('t11 successor ACTIVE after holder ENDED (want ALLOWED)', $q$
  WITH ended AS (
    UPDATE enterprise_org.leadership_appointments SET appointment_status='ENDED', effective_until=CURRENT_DATE,
      ended_at=clock_timestamp(), reports_to_appointment_id=NULL
    WHERE position_code='QA_CEO' RETURNING 1)
  INSERT INTO enterprise_org.leadership_appointments(person_id,position_code,appointment_status,effective_from,
    approved_by_iam_user_id,approval_reference,approved_at)
  SELECT person_id,'QA_CEO','ACTIVE',CURRENT_DATE,gen_random_uuid(),'QA',clock_timestamp()
  FROM enterprise_org.leadership_people, (SELECT count(*) FROM ended) e WHERE person_key='QA_PERSON_B'$q$);
