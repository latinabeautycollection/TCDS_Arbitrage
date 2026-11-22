-- Strictly gated staging-only role grants needed to run V1.8 SQL adapters.
-- Not a production deployment script: approve DB execution identities and review RLS before applying.
-- No grant to PUBLIC / anon / authenticated / service_role.
BEGIN;
SET LOCAL search_path=pg_catalog,pg_temp;
DO $check$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='tcds_recovery_verifier_v18') OR
    NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='tcds_recovery_otp_v18') OR
    NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='tcds_recovery_delivery_v18') THEN
    RAISE EXCEPTION 'R636_R634_REQUIRED'; END IF;
END $check$;
-- Verifier: auth_sessions access is SELECT only. WebAuthn code must NOT SELECT FOR UPDATE OF s.
-- Passkey row locks require explicit UPDATE for sign_count and are separately reviewed.
-- This file remains STAGING/DBA REVIEW only, not automatic production grants.
GRANT SELECT ON warehouse_identity.auth_sessions,warehouse_identity.employees,
  warehouse_identity.passkeys,warehouse_identity.password_reset_requests TO tcds_recovery_verifier_v18;
GRANT UPDATE (sign_count,last_used_at,row_version) ON warehouse_identity.passkeys TO tcds_recovery_verifier_v18;
GRANT INSERT ON warehouse_identity.auth_challenges,warehouse_identity.webauthn_verification_evidence TO tcds_recovery_verifier_v18;
GRANT EXECUTE ON FUNCTION warehouse_identity.register_password_recovery_stepup_v62(uuid,uuid,uuid,uuid,text,uuid,text)
 TO tcds_recovery_verifier_v18;
-- OTP: read only verified recovery contact and eligible reset; create challenge/proof and restricted outbox.
GRANT SELECT ON warehouse_identity.password_reset_requests,warehouse_identity.user_recovery_contacts,
 warehouse_identity.recovery_contact_challenges_v1 TO tcds_recovery_otp_v18;
GRANT INSERT,UPDATE ON warehouse_identity.recovery_contact_challenges_v1 TO tcds_recovery_otp_v18;
GRANT INSERT ON warehouse_identity.recovery_proofs_v1 TO tcds_recovery_otp_v18;
-- Delivery: only challenge delivery_state changes after provider accepts.
GRANT SELECT ON warehouse_identity.recovery_contact_challenges_v1 TO tcds_recovery_delivery_v18;
GRANT UPDATE (delivery_state) ON warehouse_identity.recovery_contact_challenges_v1 TO tcds_recovery_delivery_v18;
-- RLS policies scoped to exclusively provisioned runtime roles. Never share these DB identities with public clients.
DO $policies$ DECLARE t text;r text;perms text;policy text; BEGIN
 FOR t,r,perms IN SELECT * FROM (VALUES
  ('passkeys','tcds_recovery_verifier_v18','SELECT'),
  ('auth_challenges','tcds_recovery_verifier_v18','INSERT'),
  ('webauthn_verification_evidence','tcds_recovery_verifier_v18','INSERT'),
  ('user_recovery_contacts','tcds_recovery_otp_v18','SELECT'),
  ('recovery_contact_challenges_v1','tcds_recovery_otp_v18','ALL'),
  ('recovery_contact_challenges_v1','tcds_recovery_delivery_v18','ALL'),
  ('recovery_proofs_v1','tcds_recovery_otp_v18','INSERT')) AS v(t,r,perms)
 LOOP
  policy:=left('r636_'||substr(t,1,28)||'_'||substr(r,6,22),63);
  IF EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='warehouse_identity' AND tablename=t AND policyname=policy)
   THEN RAISE EXCEPTION 'R636_DUPLICATE_POLICY:%',policy; END IF;
  IF perms='INSERT' THEN
   EXECUTE format('CREATE POLICY %I ON warehouse_identity.%I FOR INSERT TO %I WITH CHECK (true)',policy,t,r);
  ELSIF perms='SELECT' THEN
   EXECUTE format('CREATE POLICY %I ON warehouse_identity.%I FOR SELECT TO %I USING (true)',policy,t,r);
  ELSE
   EXECUTE format('CREATE POLICY %I ON warehouse_identity.%I FOR ALL TO %I USING (true) WITH CHECK (true)',policy,t,r);
  END IF;
 END LOOP;
END $policies$;
-- Only the FIDO sign_count update is permitted by the grant above.
-- Keep RLS UPDATE access separate from SELECT; no blanket ALL policy on passkeys.
CREATE POLICY r636_passkeys_counter_update ON warehouse_identity.passkeys
 FOR UPDATE TO tcds_recovery_verifier_v18 USING(true) WITH CHECK(true);
DO $verify$ BEGIN
 IF has_function_privilege('anon','warehouse_identity.register_password_recovery_stepup_v62(uuid,uuid,uuid,uuid,text,uuid,text)','EXECUTE')
 OR has_function_privilege('authenticated','warehouse_identity.register_password_recovery_stepup_v62(uuid,uuid,uuid,uuid,text,uuid,text)','EXECUTE')
 THEN RAISE EXCEPTION 'R636_STEPUP_GRANT_EXPOSED'; END IF;
END $verify$;
COMMIT;
