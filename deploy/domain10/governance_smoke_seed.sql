BEGIN;
-- 1. EMAIL channel go-live (10A authoritative gate)
UPDATE operations.channel_controls SET enabled=true, emergency_stop=false,
  reason='Domain 10 pipeline smoke test', changed_by='INTEGRATION', updated_at=clock_timestamp()
WHERE channel='EMAIL';

-- 2. recipient alerts@ + EMAIL authorization + OPERATIONS membership
INSERT INTO operations.recipient_directory(display_name,email_address,recipient_type,enabled)
SELECT 'TCDS Alerts','alerts@tcdsolutionsgroup.com','EMPLOYEE',true
WHERE NOT EXISTS(SELECT 1 FROM operations.recipient_directory WHERE lower(email_address)='alerts@tcdsolutionsgroup.com');

INSERT INTO operations.recipient_authorizations(recipient_id,event_type_pattern,max_classification,allow_email,allow_sms,approved_by,approval_reference)
SELECT recipient_id,'*','INTERNAL',true,false,'INTEGRATION','domain10-smoke'
FROM operations.recipient_directory WHERE lower(email_address)='alerts@tcdsolutionsgroup.com'
ON CONFLICT(recipient_id,event_type_pattern,max_classification) DO NOTHING;

INSERT INTO operations.audience_members(audience_id,recipient_id,source)
SELECT a.audience_id,r.recipient_id,'MANUAL'
FROM operations.notification_audiences a JOIN operations.recipient_directory r ON lower(r.email_address)='alerts@tcdsolutionsgroup.com'
WHERE a.audience_key='OPERATIONS'
ON CONFLICT(audience_id,recipient_id) DO NOTHING;

-- 3. event type + frozen event contract
INSERT INTO operations.event_types(event_type,description,default_severity,default_classification,incident_capable)
VALUES('DOMAIN10_SMOKE_TEST','Domain 10 pipeline smoke test','NOTICE','INTERNAL',false)
ON CONFLICT(event_type) DO NOTHING;

WITH x AS(SELECT
  '{"type":"object","required":["message"],"properties":{"message":{"type":"string"}},"additionalProperties":false}'::jsonb js,
  ARRAY['message']::text[] req, '{"message":"string"}'::jsonb types)
INSERT INTO operations.event_contract_versions(event_type,schema_version,lifecycle_state,json_schema,required_top_level_fields,top_level_types,schema_hash,frozen_at,frozen_by)
SELECT 'DOMAIN10_SMOKE_TEST',1,'FROZEN',js,req,types,
  encode(extensions.digest(js::text||E'\n'||array_to_string(req,',')||E'\n'||types::text,'sha256'),'hex'),
  clock_timestamp(),'INTEGRATION' FROM x
ON CONFLICT DO NOTHING;

-- 4. EMAIL template + frozen version (static)
INSERT INTO operations.notification_templates(template_key,channel,description)
VALUES('DOMAIN10_SMOKE_EMAIL','EMAIL','Domain 10 smoke test email') ON CONFLICT(template_key) DO NOTHING;

INSERT INTO operations.notification_template_versions(template_id,version,lifecycle_state,subject_template,text_template,html_template,content_hash,frozen_at,frozen_by)
SELECT t.template_id,1,'FROZEN','TCDS Domain 10 pipeline test',
  'Automated delivery: produced by the Domain 10 planner and sent by the delivery worker.',
  '<p>Automated delivery: produced by the Domain 10 planner and sent by the delivery worker.</p>',
  encode(extensions.digest('TCDS Domain 10 pipeline test'||E'\n'||'Automated delivery: produced by the Domain 10 planner and sent by the delivery worker.'||E'\n'||'<p>Automated delivery: produced by the Domain 10 planner and sent by the delivery worker.</p>','sha256'),'hex'),
  clock_timestamp(),'INTEGRATION'
FROM operations.notification_templates t WHERE t.template_key='DOMAIN10_SMOKE_EMAIL'
ON CONFLICT(template_id,version) DO NOTHING;

-- 5. policy + DRAFT version + EMAIL binding, then FREEZE
INSERT INTO operations.notification_policies(policy_key,description)
VALUES('DOMAIN10_SMOKE_POLICY','Domain 10 smoke test policy') ON CONFLICT(policy_key) DO NOTHING;

INSERT INTO operations.notification_policy_versions(policy_id,version,lifecycle_state,event_type_pattern,minimum_severity,maximum_classification,audience_id,email_enabled,sms_enabled,definition_hash)
SELECT p.policy_id,1,'DRAFT','DOMAIN10_SMOKE_TEST','INFORMATIONAL','INTERNAL',a.audience_id,true,false,'DRAFT'
FROM operations.notification_policies p, operations.notification_audiences a
WHERE p.policy_key='DOMAIN10_SMOKE_POLICY' AND a.audience_key='OPERATIONS'
ON CONFLICT(policy_id,version) DO NOTHING;

INSERT INTO operations.policy_channel_templates(policy_id,policy_version,channel,template_id,template_version)
SELECT p.policy_id,1,'EMAIL',t.template_id,1
FROM operations.notification_policies p, operations.notification_templates t
WHERE p.policy_key='DOMAIN10_SMOKE_POLICY' AND t.template_key='DOMAIN10_SMOKE_EMAIL'
ON CONFLICT(policy_id,policy_version,channel) DO NOTHING;

UPDATE operations.notification_policy_versions v
SET lifecycle_state='FROZEN', frozen_at=clock_timestamp(), frozen_by='INTEGRATION'
FROM operations.notification_policies p
WHERE v.policy_id=p.policy_id AND p.policy_key='DOMAIN10_SMOKE_POLICY' AND v.version=1 AND v.lifecycle_state='DRAFT';
COMMIT;

SELECT 'email_channel_enabled='||enabled FROM operations.channel_controls WHERE channel='EMAIL';
SELECT 'policy_state='||v.lifecycle_state FROM operations.notification_policy_versions v JOIN operations.notification_policies p USING(policy_id) WHERE p.policy_key='DOMAIN10_SMOKE_POLICY';
SELECT 'contract_hash='||schema_hash FROM operations.event_contract_versions WHERE event_type='DOMAIN10_SMOKE_TEST';
