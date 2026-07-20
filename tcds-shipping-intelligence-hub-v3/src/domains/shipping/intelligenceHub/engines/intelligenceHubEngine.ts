import { randomUUID } from "node:crypto";
import type { AddressValidationGateway } from "../contracts/addressValidationGateway";
import type { RateQuoteGateway } from "../contracts/rateQuoteGateway";
import type { ShippingExecutionGateway } from "../contracts/shippingExecutionGateway";
import type { ShippingIntelligenceHub } from "../contracts/intelligenceDecisionContract";
import type { IntelligenceHubConfig } from "../config/intelligenceHubConfig";
import { modeCanBlock } from "../config/intelligenceHubConfig";
import { classifyDestination } from "../classifiers/destinationClassifier";
import { classifyMailbox } from "../classifiers/mailboxClassifier";
import { classifyAddressRisk } from "../classifiers/addressRiskClassifier";
import { scoreAddressFraud } from "../scoring/addressFraudScorer";
import { evaluateMailboxEligibility } from "../policies/mailboxExclusionPolicy";
import { evaluateDestinationEligibility } from "../policies/destinationEligibilityPolicy";
import { decideInsurance } from "../policies/insurancePolicy";
import { decideSignature } from "../policies/signaturePolicy";
import type { DestinationIntelligence } from "../models/destinationIntelligence";
import type { EvaluationStage, ShippingIntelligenceContext } from "../models/intelligenceContext";
import type { ShippingIntelligenceDecision } from "../models/decisionEvidence";
import type { PricingIntelligence } from "../models/pricingIntelligence";
import { validateIntelligenceContext } from "../validators/intelligenceContextValidator";
import { sha256Canonical } from "../utils/canonicalJson";
import { ZoneProtectionEngine } from "./zoneProtectionEngine";
import { ActualDestinationRateEngine } from "./actualDestinationRateEngine";
import { PresalePricingEngine } from "./presalePricingEngine";
import { CarrierSelectionIntelligenceEngine } from "./carrierSelectionIntelligenceEngine";
import { ShipmentRiskIntelligenceEngine } from "./shipmentRiskIntelligenceEngine";
import { ProfitProtectionIntelligenceEngine } from "./profitProtectionIntelligenceEngine";

export class IntelligenceHubEngine implements ShippingIntelligenceHub {
  private readonly zoneEngine: ZoneProtectionEngine;
  private readonly actualRateEngine: ActualDestinationRateEngine;
  private readonly pricingEngine = new PresalePricingEngine();
  private readonly carrierEngine = new CarrierSelectionIntelligenceEngine();
  private readonly riskEngine = new ShipmentRiskIntelligenceEngine();
  private readonly profitEngine: ProfitProtectionIntelligenceEngine;

  constructor(
    private readonly config: IntelligenceHubConfig,
    private readonly addressGateway: AddressValidationGateway,
    rateGateway: RateQuoteGateway,
    private readonly executionGateway: ShippingExecutionGateway
  ) {
    this.zoneEngine = new ZoneProtectionEngine(rateGateway);
    this.actualRateEngine = new ActualDestinationRateEngine(rateGateway);
    this.profitEngine = new ProfitProtectionIntelligenceEngine(config);
  }

  estimatePresaleShipping(context: ShippingIntelligenceContext): Promise<ShippingIntelligenceDecision> {
    return this.evaluate(context, "PRESALE");
  }

  evaluateSoldOrder(context: ShippingIntelligenceContext): Promise<ShippingIntelligenceDecision> {
    return this.evaluate(context, "SOLD_ORDER");
  }

  authorizeLabel(context: ShippingIntelligenceContext): Promise<ShippingIntelligenceDecision> {
    return this.evaluate(context, "LABEL_AUTHORIZATION");
  }

  async reconcileShipment(shipmentId: number, correlationId: string): Promise<void> {
    if (!Number.isSafeInteger(shipmentId) || shipmentId <= 0) throw new Error("Invalid shipmentId");
    if (correlationId.trim().length < 8) throw new Error("Invalid correlationId");
    await this.executionGateway.requestReconciliation?.(shipmentId, correlationId);
  }

