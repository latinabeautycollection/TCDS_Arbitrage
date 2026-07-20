import type { DestinationIntelligence } from "../models/destinationIntelligence";
import type { PackageInput } from "../models/intelligenceContext";
import type { RateQuote } from "../models/pricingIntelligence";
import type { RiskDecision } from "../models/riskDecision";
import { classifyPackageRisk } from "../classifiers/packageRiskClassifier";
import { scoreDeliveryRisk } from "../scoring/deliveryRiskScorer";
import { forecastClaimProbability } from "../forecasting/claimProbabilityForecaster";

export class ShipmentRiskIntelligenceEngine {
  evaluate(input: {
    destination: DestinationIntelligence;
    packages: PackageInput[];
    selectedQuote?: RateQuote;
    fraudScore: number;
    weatherRiskScore?: number;
  }): RiskDecision {
    const pkg = classifyPackageRisk(input.packages);
    const delivery = scoreDeliveryRisk({
      onTimeProbability: input.selectedQuote?.onTimeProbability,
      trackingQualityScore: input.selectedQuote?.trackingQualityScore,
      destinationRiskScore: input.destination.riskScore,
      packageRiskScore: pkg.score
    });
    const claimProbability = forecastClaimProbability({
      fraudScore: input.fraudScore,
      packageRiskScore: pkg.score
    });
    const claimRiskScore = claimProbability * 100;
    const adjustmentRiskScore = pkg.score;
    const weatherRiskScore = input.weatherRiskScore ?? 0;
    const total = Math.min(100,
      delivery * 0.35 +
      input.fraudScore * 0.25 +
      claimRiskScore * 0.20 +
      adjustmentRiskScore * 0.15 +
      weatherRiskScore * 0.05
    );
    const riskBand = total >= 85 ? "CRITICAL" : total >= 70 ? "HIGH" : total >= 40 ? "MEDIUM" : "LOW";
    return {
      totalRiskScore: total,
      deliveryRiskScore: delivery,
      fraudRiskScore: input.fraudScore,
      claimRiskScore,
      adjustmentRiskScore,
      weatherRiskScore,
      riskBand,
      reasonCodes: [...pkg.reasonCodes, `RISK_BAND_${riskBand}`]
    };
  }
}
