import { ClaudeReviewOutput, GeminiVisionOutput } from '../models/aiListingTypes';
import { GeneratedListingDraft, ListingQualityScores, ConsensusDecision } from '../models/listingTypes';
import { validateGeneratedListing } from '../validators/generatedListingValidator';
import { validateCompliance } from '../validators/listingComplianceValidator';
import { conditionRequiresHumanReview } from '../policies/conditionPolicy';

export class AiConsensusEngine {
  decide(input:{draft:GeneratedListingDraft; claude:ClaudeReviewOutput; gemini:GeminiVisionOutput; quality:ListingQualityScores;}): ConsensusDecision {
    const blockers=[...validateGeneratedListing(input.draft), ...validateCompliance(input.draft.title,input.draft.descriptionHtml), ...input.claude.unsupportedClaims, ...input.claude.policyWarnings, ...input.gemini.conditionMismatchFlags];
    const reasons=[...input.claude.improvedCopyNotes, ...input.gemini.imageQualityWarnings];
    let score=Math.min(input.quality.overallScore, input.claude.confidenceScore*100, input.gemini.photoConfidenceScore);
    const humanReviewRequired = blockers.length>0 || input.claude.revisionRequired || conditionRequiresHumanReview(input.draft.conditionText) || score < 82;
    const decision = blockers.some(b=>/NO_PHOTOS|INVALID_PRICE|UNSUPPORTED|POLICY|CLAIM/i.test(b)) ? 'BLOCK' : humanReviewRequired ? 'HUMAN_REVIEW' : 'APPROVE_DRAFT';
    return { decision, score, reasons, blockers, revisionRequired: input.claude.revisionRequired, humanReviewRequired, trace:{claude:input.claude, gemini:input.gemini, quality:input.quality} };
  }
}
