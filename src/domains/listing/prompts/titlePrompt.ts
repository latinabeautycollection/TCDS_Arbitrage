export function buildTitlePrompt(input: unknown): string {
  return `Create an eBay title under 80 characters using brand/model/MPN/category/search intent. No unsupported claims. Input JSON: ${JSON.stringify(input)}`;
}
