import type { PhotoProcessingResult } from '../models/photoTypes';
export function mapPhotoProcessingResponse(result: PhotoProcessingResult) {
  return { listing_photos: result.listingPhotos, photo_quality_score: result.photoQualityScore, photo_set: result.photoSetAssessment, approved_count: result.photoSetAssessment.approvedPhotoCount, review_required: result.photoSetAssessment.reviewRequired };
}
