# TCDS Shipping Intelligence Hub v3
V3 is the permanent enterprise architecture for Phase 3 shipping intelligence.

## Core upgrades
- Stage-specific presale, sold-order, label-authorization, and reconciliation contexts.
- Explicit unknown carrier capabilities; unknown never means supported.
- Integer-cent economics and deterministic evidence inherited from v2.
- Quote-batch and quote-item persistence.
- Package and dimensional-weight optimization.
- SKU shipping digital twins.
- Prediction-versus-outcome learning.
- Model drift detection and automatic disable recommendations.
- Historical policy simulation.
- Circuit breaker, retry, and bulkhead primitives.
- Append-only decision versions, feature vectors, confidence history, and model metrics.

## Rollout
Apply migrations 502, 503, and 504 in order. Keep all new flags false. Deploy observe-only, then shadow, gather 30–90 days of outcomes, certify replay and drift metrics, then enable non-blocking and finally blocking controls.
