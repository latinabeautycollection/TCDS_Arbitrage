import{createHash}from'node:crypto';import type{AccessPrincipal,BeginAccessInput,ProtectedResult,ProcessContext}from'../models/accessTypes';
import{AccessRepository}from'../repositories/accessRepository';
export class ProtectedEvidenceAccessService{
 constructor(private readonly repo:AccessRepository){}
 async execute<T>(principal:AccessPrincipal,input:BeginAccessInput,ctx:ProcessContext,
  operation:()=>Promise<ProtectedResult<T>>):Promise<T>{
  const auth=await this.repo.begin(principal,input,ctx);
  try{const result=await operation();const hash=result.digestSource===undefined?undefined:
   createHash('sha256').update(result.digestSource).digest('hex');
   await this.repo.complete(auth.receiptId,auth.token,result.responseBytes,hash,{source:auth.source},ctx);return result.value;
  }catch(error){try{await this.repo.fail(auth.receiptId,auth.token,error instanceof Error?error.name:'ERROR',
   {message:error instanceof Error?error.message:String(error)},ctx)}
   catch(auditError){throw new AggregateError([error,auditError],'Protected access and receipt finalization failed')}throw error}
 }}
