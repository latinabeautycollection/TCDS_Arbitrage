import { ConsensusDecision } from '../models/listingTypes';
export class ListingDecisionEngine { canPublish(c:ConsensusDecision, requireHumanApproval=true): boolean { return c.decision==='APPROVE_DRAFT' && !requireHumanApproval; } }
