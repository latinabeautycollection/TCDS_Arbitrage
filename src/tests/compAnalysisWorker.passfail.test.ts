
import test from 'node:test';
import assert from 'node:assert/strict';
import { comparePropertyRoomToEbay } from '../services/ebayIdentity';

test('identity gate passes on brand+mpn+category agreement', () => {
  const result = comparePropertyRoomToEbay(
    {
      listingId: 'test',
      title: 'Apple iPhone 13 Pro Max 256GB Unlocked Blue',
      normalizedTitle: 'apple iphone 13 pro max 256gb unlocked blue',
      brand: 'Apple',
      model: 'iPhone 13 Pro Max',
      mpn: 'MLKV3LL/A',
      gtin: null,
      categoryId: '9355',
      conditionText: 'Used - Excellent',
    },
    {
      itemId: 'v1',
      title: 'Apple iPhone 13 Pro Max 256GB Blue Unlocked',
      priceValue: 799,
      priceCurrency: 'USD',
      shippingValue: 0,
      shippingCurrency: 'USD',
      totalPriceValue: 799,
      buyingOptions: ['FIXED_PRICE'],
      localizedAspects: [
        { name: 'Brand', values: ['Apple'] },
        { name: 'Model', values: ['iPhone 13 Pro Max'] },
        { name: 'MPN', values: ['MLKV3LL/A'] },
        { name: 'Storage Capacity', values: ['256 GB'] },
      ],
      gtins: [],
      brand: 'Apple',
      mpn: 'MLKV3LL/A',
      epid: undefined,
      categoryId: '9355',
      categoryPath: 'Cell Phones & Smartphones',
      condition: 'Used',
      conditionId: '3000',
      itemWebUrl: 'https://example.com',
      additionalImages: [],
      itemCreationDate: undefined,
      itemEndDate: undefined,
      itemLocationCountry: undefined,
      itemLocationState: undefined,
      imageUrl: undefined,
      legacyItemId: undefined,
      product: undefined,
      sellerUsername: undefined,
      sellerFeedbackPercentage: undefined,
      sellerFeedbackScore: undefined,
      shortDescription: undefined,
      subtitle: undefined,
      description: undefined,
      raw: {},
    },
    {
      categoryTreeId: '0',
      categoryId: '9355',
      aspects: [
        { localizedAspectName: 'Brand', aspectRequired: true, values: [] },
        { localizedAspectName: 'Model', aspectRequired: true, values: [] },
        { localizedAspectName: 'MPN', aspectRequired: false, values: [] },
      ],
      raw: {},
    },
  );

  assert.equal(result.gatePassed, true);
  assert.ok(result.identityScore >= 0.9);
  assert.ok(result.overallScore >= 0.8);
});

test('identity gate fails on category+identity mismatch', () => {
  const result = comparePropertyRoomToEbay(
    {
      listingId: 'test',
      title: 'DeWalt 20V Drill Driver',
      normalizedTitle: 'dewalt 20v drill driver',
      brand: 'DeWalt',
      model: 'DCD771',
      mpn: 'DCD771C2',
      gtin: null,
      categoryId: '42265',
      conditionText: 'Used - Good',
    },
    {
      itemId: 'v2',
      title: 'Canon EOS Rebel T7 DSLR Camera',
      priceValue: 399,
      priceCurrency: 'USD',
      shippingValue: 25,
      shippingCurrency: 'USD',
      totalPriceValue: 424,
      buyingOptions: ['FIXED_PRICE'],
      localizedAspects: [
        { name: 'Brand', values: ['Canon'] },
        { name: 'Model', values: ['EOS Rebel T7'] },
      ],
      gtins: [],
      brand: 'Canon',
      mpn: undefined,
      epid: undefined,
      categoryId: '31388',
      categoryPath: 'Cameras & Photo',
      condition: 'Used',
      conditionId: '3000',
      itemWebUrl: 'https://example.com',
      additionalImages: [],
      itemCreationDate: undefined,
      itemEndDate: undefined,
      itemLocationCountry: undefined,
      itemLocationState: undefined,
      imageUrl: undefined,
      legacyItemId: undefined,
      product: undefined,
      sellerUsername: undefined,
      sellerFeedbackPercentage: undefined,
      sellerFeedbackScore: undefined,
      shortDescription: undefined,
      subtitle: undefined,
      description: undefined,
      raw: {},
    },
    null,
  );

  assert.equal(result.gatePassed, false);
  assert.ok(result.gateReasons.length > 0);
});
