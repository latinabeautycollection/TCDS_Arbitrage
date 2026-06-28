export interface UspsClaimEvidenceFlags {
  purchaseReceiptPresent: boolean; listingSnapshotPresent: boolean; receivingPhotosPresent: boolean;
  packagingPhotosPresent: boolean; labelArtifactPresent: boolean; trackingHistoryPresent: boolean; proofOfDeliveryRequested: boolean;
}
export class UspsForensicClaimEngine {
  score(flags: UspsClaimEvidenceFlags) {
    let score = 0; const missing: string[] = [];
    const add = (ok: boolean, points: number, name: string) => { if (ok) score += points; else missing.push(name); };
    add(flags.purchaseReceiptPresent,15,"PURCHASE_RECEIPT");
    add(flags.listingSnapshotPresent,15,"LISTING_SNAPSHOT");
    add(flags.receivingPhotosPresent,15,"RECEIVING_PHOTOS");
    add(flags.packagingPhotosPresent,15,"PACKAGING_PHOTOS");
    add(flags.labelArtifactPresent,15,"LABEL_ARTIFACT");
    add(flags.trackingHistoryPresent,15,"TRACKING_HISTORY");
    add(flags.proofOfDeliveryRequested,10,"PROOF_OF_DELIVERY");
    const recommendation = score >= 90 ? "READY_TO_SUBMIT" : score >= 75 ? "BUILD_PACKET" : score >= 50 ? "HUMAN_REVIEW" : "EXECUTIVE_REVIEW";
    return { score, missing, recommendation };
  }
}
