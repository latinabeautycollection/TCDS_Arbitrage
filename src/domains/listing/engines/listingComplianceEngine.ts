import { validateCompliance } from '../validators/listingComplianceValidator';
export class ListingComplianceEngine { validate(title:string, html:string): string[] { return validateCompliance(title, html); } }