  private async evaluate(
    rawContext: ShippingIntelligenceContext,
    stage: EvaluationStage
  ): Promise<ShippingIntelligenceDecision> {
    const context = validateIntelligenceContext(rawContext, stage);

    if (context.mode === "DISABLED") {
      return this.bypass(context, stage);
    }

    const insurance = decideInsurance(context.salePriceCents / 100);
    const destination = await this.resolveDestination(context, stage);
    const signature = decideSignature({
      totalPaidUsd: context.totalPaidCents / 100,
      destinationClass: destination?.destinationClass ?? "CONTIGUOUS_US",
      highFraudCategory: Boolean(context.highFraudCategory),
      marketplace: context.marketplace
    });

    const requirements = {
      insuranceRequired: insurance.required,
      insuranceValueCents: insurance.insuredValueUsd * 100,
      insuranceMechanism: insurance.required ? "THIRD_PARTY" as const : "NONE" as const,
      signatureRequired: signature.required,
      adultSignatureRequired: signature.adultRequired,
      restrictedDeliveryRequired: signature.restrictedDeliveryRequired,
      tamperEvidenceRequired: context.totalPaidCents >= 25_000,
      serialCaptureRequired: context.salePriceCents >= 10_000,
      digitalWeightAuditRequired: context.totalPaidCents >= 25_000
    };

    const zoneSnapshots = await this.zoneEngine.quoteAnchors(context, requirements);
    const pricing = this.pricingEngine.calculate({
      zoneSnapshots,
      shippingPaidCents: context.shippingPaidCents,
      insuredValueCents: requirements.insuranceValueCents,
      insuranceRequired: requirements.insuranceRequired,
      signatureRequired: requirements.signatureRequired,
      adultSignatureRequired: requirements.adultSignatureRequired,
      restrictedDeliveryRequired: requirements.restrictedDeliveryRequired,
      residential: destination?.residential ?? true,
      remoteArea: destination?.remoteArea ?? false,
      dimensionsVerified: context.packages.every((p) => p.dimensionsVerified),
      weightVerified: context.packages.every((p) => p.weightVerified)
    });

    const actualBatch = stage === "PRESALE"
      ? { quotes: [], failures: [], completedAt: new Date(), complete: true }
      : await this.actualRateEngine.quote(context, requirements);

    const carrier = stage === "PRESALE"
      ? { ranked: [], rejectedQuoteIds: [], noEligibleRate: false, reasonCodes: ["PRESALE_HAS_NO_CARRIER_SELECTION"] }
      : this.carrierEngine.select({
          quotes: actualBatch.quotes,
          now: new Date(),
          maxQuoteAgeMinutes: this.config.maxCarrierQuoteAgeMinutes,
          destinationClass: destination!.destinationClass,
          requirements: {
            signatureRequired: requirements.signatureRequired,
            adultSignatureRequired: requirements.adultSignatureRequired,
            restrictedDeliveryRequired: requirements.restrictedDeliveryRequired,
            insuranceRequired: requirements.insuranceRequired,
            insuranceMechanism: requirements.insuranceMechanism,
            insuredValueCents: requirements.insuranceValueCents
          }
        });

    pricing.selectedQuote = carrier.selected?.quote;
    pricing.quoteDataComplete = pricing.quoteDataComplete && actualBatch.complete;
    pricing.reasonCodes.push(...actualBatch.failures.map((f) => f.errorCode));

    const fraudScore = destination?.fraudScore ?? 0;
    const risk = this.riskEngine.evaluate({
      destination: destination ?? this.presaleDestination(),
      packages: context.packages,
      selectedQuote: carrier.selected?.quote
        ? {
            ...carrier.selected.quote,
            totalCharge: { amount: carrier.selected.quote.totalChargeCents / 100, currency: "USD" }
          } as never
        : undefined,
      fraudScore
    });

    const expectedShippingCostCents =
      carrier.selected?.quote.totalChargeCents ?? pricing.protectedBaseRateCents;
    const profit = this.profitEngine.evaluate(
      context,
      expectedShippingCostCents,
      pricing.protectedShippingChargeCents
    );

    const destinationPolicy = destination
      ? evaluateDestinationEligibility(destination)
      : { eligible: true, manualReview: false, reasonCodes: [] };

    const hardPolicyFailure = Boolean(destination && !destinationPolicy.eligible);
    const incompleteData =
      !pricing.quoteDataComplete ||
      !pricing.quoteDataFresh ||
      (stage !== "PRESALE" && !actualBatch.complete);
    const highRisk = risk.riskBand === "CRITICAL" || risk.riskBand === "HIGH";

    let status: "ALLOW" | "ALLOW_WITH_REQUIREMENTS" | "REPRICE" | "REQUOTE" | "MANUAL_REVIEW" | "REJECT";
    if (hardPolicyFailure) status = modeCanBlock(context.mode) ? "REJECT" : "MANUAL_REVIEW";
    else if (incompleteData) status = "REQUOTE";
    else if (stage !== "PRESALE" && carrier.noEligibleRate) status = "REQUOTE";
    else if (!profit.profitFloorPassed) status = "REPRICE";
    else if (highRisk) status = "MANUAL_REVIEW";
    else if (requirements.insuranceRequired || requirements.signatureRequired) status = "ALLOW_WITH_REQUIREMENTS";
    else status = "ALLOW";

    if (context.mode === "ENFORCE_BLOCKING" && incompleteData) {
      status = "REQUOTE"; // fail closed: never buy a label from stale/partial data
    }

    const protection = {
      status,
      requirements,
      minimumCustomerShippingChargeCents: pricing.protectedShippingChargeCents,
      expectedNetProfitCents: profit.expectedNetProfitCents,
      worstCaseNetProfitCents: profit.worstCaseNetProfitCents,
      protectedMarginPct: profit.worstCaseMarginPct,
      reasonCodes: [
        ...destinationPolicy.reasonCodes,
        ...insurance.reasonCodes,
        ...signature.reasonCodes,
        ...profit.reasonCodes,
        ...risk.reasonCodes,
        ...pricing.reasonCodes,
        ...carrier.reasonCodes,
        `STAGE_${stage}`
      ],
      humanReviewRequired: ["HOLD", "MANUAL_REVIEW", "REJECT"].includes(status)
    };

    const inputHash = sha256Canonical({ context, stage });
    const decisionId = randomUUID();
    const evidenceHash = sha256Canonical({
      decisionId,
      inputHash,
      destination,
      pricing,
      carrier,
      risk,
      profit,
      protection,
      policyVersion: this.config.policyVersion,
      modelVersion: this.config.modelVersion,
      rulesetVersion: this.config.rulesetVersion
    });

    const decision: ShippingIntelligenceDecision = {
      decisionId,
      idempotencyKey: context.idempotencyKey,
      correlationId: context.correlationId,
      stage,
      policyVersion: this.config.policyVersion,
      modelVersion: this.config.modelVersion,
      rulesetVersion: this.config.rulesetVersion,
      createdAt: new Date(),
      inputHash,
      destination,
      pricing,
      carrier,
      risk,
      profit,
      protection,
      evidenceHash,
      explanation: [...new Set(protection.reasonCodes)],
      shadowOnly: ["OBSERVE_ONLY", "SHADOW", "RECOMMEND"].includes(context.mode),
      failClosed: incompleteData || hardPolicyFailure
    };

    await this.executionGateway.persistRecommendation(context, decision);
    return decision;
  }

