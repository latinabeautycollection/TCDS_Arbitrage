export class AiListingError extends Error { constructor(message:string, public provider?:string){ super(message); } }
