import { ListingSourceInput } from '../models/listingTypes';
export function validateListingInput(i:ListingSourceInput): string[] { const e:string[]=[]; if(!i.sourceListingNormalizedId) e.push('MISSING_SOURCE_LISTING_NORMALIZED_ID'); if(!i.title) e.push('MISSING_TITLE'); if(!i.recommendedSalePriceUsd || i.recommendedSalePriceUsd<=0) e.push('MISSING_RECOMMENDED_PRICE'); return e; }