  private async resolveDestination(
    context: ShippingIntelligenceContext,
    stage: EvaluationStage
  ): Promise<DestinationIntelligence | undefined> {
    if (stage === "PRESALE" || !context.destination) return undefined;

    const validation = await this.addressGateway.validate(context.destination, context.correlationId);
    const normalized = validation.normalized ?? context.destination;
    const destinationClass = classifyDestination(normalized);
    const mailboxClass = classifyMailbox(normalized);
    const mailbox = evaluateMailboxEligibility(mailboxClass);

    const destination: DestinationIntelligence = {
      destinationClass,
      mailboxClass,
      eligible:
        validation.valid &&
        validation.deliveryPointValidated === true &&
        normalized.verifiedMarketplaceAddress === true &&
        mailbox.eligible,
      requiresSignatureByTerritory: destinationClass !== "CONTIGUOUS_US",
      economicServiceTargetDays: destinationClass === "CONTIGUOUS_US" ? undefined : { min: 1, max: 7 },
      normalizedPostalCode: normalized.postalCode.replace(/\s+/g, "").toUpperCase(),
      riskScore: 0,
      fraudScore: 0,
      remoteArea: validation.classifications?.includes("REMOTE") ?? false,
      residential: validation.residential ?? normalized.residential ?? true,
      verifiedMarketplaceAddress: normalized.verifiedMarketplaceAddress === true,
      reasonCodes: [...mailbox.reasonCodes, ...validation.warnings]
    };

    const addressRisk = classifyAddressRisk(normalized, destination);
    destination.riskScore = addressRisk.riskScore;
    destination.reasonCodes.push(...addressRisk.reasonCodes);
    destination.fraudScore = scoreAddressFraud({
      verifiedMarketplaceAddress: destination.verifiedMarketplaceAddress,
      mailboxBlocked: !mailbox.eligible,
      freightForwarder: mailboxClass === "FREIGHT_FORWARDER",
      highFraudCategory: Boolean(context.highFraudCategory),
      totalPaidUsd: context.totalPaidCents / 100
    });
    return destination;
  }

