import type { TrustedActor,CertificationRequest,RevocationRequest } from '../models/executiveGovernanceTypes';
import type { Phase3CertificationRepository } from '../repositories/phase3CertificationRepository';
export class Phase3CertificationService { constructor(private readonly repo:Phase3CertificationRepository){} certify(a:TrustedActor,r:CertificationRequest){return this.repo.certify(a,r)} revoke(a:TrustedActor,id:string,r:RevocationRequest){return this.repo.revoke(a,id,r)} }
