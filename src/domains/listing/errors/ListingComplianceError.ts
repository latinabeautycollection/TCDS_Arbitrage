export class ListingComplianceError extends Error { constructor(public blockers:string[]){ super(blockers.join(', ')); } }
