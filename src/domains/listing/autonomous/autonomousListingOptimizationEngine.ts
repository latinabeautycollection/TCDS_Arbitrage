import { AutonomousRevisionRecommendation, LiveListingFeedback } from '../models/enterpriseListingTypes';

export class AutonomousListingOptimizationEngine {
  recommend(feedback: LiveListingFeedback, current: { title: string; priceUsd: number; descriptionHtml: string; itemSpecifics: Record<string,string> }): AutonomousRevisionRecommendation[] {
    const recs: AutonomousRevisionRecommendation[] = [];
    const ctr = feedback.impressions > 0 ? feedback.clicks / feedback.impressions : 0;
    const conversion = feedback.clicks > 0 ? feedback.conversions / feedback.clicks : 0;
    const returnRate = feedback.conversions > 0 ? feedback.returnCount / feedback.conversions : 0;
    if (feedback.impressions >= 200 && ctr < 0.008) {
      recs.push({ ebayListingFk: feedback.ebayListingFk, revisionType:'TITLE', reason:'Low click-through rate with sufficient impressions; title likely underperforming.', oldValue:current.title, newValue:{ action:'REGENERATE_TITLE_WITH_HIGHER_KEYWORD_COVERAGE' }, expectedImpactScore:0.72, humanApprovalRequired:true });
    }
    if (feedback.clicks >= 50 && conversion < 0.015) {
      recs.push({ ebayListingFk: feedback.ebayListingFk, revisionType:'PRICE', reason:'Traffic exists but conversion is low; price competitiveness review recommended.', oldValue:current.priceUsd, newValue:{ action:'REPRICE_WITHIN_MIN_ACCEPTABLE_RANGE', maxReductionPct:5 }, expectedImpactScore:0.64, humanApprovalRequired:true });
    }
    if (returnRate > 0.05) {
      recs.push({ ebayListingFk: feedback.ebayListingFk, revisionType:'DESCRIPTION', reason:'Return rate exceeds control threshold; improve condition clarity and expectation-setting.', oldValue:'current description', newValue:{ action:'ADD_CONDITION_CLARITY_AND_DEFECT_DISCLOSURE' }, expectedImpactScore:0.83, humanApprovalRequired:true });
    }
    return recs;
  }
}
