-- 10B seed intentionally does NOT freeze arbitrary production event schemas.
-- Each originating domain must provide and approve its exact payload contract.
-- This file seeds declarative audience resolvers for the audiences created by 10A.

BEGIN;

INSERT INTO operations.audience_resolution_rules(
  audience_id,resolver_type,recipient_types
)
SELECT audience_id,
       CASE
         WHEN audience_key='ALL_COMPANY' THEN 'ALL_ENABLED'
         ELSE 'STATIC_MEMBERSHIP'
       END,
       ARRAY['OWNER','EXECUTIVE','EMPLOYEE','CONTRACTOR']::text[]
FROM operations.notification_audiences
WHERE audience_key IN(
  'ALL_COMPANY','EXECUTIVE_TEAM','OPERATIONS',
  'SHIPPING_OPERATIONS','RETURNS_DISPUTES','ON_CALL_OPERATIONS'
)
ON CONFLICT(audience_id) DO NOTHING;

COMMIT;
