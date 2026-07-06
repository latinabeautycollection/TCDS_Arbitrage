import { fitEbayTitle } from '../utils/titleLength';
export class TitleGenerationEngine { build(input:{brand?:string|null;model?:string|null;mpn?:string|null;title:string;conditionText?:string|null;}): string { return fitEbayTitle([input.brand,input.model,input.mpn,input.title].filter(Boolean).join(' ')); } }
