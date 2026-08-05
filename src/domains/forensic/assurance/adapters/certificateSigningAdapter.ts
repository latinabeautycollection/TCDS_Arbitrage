export interface CertificateSigningRequest{readonly signingRequestId:string;readonly certificateId:string;
 readonly payloadSha256:string;readonly algorithm:string;readonly keyReference:string}
export interface CertificateSigningResult{readonly signatureBase64:string;readonly provider:string;
 readonly keyReference:string;readonly keyVersion?:string;readonly publicKeyReference?:string;
 readonly certificateChainReference?:string;readonly timestampAuthorityReference?:string;
 readonly providerResponseSha256:string;readonly signedAt:string;readonly verified:boolean}
export interface CertificateSigningAdapter{
 sign(input:CertificateSigningRequest):Promise<CertificateSigningResult>;
}
export class UnconfiguredCertificateSigningAdapter implements CertificateSigningAdapter{
 async sign():Promise<CertificateSigningResult>{throw new Error('Certificate signing adapter is not configured')}
}
