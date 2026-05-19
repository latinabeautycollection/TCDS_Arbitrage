import { Job } from 'bullmq';
import { withTx } from '../db/tx';
import { createWorker } from '../queues/bullmq';
import { CandidateRepository } from '../repositories/candidateRepository';
import { OpportunityQueueRepository } from '../repositories/opportunityQueueRepository';
import { ProcessRunRepository } from '../repositories/processRunRepository';
import { ProcessStepRepository } from '../repositories/processStepRepository';
import { ForensicEventRepository } from '../repositories/forensicEventRepository';
import { MutationLedgerRepository } from '../repositories/mutationLedgerRepository';
import { ProductJournalRepository } from '../repositories/productJournalRepository';
import { PhaseSummaryRepository } from '../repositories/phaseSummaryRepository';
import { DeadLetterRepository } from '../repositories/deadLetterRepository';
import { QueueIdempotencyRepository } from '../repositories/queueIdempotencyRepository';
import { UserActorRepository } from '../repositories/userActorRepository';

const QUEUE = 'forensic.candidate.opportunity';
const PROCESS = 'forensic.candidate_opportunity';
const WORKER = 'candidateOpportunityWorker';
const actorRepo = new UserActorRepository();

export interface CandidateOpportunityJob {
  candidateId: number;
  watchlistId: number;
  matchScore: number;
  priorityScore: number;
  correlationId: string;
  idempotencyKey: string;
}

