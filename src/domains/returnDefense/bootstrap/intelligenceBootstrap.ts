
import type { Express } from "express";
import type { Pool } from "pg";
import { buildIntelligenceRoutes } from "../routes/intelligenceRoutes";
import { buildRecommendationRoutes } from "../routes/recommendationRoutes";
import { buildExecutiveScorecardRoutes } from "../routes/executiveScorecardRoutes";

export function mountDomain8Intelligence(app: Express, pool: Pool): void {
  app.use(buildIntelligenceRoutes(pool));
  app.use(buildRecommendationRoutes(pool));
  app.use(buildExecutiveScorecardRoutes(pool));
}
