-- sql/357: Domain 1 phase-3 cost model — finalized cost defaults (2026-06-23)
ALTER TABLE arb.acquisition_category_policy
  ADD COLUMN IF NOT EXISTS buyers_premium_rate           numeric(12,6) NOT NULL DEFAULT 0.120000,
  ADD COLUMN IF NOT EXISTS ebay_fixed_order_fee_usd      numeric(12,2) NOT NULL DEFAULT 0.40,
  ADD COLUMN IF NOT EXISTS selling_shipping_fallback_usd numeric(12,2) NOT NULL DEFAULT 12.00,
  ADD COLUMN IF NOT EXISTS target_margin_rate            numeric(12,6) NOT NULL DEFAULT 0.300000,
  ADD COLUMN IF NOT EXISTS relaxed_margin_rate           numeric(12,6) NOT NULL DEFAULT 0.220000,
  ADD COLUMN IF NOT EXISTS relaxed_min_profit_usd        numeric(12,2) NOT NULL DEFAULT 60.00;

UPDATE arb.acquisition_category_policy SET
  marketplace_fee_rate = 0.132500, payment_fee_rate = 0.000000, sales_tax_rate = 0.065000,
  packaging_cost_usd = 3.00, return_risk_rate = 0.030000, dispute_risk_rate = 0.010000,
  buyers_premium_rate = 0.120000, ebay_fixed_order_fee_usd = 0.40, selling_shipping_fallback_usd = 12.00,
  target_margin_rate = 0.300000, relaxed_margin_rate = 0.220000, relaxed_min_profit_usd = 60.00
WHERE policy_version = 'acq-domain1-schema-v3';
-- damage/insurance/signature/carrier/warehouse/storage reserves: keep Kieran's defaults
