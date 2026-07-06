import { ListingDraftRepository } from '../repositories/listingDraftRepository';
export class ListingReviewService { constructor(private drafts=new ListingDraftRepository()){} async approve(draftId:number, reviewedBy:string){ await this.drafts.markApproved(draftId, reviewedBy); return {draftId, status:'APPROVED'}; } }
