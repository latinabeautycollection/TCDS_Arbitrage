import { ListingDraftRepository } from '../repositories/listingDraftRepository';
import { ListingPublishRepository } from '../repositories/listingPublishRepository';
import { EbayInventoryClient } from '../providers/ebay/ebayInventoryClient';

export class ListingPublishService {
  constructor(private drafts=new ListingDraftRepository(), private publishRepo=new ListingPublishRepository(), private ebay=new EbayInventoryClient()) {}
  async publishDraft(draftId:number): Promise<{ebayListingDbId:number; ebayListingId:string; offerId:string; sku:string}> {
    const draft=await this.drafts.getDraft(draftId);
    if (process.env.DOMAIN4_AUTO_PUBLISH_ENABLED !== 'true') throw new Error('AUTO_PUBLISH_DISABLED');
    if (process.env.DOMAIN4_REQUIRE_HUMAN_APPROVAL !== 'false' && draft.draft_status !== 'APPROVED') throw new Error('HUMAN_APPROVAL_REQUIRED');
    if ((draft.publish_blockers_json||[]).length) throw new Error(`PUBLISH_BLOCKERS: ${JSON.stringify(draft.publish_blockers_json)}`);
    const sku=`TCDS-${draft.source_listing_normalized_id}-${draft.id}`;
    const inventoryPayload={ availability:{shipToLocationAvailability:{quantity:draft.quantity}}, condition:draft.condition_id || 'USED_EXCELLENT', product:{title:draft.title, description:draft.description_html, aspects:draft.item_specifics, imageUrls:draft.image_assets_json?.length?draft.image_assets_json:[] } };
    await this.ebay.createOrReplaceInventoryItem(sku, inventoryPayload);
    const offerPayload={ sku, marketplaceId:process.env.EBAY_MARKETPLACE_ID||'EBAY_US', format:'FIXED_PRICE', availableQuantity:draft.quantity, categoryId:draft.category_id, pricingSummary:{price:{currency:'USD', value:String(draft.listing_price_usd)}}, listingPolicies:{paymentPolicyId:process.env.EBAY_PAYMENT_POLICY_ID, returnPolicyId:process.env.EBAY_RETURN_POLICY_ID, fulfillmentPolicyId:process.env.EBAY_FULFILLMENT_POLICY_ID} };
    const offer=await this.ebay.createOffer(offerPayload);
    const published=await this.ebay.publishOffer(offer.offerId);
    const id=await this.publishRepo.recordPublish({draft, sku, inventoryItemId:sku, offerId:offer.offerId, listingId:published.listingId, request:{inventoryPayload,offerPayload}, response:published, generationRunId:draft.ai_generation_run_id});
    return {ebayListingDbId:id, ebayListingId:published.listingId, offerId:offer.offerId, sku};
  }
}
