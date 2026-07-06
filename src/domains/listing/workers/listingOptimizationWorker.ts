import { ExecutiveListingAnalyticsService } from '../analytics/executiveListingAnalyticsService';

async function main(): Promise<void> {
  const analytics = new ExecutiveListingAnalyticsService();
  const snapshot = await analytics.getExecutiveSnapshot();
  console.log(JSON.stringify({ worker: 'domain4-listing-optimization-worker', status: 'ok', snapshot }, null, 2));
}

if (require.main === module) {
  main().catch((err) => { console.error(err); process.exit(1); });
}
