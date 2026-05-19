export const QueueNames = {
  CAPTURE_LISTING: 'forensic.capture.listing',
  CAPTURE_SHIPPING: 'forensic.capture.shipping',
  CAPTURE_PRICING: 'forensic.capture.pricing',
  COMPUTE_LEARNING: 'forensic.compute.learning',
  FINALIZE_RUN: 'forensic.finalize.run',
  CANDIDATE_OPPORTUNITY: 'forensic.candidate.opportunity',
  MARKET_INTEL: 'forensic.market.intel',
  CERTIFICATION: 'forensic.certification'
} as const;

export type QueueName = (typeof QueueNames)[keyof typeof QueueNames];

export const QueueNameList: QueueName[] = Object.values(QueueNames);
