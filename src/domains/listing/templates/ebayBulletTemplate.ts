export function defaultBullets(input: { brand?: string | null; model?: string | null; conditionText?: string | null; }): string[] {
  const name = [input.brand, input.model].filter(Boolean).join(' ');
  return [
    name ? `${name} selected for strong resale value and clear buyer demand.` : 'Carefully prepared listing with clear photos and details.',
    `Condition: ${input.conditionText || 'See condition section and photos.'}`,
    'Ships with tracking after payment clears.',
    'Photos are part of the description and show the actual item when available.',
  ];
}