  private bypass(context: ShippingIntelligenceContext, stage: EvaluationStage): ShippingIntelligenceDecision {
    const zeroPricing: PricingIntelligence = {
      protectedBaseRateCents: 0,
      insuranceCostCents: 0,
      signatureCostCents: 0,
      surchargeReserveCents: 0,
      adjustmentReserveCents: 0,
      protectedShippingChargeCents: 0,
      shippingMarginCents: context.shippingPaidCents,
      quoteConfidenceScore: 0,
      quoteDataComplete: false,
      quoteDataFresh: false,
      zoneSnapshots: [],
      reasonCodes: ["HUB_DISABLED"]
    };
    return {
      decisionId: randomUUID(),
      idempotencyKey: context.idempotencyKey,
      correlationId: context.correlationId,
      stage,
      policyVersion: this.config.policyVersion,
      modelVersion: this.config.modelVersion,
      rulesetVersion: this.config.rulesetVersion,
      createdAt: new Date(),
      inputHash: sha256Canonical({ context, stage }),
      pricing: zeroPricing,
      carrier: { ranked: [], rejectedQuoteIds: [], noEligibleRate: false, reasonCodes: ["HUB_DISABLED"] },
      risk: {
        totalRiskScore: 0, deliveryRiskScore: 0, fraudRiskScore: 0,
        claimRiskScore: 0, adjustmentRiskScore: 0, weatherRiskScore: 0,
        riskBand: "LOW", reasonCodes: ["HUB_DISABLED"]
      },
      profit: {
        expectedShippingCostCents: 0, protectedShippingCostCents: 0,
        expectedNetProfitCents: 0, worstCaseNetProfitCents: 0,
        expectedMarginPct: 0, worstCaseMarginPct: 0,
        profitFloorCents: 0, profitFloorPassed: true, repriceRequired: false,
        additionalShippingChargeRequiredCents: 0, reasonCodes: ["HUB_DISABLED"]
      },
      protection: {
        status: "BYPASS",
        requirements: {
          insuranceRequired: false, insuranceValueCents: 0, insuranceMechanism: "NONE",
          signatureRequired: false, adultSignatureRequired: false,
          restrictedDeliveryRequired: false, tamperEvidenceRequired: false,
          serialCaptureRequired: false, digitalWeightAuditRequired: false
        },
        minimumCustomerShippingChargeCents: 0,
        expectedNetProfitCents: 0, worstCaseNetProfitCents: 0, protectedMarginPct: 0,
        reasonCodes: ["HUB_DISABLED"], humanReviewRequired: false
      },
      evidenceHash: sha256Canonical({ disabled: true, idempotencyKey: context.idempotencyKey, stage }),
      explanation: ["HUB_DISABLED"],
      shadowOnly: true,
      failClosed: false
    };
  }

  private presaleDestination(): DestinationIntelligence {
    return {
      destinationClass: "CONTIGUOUS_US",
      mailboxClass: "UNKNOWN",
      eligible: true,
      requiresSignatureByTerritory: false,
      normalizedPostalCode: "",
      riskScore: 0,
      fraudScore: 0,
      remoteArea: false,
      residential: true,
      verifiedMarketplaceAddress: false,
      reasonCodes: ["PRESALE_NO_BUYER_DESTINATION"]
    };
  }
}
