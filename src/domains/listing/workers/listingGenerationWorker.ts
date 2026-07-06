import { JobQueueRepository } from '../repositories/jobQueueRepository';
import { ListingGenerationService } from '../services/listingGenerationService';

async function main() {
  const queue=new JobQueueRepository();
  const service=new ListingGenerationService();
  const once=process.argv.includes('--once');
  do {
    const job=await queue.claimNext();
    if (!job) { if (once) break; await new Promise(r=>setTimeout(r,5000)); continue; }
    try { await service.generateDraft(Number(job.payload.sourceListingNormalizedId)); await queue.succeed(Number(job.id)); }
    catch(e:any){ await queue.fail(Number(job.id), e.message || String(e)); }
  } while(!once);
}
main().catch(e=>{ console.error(e); process.exit(1); });