export const candidateOpportunityWorker = createWorker<CandidateOpportunityJob>(
  QUEUE,
  async (job: Job<CandidateOpportunityJob>) => {
    const workerInstanceId = `${WORKER}:${process.pid}`;
    const actor = actorRepo.buildWorkerActor(WORKER, workerInstanceId);

    try {
      await withTx(async (client) => {
        const runRepo = new ProcessRunRepository(client);
        const stepRepo = new ProcessStepRepository(client);
        const candidateRepo = new CandidateRepository(client);
        const oppRepo = new OpportunityQueueRepository(client);
        const forensicRepo = new ForensicEventRepository(client);
        const mutationRepo = new MutationLedgerRepository(client);
        const journalRepo = new ProductJournalRepository(client);
        const summaryRepo = new PhaseSummaryRepository(client);
        const idempotencyRepo = new QueueIdempotencyRepository(client);

        await idempotencyRepo.reserve({
          queueName: QUEUE,
          idempotencyKey: job.data.idempotencyKey,
          jobId: String(job.id),
          entityType: 'candidate',
          entityPk: String(job.data.candidateId),
          payload: { ...job.data }
        });

        const run = await runRepo.createOrGetIdempotent({
          processName: PROCESS,
          processStage: 'QUEUE_OPPORTUNITY',
          ...actor,
          workerName: WORKER,
          workerInstanceId,
          entityType: 'candidate',
          entityCount: 1,
          correlationId: job.data.correlationId,
          idempotencyKey: job.data.idempotencyKey
        });

        const step = await stepRepo.create({
          processRunId: run.run_id,
          stepName: 'queue_opportunity',
          queueName: QUEUE,
          entityType: 'candidate',
          entityPk: String(job.data.candidateId),
          idempotencyKey: job.data.idempotencyKey,
          payloadJson: {
            ...job.data,
            jobId: String(job.id)
          }
        });

        const claimed = await stepRepo.claimById(step.id, WORKER);
        if (!claimed) {
          return;
        }

        const candidate = await candidateRepo.getById(job.data.candidateId);
        if (!candidate) {
          throw new Error(`Candidate ${job.data.candidateId} not found`);
        }

        await candidateRepo.claimForProcess(
          candidate.id,
          PROCESS,
          run.run_id,
          WORKER
        );

        const phaseSummary = `Candidate ${candidate.id} matched to watchlist ${job.data.watchlistId} with score ${job.data.matchScore}`;

        const existing = await oppRepo.findExisting(candidate.id, job.data.watchlistId);

        let queued;
        if (existing) {
          queued = await oppRepo.updateStatus(existing.id, 'queued', phaseSummary);
        } else {
          queued = await oppRepo.insertQueued({
            candidateId: candidate.id,
            watchlistId: job.data.watchlistId,
            matchScore: job.data.matchScore,
            priorityScore: job.data.priorityScore,
            reasonJson: {
              bestMatchScore: candidate.best_match_score,
              requestedMatchScore: job.data.matchScore
            },
            processName: PROCESS,
            processRunId: run.run_id,
            ...actor,
            phaseSummary
          });
        }
// Listing already ended → insertQueued returned nothing.
        // Skip all queue-side bookkeeping (mark-matched, forensic, mutation, journal).
        if (!queued) {
          console.log('[candidate-opportunity-worker] skipping queue insert — listing already ended', {
            candidateId: candidate.id,
            watchlistId: job.data.watchlistId,
            correlationId: job.data.correlationId,
          });
          return;
        }
        await candidateRepo.markMatched({
          candidateId: candidate.id,
          watchlistId: job.data.watchlistId,
          matchScore: job.data.matchScore,
          ...actor,
          processName: PROCESS,
          processRunId: run.run_id,
          phaseSummary
        });

        const event = await forensicRepo.append({
          processRunId: run.run_id,
          processStepId: step.id,
          correlationId: job.data.correlationId,
          entityType: 'candidate',
          entityPk: String(candidate.id),
          eventType: 'candidate_opportunity_queued',
          actionType: existing ? 'UPSERT' : 'INSERT',
          ...actor,
          workerName: WORKER,
          workerInstanceId,
          sourceTable: 'arb.opportunity_queue',
          sourcePk: String(queued.id),
          queueName: QUEUE,
          jobId: String(job.id),
          idempotencyKey: job.data.idempotencyKey,
          beforeJson: existing ?? {},
          afterJson: queued ?? {},
          evidenceJson: {
            candidateId: candidate.id,
            watchlistId: job.data.watchlistId,
            matchScore: job.data.matchScore,
            priorityScore: job.data.priorityScore
          }
        });

        await mutationRepo.append({
          processRunId: run.run_id,
          correlationId: job.data.correlationId,
          tableName: 'arb.opportunity_queue',
          rowPk: String(queued.id),
          operationType: existing ? 'UPSERT' : 'INSERT',
          changedFields: ['status', 'watchlist_id', 'match_score', 'priority_score', 'phase_summary_current'],
          changeSummary: {
            candidateId: candidate.id,
            watchlistId: job.data.watchlistId,
            forensicEventId: event.id
          },
          ...actor,
          workerName: WORKER,
          workerInstanceId
        });

        await journalRepo.append({
          entityType: 'candidate',
          entityPk: String(candidate.id),
          listingId: candidate.listing_id ? String(candidate.listing_id) : null,
          candidateId: candidate.id,
          watchlistId: job.data.watchlistId,
          eventType: 'OPPORTUNITY_QUEUED',
          processName: PROCESS,
          processStage: 'QUEUE_OPPORTUNITY',
          processRunId: run.run_id,
          correlationId: job.data.correlationId,
          ...actor,
          workerName: WORKER,
          workerInstanceId,
          decisionCode: 'QUEUE',
          reasonCodes: ['MATCHED_TO_WATCHLIST'],
          riskFlags: [],
          eventSummary: phaseSummary,
          eventDetailsJson: {
            forensicEventId: event.id,
            queueRowId: queued.id
          }
        });

        await summaryRepo.append({
          entityType: 'candidate',
          entityPk: String(candidate.id),
          listingId: candidate.listing_id ? String(candidate.listing_id) : null,
          candidateId: candidate.id,
          watchlistId: job.data.watchlistId,
          processName: PROCESS,
          processStage: 'QUEUE_OPPORTUNITY',
          processRunId: run.run_id,
          summaryLine: phaseSummary,
          summaryOrder: 1
        });

        await stepRepo.complete(step.id, {
          queueRowId: queued.id,
          forensicEventId: event.id
        });

        await runRepo.markSucceeded(run.run_id, {
          candidateId: candidate.id,
          watchlistId: job.data.watchlistId
        });
      });
    } catch (error: any) {
      await withTx(async (client) => {
        const deadRepo = new DeadLetterRepository(client);
        await deadRepo.insert({
          queueName: QUEUE,
          jobId: String(job.id),
          entityType: 'candidate',
          entityPk: String(job.data.candidateId),
          workerName: WORKER,
          workerInstanceId,
          errorCode: 'CANDIDATE_OPPORTUNITY_FAILED',
          errorMessage: error.message,
          stackTrace: error.stack,
          payloadJson: { ...job.data },
          retryCount: job.attemptsMade
        });
      });
      throw error;
    }
  }
);
