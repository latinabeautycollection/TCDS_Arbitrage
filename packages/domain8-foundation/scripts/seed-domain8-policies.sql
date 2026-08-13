-- TCDS Domain 8 initial controlled values and policy baseline
-- Execute after migrations 801-805.
-- The fixed tenant UUID is the initial TCDS enterprise tenant seed and may be
-- replaced by the deployment pipeline before production installation.

BEGIN;

SET LOCAL app.tenant_id = '00000000-0000-0000-0000-000000000008';

INSERT INTO return_defense.status_catalog (
    status_domain, status_code, display_name, description,
    terminal, success_state, sort_order
)
VALUES
('RISK_TIER','GREEN','Green','Automatic progression is permitted when no hard blocker exists.',false,true,10),
('RISK_TIER','GUARDED','Guarded','Progression permitted with required controls.',false,true,20),
('RISK_TIER','ELEVATED','Elevated','Automated or AI-assisted review; human touch only when required.',false,false,30),
('RISK_TIER','HIGH','High','Mandatory supervisor decision.',false,false,40),
('RISK_TIER','CRITICAL','Critical','Hard hold with evidence preservation and executive escalation.',false,false,50),

('REVIEW_LEVEL','AUTO','Automatic','No human review required.',false,true,10),
('REVIEW_LEVEL','AI_ASSISTED','AI Assisted','Rules remain authoritative; AI supplies structured judgment.',false,false,20),
('REVIEW_LEVEL','SUPERVISOR','Supervisor','Authorized supervisor decision required.',false,false,30),
('REVIEW_LEVEL','EXECUTIVE','Executive','Executive decision required due to material exposure.',false,false,40),

('RETURN_LANE','LANE_A_NO_TOUCH','No-Touch','Routine low-risk return automation.',false,true,10),
('RETURN_LANE','LANE_B_AUTO_RETURN_INSPECTION','Auto Return with Inspection','Automated customer flow with mandatory warehouse inspection.',false,true,20),
('RETURN_LANE','LANE_C_EXCEPTION_REVIEW','Exception Review','Human review for material ambiguity or elevated fraud exposure.',false,false,30),
('RETURN_LANE','LANE_D_DEFENSE_HOLD','Defense Hold','Refund automation frozen and evidence preserved.',false,false,40)
ON CONFLICT (status_domain, status_code) DO UPDATE
SET display_name = EXCLUDED.display_name,
    description = EXCLUDED.description,
    terminal = EXCLUDED.terminal,
    success_state = EXCLUDED.success_state,
    sort_order = EXCLUDED.sort_order,
    updated_at = clock_timestamp();

INSERT INTO return_defense.reason_code_catalog (
    reason_code, reason_domain, severity, hard_block_eligible,
    human_review_eligible, display_name, description
)
VALUES
('POLICY_NOT_ACTIVE','GOVERNANCE',100,true,true,'Policy Not Active','No active approved policy is available for the requested scope.'),
('MODEL_NOT_APPROVED','GOVERNANCE',90,true,true,'Model Not Approved','A model was requested that is not approved for active use.'),
('ASSESSMENT_STALE','GOVERNANCE',85,true,true,'Assessment Stale','Material facts changed or the assessment exceeded its freshness window.'),
('EVIDENCE_HASH_INVALID','EVIDENCE',100,true,true,'Evidence Hash Invalid','At least one required evidence reference failed integrity verification.'),
('DUPLICATE_FINANCIAL_RECOVERY','FINANCIAL',100,true,true,'Duplicate Recovery Risk','A refund, credit, reimbursement, settlement, or recovery may duplicate an existing entitlement.'),
('SERIAL_IDENTITY_CONFLICT','IDENTITY',100,true,true,'Serial Identity Conflict','Expected and observed serialized identities conflict.'),
('SOURCE_RECOVERY_WINDOW_AT_RISK','SOURCE_RECOVERY',75,false,true,'Source Recovery Window at Risk','Receiving or verification may not finish before the source remedy deadline.'),
('INSURANCE_REQUIREMENT_MISSING','SHIPPING',90,true,true,'Insurance Missing','Shipment protection is below the approved minimum.'),
('SIGNATURE_REQUIREMENT_MISSING','SHIPPING',90,true,true,'Signature Missing','Required delivery signature protection is absent.'),
('RESTRICTED_DELIVERY_MISSING','SHIPPING',95,true,true,'Restricted Delivery Missing','Required restricted delivery protection is absent.'),
('MANUAL_OVERRIDE_PRESENT','EXECUTION',65,false,true,'Manual Override Present','A manual override reduced evidence reliability or bypassed a normal control.')
ON CONFLICT (reason_code) DO UPDATE
SET reason_domain = EXCLUDED.reason_domain,
    severity = EXCLUDED.severity,
    hard_block_eligible = EXCLUDED.hard_block_eligible,
    human_review_eligible = EXCLUDED.human_review_eligible,
    display_name = EXCLUDED.display_name,
    description = EXCLUDED.description,
    updated_at = clock_timestamp();

