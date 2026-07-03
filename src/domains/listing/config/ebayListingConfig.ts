export const ebayListingConfig = {
  marketplaceId: process.env.EBAY_MARKETPLACE_ID || 'EBAY_US',
  currency: 'USD',
  listingDuration: 'GTC',
  listingFormat: 'FIXED_PRICE',
  quantityDefault: 1,
  titleMaxLength: 80,
  defaultShippingPolicyName: process.env.EBAY_DEFAULT_SHIPPING_POLICY_NAME || 'TCDS Standard Shipping',
  defaultReturnPolicyName: process.env.EBAY_DEFAULT_RETURN_POLICY_NAME || 'TCDS 30 Day Returns',
  defaultPaymentPolicyName: process.env.EBAY_DEFAULT_PAYMENT_POLICY_NAME || 'TCDS Managed Payments',
};
