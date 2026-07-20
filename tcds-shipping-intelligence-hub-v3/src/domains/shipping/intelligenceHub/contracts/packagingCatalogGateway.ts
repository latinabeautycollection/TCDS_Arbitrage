import type { PackagingCandidate } from "../models/packageRecommendation";
export interface PackagingCatalogGateway { getEligiblePackaging(input:{itemLengthIn:number;itemWidthIn:number;itemHeightIn:number;fragile:boolean;hazardous:boolean;}):Promise<PackagingCandidate[]>; }