INSERT INTO return_defense.control_definitions (
    control_code, control_domain, display_name, description,
    control_type, evidence_required, can_be_waived
)
VALUES
('CONTROL_POLICY_ACTIVE','GOVERNANCE','Active Policy','An approved active policy must exist for the decision scope.','PREVENTIVE',true,false),
('CONTROL_ASSESSMENT_FRESH','GOVERNANCE','Fresh Assessment','Assessment inputs must remain unchanged and within freshness limits.','PREVENTIVE',true,false),
('CONTROL_EVIDENCE_HASH_VALID','EVIDENCE','Evidence Integrity','All required evidence references and hashes must validate.','EVIDENCE',true,false),
('CONTROL_SERIAL_VERIFIED','IDENTITY','Serial Verification','Serialized identity must match the expected item.','DETECTIVE',true,false),
('CONTROL_INCIDENT_RECONCILED','FINANCIAL','Incident Reconciliation','All refunds, recoveries and write-offs must reconcile at incident level.','FINANCIAL',true,false),
('CONTROL_INSURANCE_REQUIRED','SHIPPING','Insurance Required','Shipment must carry policy-required insurance.','PREVENTIVE',true,false),
('CONTROL_DELIVERY_CONFIRMATION_REQUIRED','SHIPPING','Delivery Confirmation Required','Shipment must include policy-required delivery confirmation.','PREVENTIVE',true,false),
('CONTROL_SIGNATURE_REQUIRED','SHIPPING','Signature Required','Shipment must include policy-required signature service.','PREVENTIVE',true,false),
('CONTROL_RESTRICTED_DELIVERY_REQUIRED','SHIPPING','Restricted Delivery Required','Shipment must include policy-required restricted delivery.','PREVENTIVE',true,false),
('CONTROL_SUPERVISOR_REVIEW','REVIEW','Supervisor Review','Authorized supervisor review must be completed.','MANUAL_REVIEW',true,false)
ON CONFLICT (control_code) DO UPDATE
SET control_domain = EXCLUDED.control_domain,
    display_name = EXCLUDED.display_name,
    description = EXCLUDED.description,
    control_type = EXCLUDED.control_type,
    evidence_required = EXCLUDED.evidence_required,
    can_be_waived = EXCLUDED.can_be_waived,
    updated_at = clock_timestamp();

