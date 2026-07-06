export class ListingError extends Error { constructor(message:string, public code='LISTING_ERROR'){ super(message); } }
