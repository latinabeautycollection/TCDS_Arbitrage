export function buildDisclosurePrompt(input: unknown): string {
  return `Identify required defect and condition disclosures. If uncertain, disclose uncertainty and require human review. Input JSON: ${JSON.stringify(input)}`;
}
