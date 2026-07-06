import { LiveListingFeedback } from '../models/enterpriseListingTypes';

export interface LearningSignal { signalName: string; value: number; interpretation: string; }

export class ClosedLoopLearningEngine {
  extractSignals(feedback: LiveListingFeedback): LearningSignal[] {
    const ctr = ratio(feedback.clicks, feedback.impressions);
    const watcherRate = ratio(feedback.watchers, feedback.clicks || feedback.impressions);
    const conversionRate = ratio(feedback.conversions, feedback.clicks || feedback.impressions);
    const offerRate = ratio(feedback.offersReceived, feedback.clicks || feedback.impressions);
    const returnRate = ratio(feedback.returnCount, Math.max(feedback.conversions, 1));
    const disputeRate = ratio(feedback.disputeCount, Math.max(feedback.conversions, 1));
    return [
      { signalName: 'ctr', value: ctr, interpretation: ctr < 0.01 ? 'Title/primary image likely weak' : 'Search-to-click acceptable' },
      { signalName: 'watcher_rate', value: watcherRate, interpretation: watcherRate < 0.05 ? 'Listing does not create enough consideration' : 'Buyer interest exists' },
      { signalName: 'conversion_rate', value: conversionRate, interpretation: conversionRate < 0.02 ? 'Price, trust, or description may need revision' : 'Conversion acceptable' },
      { signalName: 'offer_rate', value: offerRate, interpretation: offerRate > 0.10 ? 'Buyers see value but price may be high' : 'Offer pressure normal' },
      { signalName: 'return_rate', value: returnRate, interpretation: returnRate > 0.05 ? 'Condition/detail expectation mismatch risk' : 'Return risk controlled' },
      { signalName: 'dispute_rate', value: disputeRate, interpretation: disputeRate > 0.02 ? 'Dispute prevention copy/evidence must improve' : 'Dispute risk controlled' },
    ];
  }
}
function ratio(a: number, b: number): number { return b > 0 ? a / b : 0; }
