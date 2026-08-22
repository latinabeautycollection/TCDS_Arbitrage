#!/usr/bin/env bash
# Domain 9 Phase C: place provider secrets as mounted files (NODE_ENV=production forbids env://),
# set file:// references on the providers, and load models/pricing/capabilities/budget.
# Keys are read from the box's existing .env and written to 0600 files; they never leave the box.
set -Eeuo pipefail
ENVF=/srv/arb-system/api/.env
SECRETS="$HOME/.domain9-secrets"
export DATABASE_URL="$(grep '^DATABASE_URL=' "$ENVF" | head -1 | cut -d= -f2- | sed 's/sslmode=no-verify/sslmode=require/')"
val(){ grep -iE "^$1=" "$ENVF" | head -1 | cut -d= -f2-; }

install -d -m 700 "$SECRETS"
umask 077
printf '%s' "$(val OPENAI_API_KEY)"    > "$SECRETS/openai_api_key"
printf '%s' "$(val ANTHROPIC_API_KEY)" > "$SECRETS/anthropic_api_key"
chmod 600 "$SECRETS"/openai_api_key "$SECRETS"/anthropic_api_key

# Gemini (Vertex): reference the service-account JSON if one is configured; else leave the ref
# untouched (auth flows through the Phase-4 legacy bridge / ADC) and only fix retention.
GAC="$(val GOOGLE_APPLICATION_CREDENTIALS || true)"
if [ -n "${GAC:-}" ] && [ -f "$GAC" ]; then
  install -m 600 "$GAC" "$SECRETS/gemini_sa.json"
  GEMINI_SQL="UPDATE ai_control.providers SET credential_secret_reference='file://$SECRETS/gemini_sa.json', data_retention_class='STANDARD' WHERE provider_code='GEMINI';"
  echo "gemini: using service-account file"
else
  GEMINI_SQL="UPDATE ai_control.providers SET data_retention_class='STANDARD' WHERE provider_code='GEMINI';"
  echo "gemini: no GOOGLE_APPLICATION_CREDENTIALS file; leaving ref (Vertex ADC via legacy bridge)"
fi
echo "secret files:"; ls -l "$SECRETS"

psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -v gemini_sql="$GEMINI_SQL" <<SQL
BEGIN;
UPDATE ai_control.providers SET credential_secret_reference='file://$SECRETS/openai_api_key',    base_url_reference='https://api.openai.com/v1', data_retention_class='LIMITED', supports_zero_retention=true WHERE provider_code='OPENAI';
UPDATE ai_control.providers SET credential_secret_reference='file://$SECRETS/anthropic_api_key', base_url_reference='https://api.anthropic.com',   data_retention_class='LIMITED', supports_zero_retention=true WHERE provider_code='ANTHROPIC';
:gemini_sql

INSERT INTO ai_control.models
 (provider_id,external_model_id,display_name,model_family,lifecycle_status,context_window_tokens,maximum_output_tokens,
  supports_vision,supports_structured_output,supports_tool_calling,supports_prompt_caching,supports_streaming,supports_reasoning,
  input_price_per_million,cached_input_price_per_million,output_price_per_million)
SELECT p.provider_id,m.external_model_id,m.display_name,m.model_family,m.lifecycle_status,m.context_window_tokens,m.maximum_output_tokens,
       m.supports_vision,m.supports_structured_output,m.supports_tool_calling,m.supports_prompt_caching,m.supports_streaming,m.supports_reasoning,
       m.input_price,m.cached_price,m.output_price
FROM (VALUES
 ('ANTHROPIC','claude-haiku-4-5-20251001','Claude Haiku 4.5','claude-haiku','APPROVED',200000,64000,true,true,true,true,true,false,1.00,0.10,5.00),
 ('OPENAI','gpt-4.1-mini','GPT-4.1 mini','gpt-4.1','APPROVED',1000000,32768,true,true,true,true,true,false,0.40,0.10,1.60),
 ('GEMINI','gemini-2.5-flash','Gemini 2.5 Flash','gemini-2.5','APPROVED',1048576,65536,true,true,true,true,true,false,0.30,0.075,2.50),
 ('GEMINI','gemini-2.5-pro','Gemini 2.5 Pro','gemini-2.5','APPROVED',1048576,65536,true,true,true,true,true,true,1.25,0.31,10.00)
) AS m(pcode,external_model_id,display_name,model_family,lifecycle_status,context_window_tokens,maximum_output_tokens,
       supports_vision,supports_structured_output,supports_tool_calling,supports_prompt_caching,supports_streaming,supports_reasoning,
       input_price,cached_price,output_price)
JOIN ai_control.providers p ON p.provider_code=m.pcode
WHERE NOT EXISTS(SELECT 1 FROM ai_control.models x WHERE x.provider_id=p.provider_id AND x.external_model_id=m.external_model_id);

INSERT INTO ai_control.model_capabilities(model_id,capability_code,capability_score)
SELECT m.model_id,c.cap,100 FROM ai_control.models m
JOIN (VALUES
 ('claude-haiku-4-5-20251001','TEXT_GENERATION'),('claude-haiku-4-5-20251001','STRUCTURED_OUTPUT'),('claude-haiku-4-5-20251001','VISION'),
 ('gpt-4.1-mini','TEXT_GENERATION'),('gpt-4.1-mini','STRUCTURED_OUTPUT'),('gpt-4.1-mini','VISION'),
 ('gemini-2.5-flash','TEXT_GENERATION'),('gemini-2.5-flash','STRUCTURED_OUTPUT'),('gemini-2.5-flash','VISION'),
 ('gemini-2.5-pro','TEXT_GENERATION'),('gemini-2.5-pro','STRUCTURED_OUTPUT'),('gemini-2.5-pro','VISION'),('gemini-2.5-pro','REASONING')
) c(mid,cap) ON m.external_model_id=c.mid
WHERE NOT EXISTS(SELECT 1 FROM ai_control.model_capabilities mc WHERE mc.model_id=m.model_id AND mc.capability_code=c.cap);

INSERT INTO ai_finance.budget_accounts(account_code,source_domain,currency,daily_limit,monthly_limit,per_request_limit,hard_stop,enabled)
SELECT 'DOMAIN9_GLOBAL','DOMAIN_9','USD',50,1000,1.00,true,true
WHERE NOT EXISTS(SELECT 1 FROM ai_finance.budget_accounts WHERE account_code='DOMAIN9_GLOBAL');
COMMIT;

\echo '--- providers ---'
SELECT provider_code,status,credential_secret_reference,data_retention_class FROM ai_control.providers ORDER BY provider_code;
\echo '--- models ---'
SELECT p.provider_code,m.external_model_id,m.lifecycle_status,m.input_price_per_million AS in_M,m.output_price_per_million AS out_M FROM ai_control.models m JOIN ai_control.providers p USING(provider_id) ORDER BY p.provider_code,m.external_model_id;
\echo '--- budget ---'
SELECT account_code,currency,daily_limit,monthly_limit,per_request_limit,enabled FROM ai_finance.budget_accounts;
SQL
echo "PHASE_C_PROVIDER_CONFIG_DONE"
