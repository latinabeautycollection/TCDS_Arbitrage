export interface WeatherImpact {
  severity: "NONE" | "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  affected: boolean;
  delayDays?: number;
}

export function scoreWeatherImpact(impact?: WeatherImpact): number {
  if (!impact?.affected) return 0;
  return ({ NONE: 0, LOW: 15, MEDIUM: 35, HIGH: 65, CRITICAL: 90 })[impact.severity];
}
