import type { Readable } from 'node:stream';
export interface EvidenceObjectHead { sizeBytes:number; contentType?:string; etag?:string; versionId?:string; metadata:Record<string,string>; }
export interface EvidenceObjectStream extends EvidenceObjectHead { stream:Readable; }
export interface EvidenceStorageProvider {
 issuePutUrl(input:{bucket:string;key:string;contentType:string;sizeBytes:number;expiresSeconds:number;metadata:Record<string,string>}):Promise<string>;
 issueGetUrl(input:{bucket:string;key:string;versionId?:string;expiresSeconds:number}):Promise<string>;
 head(input:{bucket:string;key:string;versionId?:string}):Promise<EvidenceObjectHead>;
 get(input:{bucket:string;key:string;versionId?:string}):Promise<EvidenceObjectStream>;
 copy(input:{bucket:string;sourceKey:string;sourceVersionId?:string;destinationKey:string;metadata:Record<string,string>}):Promise<{etag?:string;versionId?:string}>;
 list(input:{bucket:string;prefix:string;continuationToken?:string}):Promise<{objects:Array<{key:string;sizeBytes:number;etag?:string}>;nextToken?:string}>;
}
export interface MalwareScanResult { clean:boolean; scanner:string; signature?:string; details:Record<string,unknown>; }
export interface MalwareScanner { readonly kind:string; scan(input:{stream:Readable;contentType?:string;sizeBytes:number}):Promise<MalwareScanResult>; }
