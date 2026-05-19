import type { ListingGenerationInput, ListingGenerationOutput } from '../contracts/acquisitionExecutionIntegrity';

const RISK_TERMS = ['as-is', 'as is', 'untested', 'for parts', 'repair', 'broken', 'cracked', 'missing', 'powers on only', 'no further testing'];
const STOP_WORDS = new Set(['the', 'and', 'with', 'for', 'from', 'this', 'that', 'only', 'used', 'new']);

export function generateDefensibleListing(input: ListingGenerationInput): ListingGenerationOutput {
  const maxTitleLength = input.maxTitleLength ?? 80;
  const cleanTitle = normalize(input.sourceTitle);
  const title = buildTitle({ ...input, sourceTitle: cleanTitle }, maxTitleLength);
  const includedItems = normalizeList(input.includedItems);
  const defects = normalizeList(input.defects);
  const testedFunctions = normalizeList(input.testedFunctions);
  const missingItems = normalizeList(input.missingItems);
  const ambiguitySignals = findRiskSignals(`${input.sourceTitle} ${input.descriptionClean ?? ''} ${input.conditionText ?? ''}`);

  const conditionDisclosure = buildConditionDisclosure(input.conditionText, ambiguitySignals);
  const includedItemsDisclosure = includedItems.length > 0 ? `Includes: ${includedItems.join(', ')}.` : 'Includes only the item(s) shown and described in this listing.';
  const defectDisclosure = defects.length > 0 || missingItems.length > 0
    ? [`Known issues: ${defects.join(', ') || 'none stated'}.`, missingItems.length > 0 ? `Missing/not included: ${missingItems.join(', ')}.` : ''].filter(Boolean).join(' ')
    : null;
  const testingDisclosure = testedFunctions.length > 0
    ? `Tested functions: ${testedFunctions.join(', ')}. No other functions are guaranteed unless explicitly stated.`
    : 'Basic visual inspection completed. Functionality is limited to what is explicitly stated in this listing.';

  const defenseLanguage = buildDefenseLanguage(input, ambiguitySignals);
  const bulletPoints = buildBullets(input, conditionDisclosure, includedItemsDisclosure, defectDisclosure, testingDisclosure);
  const seoKeywords = buildSeoKeywords(input, title);
  const listingRiskFlags = buildRiskFlags(input, ambiguitySignals, defects, missingItems);
  const descriptionQualityScore = scoreDescriptionQuality(input, ambiguitySignals, includedItems, defects, testedFunctions);
  const subtitle = input.brand && input.model ? `${input.brand} ${input.model} - condition disclosed, evidence-backed listing` : null;
  const descriptionHtml = buildDescriptionHtml({ bulletPoints, conditionDisclosure, includedItemsDisclosure, defectDisclosure, testingDisclosure, defenseLanguage });

  return {
    title,
    subtitle,
    bulletPoints,
    descriptionHtml,
    conditionDisclosure,
    includedItemsDisclosure,
    defectDisclosure,
    testingDisclosure,
    defenseLanguage,
    seoKeywords,
    listingRiskFlags,
    descriptionQualityScore,
    evidence: {
      ambiguitySignals,
      sourceTitle: input.sourceTitle,
      categoryKey: input.categoryKey ?? null,
      serialCount: input.serialNumbers?.length ?? 0,
      forensicEvidenceReady: input.forensicEvidenceReady ?? false,
    },
  };
}

function buildTitle(input: ListingGenerationInput, maxLength: number): string {
  const parts = [input.brand, input.model, stripRiskTerms(input.sourceTitle), input.conditionText]
    .filter(Boolean)
    .map((value) => normalize(String(value)));
  const seen = new Set<string>();
  const tokens: string[] = [];
  for (const part of parts) {
    for (const token of part.split(' ')) {
      const key = token.toLowerCase();
      if (key.length < 2 || seen.has(key)) continue;
      seen.add(key);
      tokens.push(token);
    }
  }
  let title = tokens.join(' ').slice(0, maxLength).trim();
  if (title.length < 8) title = normalize(input.sourceTitle).slice(0, maxLength).trim();
  return title;
}

function buildConditionDisclosure(conditionText?: string | null, ambiguitySignals: string[] = []): string {
  const condition = normalize(conditionText || 'Pre-owned');
  if (ambiguitySignals.length > 0) {
    return `Condition: ${condition}. Source description contains risk terms (${ambiguitySignals.join(', ')}); buyer expectations must be set clearly.`;
  }
  return `Condition: ${condition}. Please review all photos and included-item disclosures before purchase.`;
}

