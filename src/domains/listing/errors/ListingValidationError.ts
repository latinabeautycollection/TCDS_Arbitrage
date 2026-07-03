export class ListingValidationError extends Error { constructor(public errors:string[]){ super(errors.join(', ')); } }
