import { renderEbayDescription } from '../templates/ebayDescriptionTemplate';
export class DescriptionGenerationEngine { render(data:{title:string;bullets:string[];condition:string;disclosures:string[];specifics:Record<string,unknown>}): string { return renderEbayDescription(data); } }
