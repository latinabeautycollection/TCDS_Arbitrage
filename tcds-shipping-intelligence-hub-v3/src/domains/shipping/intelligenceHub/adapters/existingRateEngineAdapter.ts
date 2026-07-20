import type { RateQuoteGateway, RateQuoteRequest } from "../contracts/rateQuoteGateway";
import type { RateQuote, RateQuoteBatch } from "../models/pricingIntelligence";

export interface ExistingRateEngine {
  quote(request: Record<string, unknown>): Promise<Array<Record<string, unknown>>>;
}

export interface RateAdapterOptions {
  timeoutMs: number;
  maxAttempts: number;
  baseDelayMs: number;
  sourceSystem: string;
}

const finite = (value: unknown): number | undefined => {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : undefined;
};

const requiredBoolean = (value: unknown): boolean => value === true;

export class ExistingRateEngineAdapter implements RateQuoteGateway {
  constructor(
    private readonly existing: ExistingRateEngine,
    private readonly options: RateAdapterOptions
  ) {}

  async getRates(request: RateQuoteRequest): Promise<RateQuoteBatch> {
    let lastError: Error | undefined;

    for (let attempt = 1; attempt <= this.options.maxAttempts; attempt += 1) {
      try {
        const rows = await this.withTimeout(
          this.existing.quote(request as unknown as Record<string, unknown>),
          this.options.timeoutMs
        );

        const quotes: RateQuote[] = [];
        const failures: RateQuoteBatch["failures"] = [];

        rows.forEach((row, index) => {
          const chargeDollars = finite(row.totalChargeUsd ?? row.quoted_label_cost_usd);
          const carrier = String(row.carrierCode ?? row.carrier_code ?? "").trim().toUpperCase();
          const service = String(row.serviceCode ?? row.service_code ?? "").trim();
          const days = finite(row.estimatedDeliveryBusinessDays ?? row.estimatedDeliveryDays ?? row.estimated_delivery_days);

          if (!carrier || !service || chargeDollars === undefined || chargeDollars < 0) {
            failures.push({
              requestId: request.requestId,
              carrierCode: carrier || undefined,
              errorCode: "MALFORMED_RATE_ROW",
              retryable: false,
              message: `Malformed rate row at index ${index}`
            });
            return;
          }

          quotes.push({
            quoteId: String(row.quoteId ?? `${request.requestId}:${index}`),
            requestId: request.requestId,
            purpose: request.purpose,
            carrierCode: carrier,
            serviceCode: service,
            serviceName: String(row.serviceName ?? row.service_name ?? service),
            totalChargeCents: Math.round(chargeDollars * 100),
            currency: "USD",
            quotedAt: new Date(String(row.quotedAt ?? new Date().toISOString())),
            validUntil: row.validUntil ? new Date(String(row.validUntil)) : undefined,
            estimatedDeliveryBusinessDays: days,
            commitmentType:
              row.commitmentType === "GUARANTEED" || row.commitmentType === "ESTIMATED"
                ? row.commitmentType
                : "UNKNOWN",
            trackingQualityScore: finite(row.trackingQualityScore ?? row.tracking_quality_score),
            onTimeProbability: finite(row.onTimeProbability ?? row.on_time_probability),
            supportsSignature: requiredBoolean(row.supportsSignature),
            supportsAdultSignature: requiredBoolean(row.supportsAdultSignature),
            supportsRestrictedDelivery: requiredBoolean(row.supportsRestrictedDelivery),
            insuranceMechanisms: Array.isArray(row.insuranceMechanisms)
              ? row.insuranceMechanisms.filter((x): x is "NONE" | "CARRIER_DECLARED_VALUE" | "THIRD_PARTY" =>
                  x === "NONE" || x === "CARRIER_DECLARED_VALUE" || x === "THIRD_PARTY")
              : [],
            declaredValueLimitCents: finite(row.declaredValueLimitUsd) !== undefined
              ? Math.round(finite(row.declaredValueLimitUsd)! * 100)
              : undefined,
            destinationPostalCode: request.destination.postalCode,
            destinationAnchor: request.purpose === "ZONE_ANCHOR"
              ? String((request as unknown as Record<string, unknown>).anchorKey ?? "")
              : undefined,
            sourceSystem: this.options.sourceSystem,
            raw: row
          });
        });

        return {
          quotes,
          failures,
          completedAt: new Date(),
          complete: failures.length === 0
        };
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        if (attempt < this.options.maxAttempts) {
          await new Promise((resolve) =>
            setTimeout(resolve, this.options.baseDelayMs * 2 ** (attempt - 1))
          );
        }
      }
    }

    return {
      quotes: [],
      failures: [{
        requestId: request.requestId,
        errorCode: "RATE_GATEWAY_EXHAUSTED",
        retryable: true,
        message: lastError?.message ?? "Unknown rate gateway failure"
      }],
      completedAt: new Date(),
      complete: false
    };
  }

  private async withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
    let timer: NodeJS.Timeout | undefined;
    try {
      return await Promise.race([
        promise,
        new Promise<T>((_, reject) => {
          timer = setTimeout(() => reject(new Error("RATE_GATEWAY_TIMEOUT")), timeoutMs);
        })
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
}
