import crypto from 'node:crypto';
import type { AcquisitionCandidate, NormalizedIdentity } from '../contracts/acquisitionDecision';

const PHONE_WORDS = /\b(iphone|galaxy|pixel|motorola|samsung|oneplus|unlocked|locked|verizon|att|at&t|t-mobile|tmobile|128gb|256gb|512gb|64gb)\b/i;
const TOOL_WORDS = /\b(dewalt|milwaukee|makita|bosch|ridgid|ryobi|drill|impact|saw|sander|grinder|battery|charger|bare tool|kit)\b/i;
const CAMERA_WORDS = /\b(canon|nikon|sony|fuji|fujifilm|lens|dslr|mirrorless|body only|camera|eos|alpha)\b/i;
const APPLIANCE_WORDS = /\b(blender|vacuum|mixer|air fryer|coffee maker|keurig|dyson|ninja)\b/i;

export function resolveAcquisitionIdentity(candidate: AcquisitionCandidate): NormalizedIdentity {
  const raw = normalizeWhitespace([candidate.brand, candidate.model, candidate.normalizedTitle, candidate.title, candidate.description].filter(Boolean).join(' '));
  const lower = raw.toLowerCase();
  const categoryKey = inferCategory(candidate.categoryKey, lower);
  const brand = normalizeBrand(candidate.brand) ?? inferBrand(lower);
  const model = normalizeModel(candidate.model) ?? inferModel(lower, brand);
  const variant = inferVariant(lower);
  const storageGb = inferStorageGb(lower);
  const color = inferColor(lower);
  const carrierState = inferCarrierState(lower);
  const bundleState = inferBundleState(lower, categoryKey);
  const conditionState = inferConditionState([candidate.conditionText, raw].filter(Boolean).join(' '));
  const accessorySignals = inferAccessorySignals(lower);
  const requiredAttributesMissing = requiredMissing({ categoryKey, model, storageGb, carrierState, bundleState });
  const ambiguityFlags = inferAmbiguityFlags({ lower, brand, model, categoryKey, storageGb, carrierState, bundleState, conditionState, accessorySignals, requiredAttributesMissing });
  const identityConfidence = scoreIdentity({ categoryKey, brand, model, storageGb, carrierState, bundleState, conditionState, ambiguityFlags, requiredAttributesMissing, raw });
  const familyKey = normalizeKey([categoryKey, brand, model, variant, storageGb ? `${storageGb}gb` : '', carrierState !== 'unknown' ? carrierState : '', bundleState !== 'unknown' ? bundleState : ''].filter(Boolean).join('|'));
  const fingerprint = crypto.createHash('sha256').update([familyKey, conditionState, color ?? ''].join('|')).digest('hex');

  return { originalTitle: candidate.title, normalizedTitle: normalizeForMatch(raw), categoryKey, familyKey, brand, model, variant, storageGb, color, carrierState, bundleState, conditionState, accessorySignals, requiredAttributesMissing, ambiguityFlags, identityConfidence, fingerprint };
}