function buildDefenseLanguage(input: ListingGenerationInput, ambiguitySignals: string[]): string[] {
  const language = [
    'Listing includes only the item(s) shown in photos and explicitly listed in the included-items section.',
    'Serial numbers or unique identifiers may be recorded before shipment for seller protection.',
    'Photos form part of the item description and should be reviewed before purchase.',
  ];
  if (ambiguitySignals.length > 0) language.push('Any limitation stated in the source condition or testing notes is disclosed here to avoid buyer misunderstanding.');
  if (input.shippingClass === 'FRAGILE' || input.shippingClass === 'OVERSIZE') language.push('Item will be packed with additional protection appropriate for its shipping class.');
  if (!input.forensicEvidenceReady) language.push('Final shipment requires evidence capture before release.');
  return language;
}

function buildBullets(input: ListingGenerationInput, conditionDisclosure: string, included: string, defects: string | null, testing: string): string[] {
  return [
    input.brand || input.model ? `Product: ${[input.brand, input.model].filter(Boolean).join(' ')}` : `Product: ${normalize(input.sourceTitle)}`,
    conditionDisclosure,
    included,
    testing,
    defects ?? 'No additional defects are stated beyond the disclosed condition notes.',
  ].map((entry) => entry.trim()).filter(Boolean).slice(0, 6);
}

function buildDescriptionHtml(input: { bulletPoints: string[]; conditionDisclosure: string; includedItemsDisclosure: string; defectDisclosure: string | null; testingDisclosure: string; defenseLanguage: string[] }): string {
  const bullets = input.bulletPoints.map((b) => `<li>${escapeHtml(b)}</li>`).join('');
  const defense = input.defenseLanguage.map((b) => `<li>${escapeHtml(b)}</li>`).join('');
  return [
    '<section>',
    '<h2>Item Details</h2>',
    `<ul>${bullets}</ul>`,
    '<h2>Seller Protection & Disclosure Notes</h2>',
    `<ul>${defense}</ul>`,
    '</section>',
  ].join('');
}

function buildSeoKeywords(input: ListingGenerationInput, title: string): string[] {
  const raw = [title, input.brand, input.model, input.categoryKey, input.conditionText].filter(Boolean).join(' ');
  const tokens = raw.toLowerCase().replace(/[^a-z0-9\s-]/g, ' ').split(/\s+/).filter((token) => token.length > 2 && !STOP_WORDS.has(token));
  return [...new Set(tokens)].slice(0, 20);
}

function buildRiskFlags(input: ListingGenerationInput, ambiguity: string[], defects: string[], missing: string[]): string[] {
  const flags: string[] = [];
  if (ambiguity.length > 0) flags.push('SOURCE_DESCRIPTION_AMBIGUITY');
  if (defects.length > 0) flags.push('DEFECT_DISCLOSURE_REQUIRED');
  if (missing.length > 0) flags.push('MISSING_ITEMS_DISCLOSURE_REQUIRED');
  if (!input.forensicEvidenceReady) flags.push('FORENSIC_EVIDENCE_INCOMPLETE');
  if (!input.conditionText) flags.push('CONDITION_TEXT_MISSING');
  return flags;
}

function scoreDescriptionQuality(input: ListingGenerationInput, ambiguity: string[], included: string[], defects: string[], tested: string[]): number {
  let score = 0.55;
  if (input.conditionText) score += 0.10;
  if (input.descriptionClean && input.descriptionClean.length >= 80) score += 0.10;
  if (included.length > 0) score += 0.08;
  if (tested.length > 0) score += 0.08;
  if (input.serialNumbers && input.serialNumbers.length > 0) score += 0.05;
  if (defects.length > 0) score += 0.03;
  score -= Math.min(0.20, ambiguity.length * 0.04);
  if (!input.forensicEvidenceReady) score -= 0.08;
  return clamp01(round(score, 4));
}

function findRiskSignals(value: string): string[] {
  const normalized = value.toLowerCase();
  return RISK_TERMS.filter((term) => normalized.includes(term));
}

function stripRiskTerms(value: string): string {
  let output = value;
  for (const term of RISK_TERMS) output = output.replace(new RegExp(term, 'ig'), ' ');
  return output;
}

function normalizeList(values?: string[] | null): string[] {
  return [...new Set((values ?? []).map(normalize).filter(Boolean))];
}

function normalize(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
}

function round(value: number, places = 2): number {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

