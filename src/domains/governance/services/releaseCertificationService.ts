import type{ReleasePrincipal,RegisterReleaseRequest,StartCertificationRequest,GateEvidenceRequest,BeginReplayRequest,CompleteReplayRequest,ReleaseLogger}from'../models/releaseCertificationTypes';
import{ReleaseCertificationRepository}from'../repositories/releaseCertificationRepository';import{releaseCertificationMetrics as metrics}from'../observability/releaseCertificationMetrics';
export class ReleaseCertificationService{
 constructor(private readonly repo:ReleaseCertificationRepository,private readonly logger:ReleaseLogger){}
 private need(p:ReleasePrincipal,perm:string){if(!p.permissions.includes(perm))throw Object.assign(new Error('RELEASE_PERMISSION_DENIED'),{statusCode:403})}
 async syncPolicy(p:ReleasePrincipal){this.need(p,'governance.release.admin');return this.repo.syncPolicy()}
 async register(p:ReleasePrincipal,x:RegisterReleaseRequest){this.need(p,'governance.release.admin');const id=await this.repo.registerRelease(x);this.logger.info('11K release candidate registered',{releaseCandidateId:id});return{releaseCandidateId:id}}
 async seal(p:ReleasePrincipal,id:string){this.need(p,'governance.release.admin');return{releaseManifestSha256:await this.repo.sealRelease(id)}}
 async start(p:ReleasePrincipal,x:StartCertificationRequest){this.need(p,'governance.release.certify');return{certificationRunId:await this.repo.startCertification(x)}}
 async gate(p:ReleasePrincipal,x:GateEvidenceRequest){this.need(p,'governance.release.certify');const id=await this.repo.recordGate(x,await this.repo.componentId('DOMAIN11K_RELEASE_ENGINE'));metrics.gate(x.gateCode,x.result);return{certificationEvidenceId:id}}
 async finalize(p:ReleasePrincipal,runId:string){this.need(p,'governance.release.certify');const t=Date.now();const status=await this.repo.finalize(runId);metrics.release('DATABASE_DERIVED',status);metrics.observe('finalize',(Date.now()-t)/1000);return{status}}
 async beginReplay(p:ReleasePrincipal,x:BeginReplayRequest){this.need(p,'governance.release.replay');return{replayRunId:await this.repo.beginReplay(x)}}
 async completeReplay(p:ReleasePrincipal,x:CompleteReplayRequest){this.need(p,'governance.release.replay');const replayResultId=await this.repo.completeReplay(x);metrics.replay('DATABASE_DERIVED');return{replayResultId}}
 async verifyDeployment(p:ReleasePrincipal,x:import('../models/releaseCertificationTypes').DeploymentVerificationRequest){this.need(p,'governance.release.deploy.verify');return{deploymentVerificationId:await this.repo.verifyDeployment(x,await this.repo.componentId('DOMAIN11K_DEPLOYMENT_VERIFIER'))}}
 async certifyRollback(p:ReleasePrincipal,x:import('../models/releaseCertificationTypes').RollbackCertificationRequest){this.need(p,'governance.release.certify');return{rollbackCertificationId:await this.repo.certifyRollback(x,await this.repo.componentId('DOMAIN11K_RELEASE_ENGINE'))}}
 async summary(p:ReleasePrincipal,id:string){this.need(p,'governance.release.read');return this.repo.summary(id)}
}