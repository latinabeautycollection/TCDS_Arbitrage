import type{StorageVerificationObservation}from'../models/casefileTypes';
export interface PreservationObject{memberId:string;storageProvider:string;bucketName?:string;objectKey?:string;
 storageVersionId?:string;expectedSha256:string}
export interface StoragePreservationAdapter{
 readonly name:string;readonly version:string;
 applyLegalHold(object:PreservationObject,retentionUntil?:Date):Promise<void>;
 releaseLegalHold(object:PreservationObject):Promise<void>;
 verify(object:PreservationObject):Promise<StorageVerificationObservation>;
}
export class UnsupportedStorageAdapter implements StoragePreservationAdapter{
 readonly name='unsupported';readonly version='1';
 async applyLegalHold():Promise<void>{throw new Error('Storage provider legal-hold adapter is not configured')}
 async releaseLegalHold():Promise<void>{throw new Error('Storage provider legal-hold adapter is not configured')}
 async verify():Promise<StorageVerificationObservation>{throw new Error('Storage provider verification adapter is not configured')}
}
