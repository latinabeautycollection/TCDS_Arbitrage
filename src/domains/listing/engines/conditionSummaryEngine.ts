import { normalizeConditionText } from '../policies/conditionPolicy';
export class ConditionSummaryEngine { summarize(condition?:string|null): string { return normalizeConditionText(condition); } }