INSERT INTO return_defense.policy_versions (
    tenant_id,
    policy_key,
    version,
    status,
    scope_type,
    scope_key,
    policy_document,
    change_summary,
    approved_by,
    approved_at,
    effective_at
)
VALUES (
    '00000000-0000-0000-0000-000000000008',
    'DOMAIN8_ENTERPRISE_BASELINE',
    1,
    'ACTIVE',
    'GLOBAL',
    '*',
    jsonb_build_object(
        'risk_tiers', jsonb_build_object(
            'green', jsonb_build_object('min',0,'max',19),
            'guarded', jsonb_build_object('min',20,'max',39),
            'elevated', jsonb_build_object('min',40,'max',59),
            'high', jsonb_build_object('min',60,'max',79),
            'critical', jsonb_build_object('min',80,'max',100)
        ),
        'shipment_protection_floor', jsonb_build_array(
            jsonb_build_object('min_value_usd',0,'max_value_usd',99.99,'insurance',false,'delivery_confirmation',false,'signature',false,'restricted_delivery',false),
            jsonb_build_object('min_value_usd',100,'max_value_usd',249.99,'insurance',true,'delivery_confirmation',false,'signature',false,'restricted_delivery',false),
            jsonb_build_object('min_value_usd',250,'max_value_usd',499.99,'insurance',true,'delivery_confirmation',true,'signature',false,'restricted_delivery',false),
            jsonb_build_object('min_value_usd',500,'max_value_usd',999.99,'insurance',true,'delivery_confirmation',true,'signature',true,'restricted_delivery',false),
            jsonb_build_object('min_value_usd',1000,'max_value_usd',null,'insurance',true,'delivery_confirmation',true,'signature',true,'restricted_delivery',true)
        ),
        'automation', jsonb_build_object(
            'model_only_hard_block_allowed', false,
            'ai_fraud_accusation_allowed', false,
            'automatic_refund_on_conflicting_states', false,
            'automatic_submission_on_invalid_evidence_hash', false
        ),
        'ten_gates', jsonb_build_array(
            'RETAIL_SOURCE_QUALITY',
            'ACQUISITION_PROFIT_DEFENSE',
            'SOURCE_RECOVERY_WINDOW',
            'RECEIVING_IDENTITY',
            'INVENTORY_INTEGRITY',
            'LISTING_DEFENSIBILITY',
            'ORDER_FULFILLMENT',
            'PACKING_SHIPMENT_RELEASE',
            'DELIVERY_INTERVENTION',
            'RETURN_DISPUTE_RECOVERY'
        )
    ),
    'Initial Fortune 500-grade Domain 8 governance baseline.',
    '00000000-0000-0000-0000-000000000001',
    clock_timestamp(),
    clock_timestamp()
)
ON CONFLICT (tenant_id, policy_key, version, scope_type, scope_key)
DO NOTHING;

WITH active_policy AS (
    SELECT policy_version_id
    FROM return_defense.policy_versions
    WHERE tenant_id = '00000000-0000-0000-0000-000000000008'
      AND policy_key = 'DOMAIN8_ENTERPRISE_BASELINE'
      AND version = 1
      AND scope_type = 'GLOBAL'
      AND scope_key = '*'
)
INSERT INTO return_defense.risk_thresholds (
    tenant_id,
    threshold_key,
    version,
    gate_stage,
    scope_type,
    scope_key,
    green_max,
    guarded_max,
    elevated_max,
    high_max,
    critical_max,
    review_rules,
    effective_at,
    active,
    policy_version_id,
    approved_by,
    approved_at
)
SELECT
    '00000000-0000-0000-0000-000000000008',
    'STANDARD_RISK_TIERS',
    1,
    gate_stage,
    'GLOBAL',
    '*',
    19, 39, 59, 79, 100,
    jsonb_build_object(
        'green','AUTO',
        'guarded','AUTO_WITH_CONTROLS',
        'elevated','AI_ASSISTED_OR_RULES_REVIEW',
        'high','SUPERVISOR',
        'critical','EXECUTIVE_HOLD'
    ),
    clock_timestamp(),
    true,
    active_policy.policy_version_id,
    '00000000-0000-0000-0000-000000000001',
    clock_timestamp()
FROM active_policy
CROSS JOIN (
    VALUES
    ('RETAIL_SOURCE_QUALITY'),
    ('ACQUISITION_PROFIT_DEFENSE'),
    ('SOURCE_RECOVERY_WINDOW'),
    ('RECEIVING_IDENTITY'),
    ('INVENTORY_INTEGRITY'),
    ('LISTING_DEFENSIBILITY'),
    ('ORDER_FULFILLMENT'),
    ('PACKING_SHIPMENT_RELEASE'),
    ('DELIVERY_INTERVENTION'),
    ('RETURN_DISPUTE_RECOVERY')
) AS gates(gate_stage)
ON CONFLICT (
    tenant_id, threshold_key, version, gate_stage, scope_type, scope_key
) DO NOTHING;

COMMIT;
