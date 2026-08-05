import type{Pool}from'pg';import{CertificationRepository}from'./repositories/certificationRepository';
import{ArbProcessRunAdapter}from'./adapters/arbProcessRunAdapter';import{CertificationService}from'./services/certificationService';
import{createCertificationRouter}from'./routes/certificationRoutes';
import type{CertificateSigningAdapter}from'./adapters/certificateSigningAdapter';
export function createCertificationModule(pool:Pool,signer:CertificateSigningAdapter){
 const repo=new CertificationRepository(pool),runs=new ArbProcessRunAdapter(pool);
 const service=new CertificationService(repo,runs,signer);return{service,router:createCertificationRouter(service)}
}
