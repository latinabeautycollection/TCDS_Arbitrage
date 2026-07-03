import { validateEbayTitlePolicy } from '../policies/ebayTitlePolicy';
export function validateTitle(title:string): string[] { return validateEbayTitlePolicy(title); }
