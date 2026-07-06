import { GeneratedListingDraft } from '../models/listingTypes';
import { validateTitle } from './ebayTitleValidator';
export function validateGeneratedListing(d: GeneratedListingDraft): string[] { const e=[...validateTitle(d.title)]; if(!d.descriptionHtml) e.push('DESCRIPTION_EMPTY'); if(!d.photoUrls?.length) e.push('NO_PHOTOS'); if(!d.listingPriceUsd || d.listingPriceUsd<=0) e.push('INVALID_PRICE'); if(!d.conditionText) e.push('CONDITION_EMPTY'); return e; }
