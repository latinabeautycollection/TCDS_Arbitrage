import{randomUUID}from'node:crypto';import type{AssurancePrincipal,OpenCertificationCampaignInput}from'../models/assuranceTypes';
import{AssuranceError}from'../errors/AssuranceError';import{ArbProcessRunAdapter}from'../adapters/arbProcessRunAdapter';
import{CertificationRepository}from'../repositories/certificationRepository';
import type{CertificateSigningAdapter}from'../adapters/certificateSigningAdapter';

export class CertificationService{
 constructor(private readonly repo:CertificationRepository,private readonly runs:ArbProcessRunAdapter,
 private readonly signer:CertificateSigningAdapter){}
 private need(p:AssurancePrincipal,executive=false){const perm=executive?'forensic.certification.executive':'forensic.certification.operate';
  if(!p.permissions.includes(perm))throw new AssuranceError('FORBIDDEN','Forbidden',403);
  if(executive&&p.assuranceLevel!=='AAL2')throw new AssuranceError('AAL2_REQUIRED','AAL2 required',403)}
 private async exec<T>(p:AssurancePrincipal,name:string,key:string,c:string,fn:(run:string)=>Promise<T>,executive=false){
  this.need(p,executive);const run=await this.runs.start({processName:name,principal:p,correlationId:c,idempotencyKey:key,entityType:'ASSURANCE_CAMPAIGN'});
  try{const x=await fn(run);await this.runs.finish(run,'SUCCEEDED',{completed:true});return x}
  catch(e){await this.runs.finish(run,'FAILED',{},e);throw e}}
 open(p:AssurancePrincipal,i:OpenCertificationCampaignInput,c:string=randomUUID()){return this.exec(p,'D7G2_CAMPAIGN_OPEN',i.idempotencyKey,c,r=>this.repo.open(p,i,r,c))}
 async get(p:AssurancePrincipal,id:string){this.need(p);const x=await this.repo.get(p,id);if(!x)throw new AssuranceError('NOT_FOUND','Campaign not found',404);return x}
 async sign(p:AssurancePrincipal,requestId:string,key:string,c:string=randomUUID()){return this.exec(p,'D7G2_CERTIFICATE_SIGN',key,c,async()=>{
   const req=await this.repo.pendingSigningRequest(requestId);if(!req)throw new AssuranceError('NOT_FOUND','Pending signing request not found',404);
   const signed=await this.signer.sign({signingRequestId:requestId,certificateId:req.certificate_id,
    payloadSha256:req.payload_sha256,algorithm:req.signature_algorithm,keyReference:req.key_reference});
   return this.repo.recordSignature({requestId,signatureBase64:signed.signatureBase64,algorithm:req.signature_algorithm,
    provider:signed.provider,keyReference:signed.keyReference,keyVersion:signed.keyVersion,
    publicKeyReference:signed.publicKeyReference,certificateChainReference:signed.certificateChainReference,
    timestampAuthorityReference:signed.timestampAuthorityReference,providerResponseSha256:signed.providerResponseSha256,
    signedAt:signed.signedAt,verified:signed.verified});
  },true)}
 close(p:AssurancePrincipal,id:string,key:string,c:string=randomUUID()){return this.exec(p,'D7G2_CAMPAIGN_CLOSE',key,c,async()=>this.repo.close(p,id),true)}
 revokeCertificate(p:AssurancePrincipal,id:string,reason:string,key:string,c:string=randomUUID()){return this.exec(p,'D7G2_CERTIFICATE_REVOKE',key,c,async()=>this.repo.revokeCertificate(p,id,reason),true)}
 plans(p:AssurancePrincipal,findingId:string){this.need(p);return this.repo.listPlans(findingId)}
 riskAcceptances(p:AssurancePrincipal,findingId:string){this.need(p);return this.repo.listRiskAcceptances(findingId)}
}
