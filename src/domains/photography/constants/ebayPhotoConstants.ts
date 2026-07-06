export const EBAY_PHOTO_RULES = {
  maxPhotos: 24,
  minDimensionPx: 500,
  recommendedDimensionPx: 1600,
  forbidden: ['watermark', 'promotional_text', 'borders', 'stock_photo_misrepresentation', 'misleading_ai_alteration'],
  heroMustShow: ['full_product', 'clean_background', 'no_watermark', 'no_border', 'accurate_condition']
} as const;
