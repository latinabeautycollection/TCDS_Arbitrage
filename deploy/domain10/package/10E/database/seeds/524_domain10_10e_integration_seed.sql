-- 10E owns these producer schemas; 10B remains owner of event intake/policy decisions.
BEGIN;

INSERT INTO operations.event_sources(source_key,domain_number,service_name,description,enabled)
VALUES('DOMAIN10_ASSURANCE',10,'Communication Assurance Engine','Domain 10E communication assurance producer',true)
ON CONFLICT(source_key) DO NOTHING;

INSERT INTO operations.event_types(event_type,description,default_severity,enabled)
VALUES
 ('COMMUNICATION_ASSURANCE_BREACH','A frozen 10E communication SLO entered breach','HIGH',true),
 ('COMMUNICATION_ASSURANCE_RECOVERY','A previously breached 10E communication SLO recovered','NOTICE',true)
ON CONFLICT(event_type) DO NOTHING;

-- Both events use the same governed payload shape.
WITH schema_def AS(
  SELECT
  '{
    "type":"object",
    "additionalProperties":false,
    "required":[
      "assurance_event_id","episode_id","run_id","policy_key","policy_version",
      "metric_key","window_start","window_end","metric_value","threshold_value",
      "comparison","sample_size","reason"
    ],
    "properties":{
      "assurance_event_id":{"type":"string"},
      "episode_id":{"type":"string"},
      "run_id":{"type":"string"},
      "policy_key":{"type":"string"},
      "policy_version":{"type":"integer"},
      "metric_key":{"type":"string"},
      "channel":{"type":["string","null"]},
      "provider":{"type":["string","null"]},
      "window_start":{"type":"string"},
      "window_end":{"type":"string"},
      "metric_value":{"type":"number"},
      "threshold_value":{"type":"number"},
      "comparison":{"enum":["LTE","GTE"]},
      "sample_size":{"type":"integer","minimum":0},
      "reason":{"type":"string"}
    }
  }'::jsonb AS js,
  ARRAY[
    'assurance_event_id','episode_id','run_id','policy_key','policy_version',
    'metric_key','window_start','window_end','metric_value','threshold_value',
    'comparison','sample_size','reason'
  ]::text[] AS req,
  '{
    "assurance_event_id":"string",
    "episode_id":"string",
    "run_id":"string",
    "policy_key":"string",
    "policy_version":"number",
    "metric_key":"string",
    "window_start":"string",
    "window_end":"string",
    "metric_value":"number",
    "threshold_value":"number",
    "comparison":"string",
    "sample_size":"number",
    "reason":"string"
  }'::jsonb AS types
)
INSERT INTO operations.event_contract_versions(
  event_type,schema_version,lifecycle_state,json_schema,required_top_level_fields,
  top_level_types,schema_hash,effective_from,frozen_at,frozen_by
)
SELECT event_type,1,'FROZEN',s.js,s.req,s.types,
       encode(extensions.digest(
         s.js::text||E'\n'||array_to_string(s.req,',')||E'\n'||s.types::text,
         'sha256'
       ),'hex'),
       clock_timestamp(),clock_timestamp(),'DOMAIN10_10E_MIGRATION'
FROM schema_def s
CROSS JOIN (
  VALUES('COMMUNICATION_ASSURANCE_BREACH'),
        ('COMMUNICATION_ASSURANCE_RECOVERY')
) v(event_type)
ON CONFLICT(event_type,schema_version) DO NOTHING;

-- Deliberately no 10B notification policy is created here.
-- Operations leadership must bind these event types through normal 10B policy governance.

COMMIT;

DO $$
DECLARE evt text; v_expected text; v_actual text;
BEGIN
  FOREACH evt IN ARRAY ARRAY['COMMUNICATION_ASSURANCE_BREACH','COMMUNICATION_ASSURANCE_RECOVERY'] LOOP
    SELECT encode(extensions.digest(json_schema::text||E'\n'||array_to_string(required_top_level_fields,',')||E'\n'||top_level_types::text,'sha256'),'hex'),schema_hash
    INTO v_expected,v_actual
    FROM operations.event_contract_versions
    WHERE event_type=evt AND schema_version=1;
    IF v_actual IS NULL OR v_actual<>v_expected THEN
      RAISE EXCEPTION '10E event contract verification failed for % v1',evt;
    END IF;
  END LOOP;
END $$;