function inferCategory(existing: string | null, lower: string): string {
  const value = (existing ?? '').toLowerCase();
  if (value.includes('phone') || PHONE_WORDS.test(lower)) return 'phones';
  if (value.includes('tool') || TOOL_WORDS.test(lower)) return 'tools';
  if (value.includes('camera') || CAMERA_WORDS.test(lower)) return 'cameras';
  if (value.includes('appliance') || APPLIANCE_WORDS.test(lower)) return 'small_appliances';
  if (/\b(bose|sony|jbl|speaker|headphone|receiver|soundbar)\b/i.test(lower)) return 'audio';
  if (/\b(laptop|macbook|thinkpad|latitude|elitebook|notebook)\b/i.test(lower)) return 'computers';
  return value || 'default';
}
function normalizeBrand(value: string | null): string | null { if (!value) return null; const cleaned = normalizeWhitespace(value).toLowerCase(); if (!cleaned || cleaned === 'unknown') return null; return titleCase(cleaned); }
function inferBrand(lower: string): string | null { const brands = ['apple','samsung','google','motorola','oneplus','dewalt','milwaukee','makita','bosch','ridgid','ryobi','canon','nikon','sony','fujifilm','bose','jbl','dyson','kitchenaid','lenovo','dell','hp','ninja']; const found = brands.find((brand) => new RegExp(`\\b${escapeRegExp(brand)}\\b`, 'i').test(lower)); return found ? titleCase(found) : null; }
function normalizeModel(value: string | null): string | null { if (!value) return null; const cleaned = normalizeWhitespace(value); return cleaned.length >= 2 ? cleaned : null; }
function inferModel(lower: string, brand: string | null): string | null { const patterns = [/\biphone\s?(\d{1,2}\s?(?:pro max|pro|plus|mini)?)\b/i,/\bgalaxy\s?(s\d{1,2}\s?(?:ultra|plus|fe)?|note\s?\d{1,2})\b/i,/\bpixel\s?(\d{1,2}\s?(?:pro|a)?)\b/i,/\b(qc\s?\d{2}|quietcomfort\s?\d{2})\b/i,/\b(eos\s?[a-z0-9\-]+|d\d{3,4}|alpha\s?[a-z0-9]+|a7\s?(?:iii|iv|v)?)\b/i,/\b(dcd\d{3}|dcf\d{3}|m18|m12|xph\d{2}|xdt\d{2})\b/i,/\b(macbook\s?(?:air|pro)?\s?\d{0,2})\b/i]; for (const pattern of patterns) { const match = lower.match(pattern); if (match) return normalizeWhitespace(`${brand ?? ''} ${match[0]}`).trim(); } return null; }
function inferVariant(lower: string): string | null { const variant = lower.match(/\b(pro max|pro|plus|mini|ultra|max|fe|gen\s?\d+|series\s?\d+)\b/i)?.[0]; return variant ? titleCase(variant) : null; }
function inferStorageGb(lower: string): number | null { const match = lower.match(/\b(32|64|128|256|512|1024)\s?gb\b/i); return match ? Number(match[1]) : null; }
function inferColor(lower: string): string | null { const colors = ['black','white','blue','red','green','gold','silver','gray','grey','purple','pink','yellow','graphite','midnight','starlight']; return titleCase(colors.find(c => new RegExp(`\\b${c}\\b`, 'i').test(lower)) ?? '') || null; }
function inferCarrierState(lower: string): NormalizedIdentity['carrierState'] { if (/\bunlocked\b/i.test(lower)) return 'unlocked'; if (/\b(verizon|at&t|att|t-mobile|tmobile|sprint|carrier locked|locked)\b/i.test(lower)) return 'locked'; return 'unknown'; }
function inferBundleState(lower: string, categoryKey: string): NormalizedIdentity['bundleState'] { if (/\b(accessory only|case only|charger only|battery only|strap only|remote only)\b/i.test(lower)) return 'accessory_only'; if (categoryKey === 'cameras' && /\b(lens only|no body)\b/i.test(lower)) return 'lens_only'; if (/\b(bare tool|tool only|body only|no battery|no charger|no lens)\b/i.test(lower)) return categoryKey === 'cameras' ? 'body_only' : 'bare'; if (/\b(kit|battery and charger|with battery|charger included)\b/i.test(lower)) return 'kit'; if (/\b(bundle|lot of|includes lens|with lens|accessories included)\b/i.test(lower)) return 'bundle'; return 'unknown'; }
function inferConditionState(text: string): NormalizedIdentity['conditionState'] { const lower = text.toLowerCase(); if (/\b(parts only|for parts|not working|broken|repair)\b/i.test(lower)) return 'parts_only'; if (/\b(untested|as is|as-is|powers on only)\b/i.test(lower)) return 'untested'; if (/\b(new|sealed)\b/i.test(lower)) return 'new'; if (/\b(open box|open-box)\b/i.test(lower)) return 'open_box'; if (/\b(used|pre-owned|preowned)\b/i.test(lower)) return 'used'; return 'unknown'; }
function inferAccessorySignals(lower: string): string[] { const signals = ['battery','charger','case','cable','lens','strap','remote','dock','stand','adapter','manual','box'].filter((word) => new RegExp(`\\b${word}\\b`, 'i').test(lower)); return Array.from(new Set(signals)); }
function requiredMissing(input: { categoryKey: string; model: string | null; storageGb: number | null; carrierState: string; bundleState: string }): string[] { const missing: string[] = []; if (!input.model) missing.push('MODEL_MISSING'); if (input.categoryKey === 'phones') { if (!input.storageGb) missing.push('STORAGE_MISSING'); if (input.carrierState === 'unknown') missing.push('CARRIER_STATE_UNKNOWN'); } if (input.categoryKey === 'tools' && input.bundleState === 'unknown') missing.push('TOOL_KIT_STATE_UNKNOWN'); if (input.categoryKey === 'cameras' && input.bundleState === 'unknown') missing.push('CAMERA_BODY_LENS_STATE_UNKNOWN'); return missing; }
function inferAmbiguityFlags(input: { lower: string; brand: string | null; model: string | null; categoryKey: string; storageGb: number | null; carrierState: string; bundleState: string; conditionState: string; accessorySignals: string[]; requiredAttributesMissing: string[] }): string[] { const flags = [...input.requiredAttributesMissing]; if (!input.brand) flags.push('BRAND_MISSING'); if (input.conditionState === 'unknown') flags.push('CONDITION_UNKNOWN'); if (input.conditionState === 'parts_only') flags.push('PARTS_ONLY'); if (input.conditionState === 'untested') flags.push('UNTESTED_AS_IS'); if (input.bundleState === 'accessory_only') flags.push('ACCESSORY_ONLY'); if (/\b(lot|assorted|misc|various)\b/i.test(input.lower)) flags.push('LOT_OR_ASSORTED'); if (/\b(no returns|final sale)\b/i.test(input.lower)) flags.push('SOURCE_FINAL_SALE'); return Array.from(new Set(flags)); }
function scoreIdentity(input: { categoryKey: string; brand: string | null; model: string | null; storageGb: number | null; carrierState: string; bundleState: string; conditionState: string; ambiguityFlags: string[]; requiredAttributesMissing: string[]; raw: string }): number { let score = 0.35; if (input.brand) score += 0.15; if (input.model) score += 0.22; if (input.conditionState !== 'unknown') score += 0.08; if (input.bundleState !== 'unknown') score += 0.07; if (input.categoryKey === 'phones') { if (input.storageGb) score += 0.08; if (input.carrierState !== 'unknown') score += 0.08; } if (input.categoryKey === 'tools' && ['bare','kit','bundle'].includes(input.bundleState)) score += 0.08; if (input.categoryKey === 'cameras' && ['body_only','lens_only','bundle'].includes(input.bundleState)) score += 0.08; score -= input.requiredAttributesMissing.length * 0.08; score -= input.ambiguityFlags.filter(f => ['PARTS_ONLY','ACCESSORY_ONLY','LOT_OR_ASSORTED','UNTESTED_AS_IS'].includes(f)).length * 0.12; score -= input.ambiguityFlags.length * 0.025; return clamp(round(score, 4), 0, 0.99); }
export function normalizeForMatch(value: string): string { return normalizeWhitespace(value.toLowerCase().replace(/[^a-z0-9\s]/g, ' ')); }
function normalizeKey(value: string): string { return normalizeForMatch(value).replace(/\s+/g, '_').replace(/\|/g, '_'); }
function normalizeWhitespace(value: string): string { return value.replace(/\s+/g, ' ').trim(); }
function titleCase(value: string): string { return value ? value.replace(/\b\w/g, (m) => m.toUpperCase()) : ''; }
function escapeRegExp(value: string): string { return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
function round(value: number, places = 2): number { const factor = 10 ** places; return Math.round(value * factor) / factor; }
function clamp(value: number, min: number, max: number): number { return Math.min(max, Math.max(min, value)); }
