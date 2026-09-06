import type {CapitalSafetyAssessmentState,CapitalSafetyDecision,CapitalSafetyEvaluationInput,ControlResult,ControlResultState} from '../models/capitalSafetyTypes';

const critical=(code:string,result:ControlResultState,reason:string,measured:Record<string,unknown>={},threshold:Record<string,unknown>={},evidence:Record<string,unknown>={},evaluatedAt=new Date()):ControlResult=>({controlCode:code,controlSemanticVersion:1,result,safetyCritical:true,reasonCode:reason,measuredValue:measured,thresholdValue:threshold,evidenceReference:evidence,evaluatedAt});
const review=(code:string,result:ControlResultState,reason:string,measured:Record<string,unknown>={},threshold:Record<string,unknown>={},evidence:Record<string,unknown>={},evaluatedAt=new Date()):ControlResult=>({controlCode:code,controlSemanticVersion:1,result,safetyCritical:false,reasonCode:reason,measuredValue:measured,thresholdValue:threshold,evidenceReference:evidence,evaluatedAt});

export function evaluateCapitalSafety(input:CapitalSafetyEvaluationInput):CapitalSafetyDecision{
  const {proposal,financial,readiness,policy,exposure,now}=input;
  const c:ControlResult[]=[];
  const cfg=policy?.configuration??{};
  const currency=stringCfg(cfg,'currencyCode','USD');
  const total=numberCfg(cfg,'totalCapitalCeiling');
  const daily=numberCfg(cfg,'dailyCapitalCeiling');
  const perTx=numberCfg(cfg,'perTransactionLimit');
  const maxProposalAge=numberCfg(cfg,'maxProposalAgeSeconds');
  const maxFinancialAge=numberCfg(cfg,'maxFinancialStateAgeSeconds');
  const maxAcquisitionAge=numberCfg(cfg,'maxAcquisitionEvidenceAgeSeconds');
  const ttl=numberCfg(cfg,'authorizationTtlSeconds');
  const abnormal=numberCfg(cfg,'abnormalTransactionReviewAmount');
  const requireFull=boolCfg(cfg,'requireFullFinancialReconciliation',true);

  if(!policy)c.push(critical('POLICY_VERSION_MISMATCH','UNKNOWN','ACTIVE_CERTIFIED_POLICY_MISSING'));
  else{
    const ok=policy.consumerDriftStatus==='MATCH'&&policy.consumerAcknowledged;
    c.push(critical('POLICY_VERSION_MISMATCH',ok?'PASS':'UNKNOWN',ok?'ACTIVE_POLICY_CERTIFIED':'POLICY_DRIFT_OR_ACK_MISSING',{driftStatus:policy.consumerDriftStatus,acknowledged:policy.consumerAcknowledged},{requiredDriftStatus:'MATCH',consumerAcknowledgement:true},{policyVersionId:policy.governancePolicyVersionId},now));
  }

  const readinessOk=!!readiness&&!readiness.expired&&readiness.capitalTechnicalReadiness&&readiness.canMutateState&&readiness.canCreateExternalSideEffects;
  c.push(critical('READINESS_NOT_PERMITTED',readinessOk?'PASS':'UNKNOWN',readinessOk?'READINESS_PERMITS_TECHNICAL_CAPITAL':'READINESS_MISSING_STALE_OR_DENIED',readiness?{state:readiness.readinessState}: {},{capitalTechnicalReadiness:true,canMutateState:true,canCreateExternalSideEffects:true},readiness?{assessmentId:readiness.assessmentId}: {},now));

  c.push(critical('CURRENCY_MISMATCH',proposal.currencyCode===currency?'PASS':'FAIL',proposal.currencyCode===currency?'CURRENCY_MATCH':'POLICY_CURRENCY_MISMATCH',{proposalCurrency:proposal.currencyCode},{policyCurrency:currency},{},now));
  c.push(limitControl('PER_TRANSACTION_LIMIT',proposal.requestedAmount,perTx,'PER_TRANSACTION_LIMIT_EXCEEDED',now));

  const projectedTotal=exposure.provisionalAuthorized+exposure.authoritativeCapitalAtRisk+proposal.requestedAmount;
  c.push(limitControl('TOTAL_CAPITAL_CEILING',projectedTotal,total,'TOTAL_CAPITAL_CEILING_EXCEEDED',now));
  const projectedDaily=(financial.authoritativeDailyCapitalAtRisk??Number.NaN)+exposure.dailyAuthorized+proposal.requestedAmount;
  c.push(limitControl('DAILY_CAPITAL_CEILING',projectedDaily,daily,'DAILY_CAPITAL_CEILING_EXCEEDED',now));

  if(financial.availableToDeploy===null)c.push(critical('AVAILABLE_CAPITAL','UNKNOWN','AVAILABLE_CAPITAL_UNKNOWN',{}, {},{source:financial.sourceReference},now));
  else c.push(critical('AVAILABLE_CAPITAL',financial.availableToDeploy>=proposal.requestedAmount?'PASS':'FAIL',financial.availableToDeploy>=proposal.requestedAmount?'AVAILABLE_CAPITAL_SUFFICIENT':'INSUFFICIENT_AVAILABLE_CAPITAL',{availableToDeploy:financial.availableToDeploy,requestedAmount:proposal.requestedAmount},{minimum:proposal.requestedAmount},{source:financial.sourceReference,sourceHash:financial.sourceHash},now));

  const finAge=(now.getTime()-financial.observedAt.getTime())/1000;
  c.push(critical('MISSING_FINANCIAL_EVIDENCE',Number.isFinite(maxFinancialAge)&&finAge<=maxFinancialAge?'PASS':'UNKNOWN',Number.isFinite(maxFinancialAge)&&finAge<=maxFinancialAge?'FINANCIAL_EVIDENCE_FRESH':'FINANCIAL_EVIDENCE_STALE',{ageSeconds:finAge},{maxAgeSeconds:maxFinancialAge},{source:financial.sourceReference},now));
  if(requireFull&&financial.completeness!=='COMPLETE')c.push(critical('UNRECONCILED_CAPITAL','UNKNOWN','FULL_FINANCIAL_RECONCILIATION_REQUIRED',{completeness:financial.completeness},{requiredCompleteness:'COMPLETE'},{source:financial.sourceReference},now));
  else c.push(critical('UNRECONCILED_CAPITAL','PASS','FINANCIAL_RECONCILIATION_POLICY_SATISFIED',{completeness:financial.completeness},{requiredCompleteness:requireFull?'COMPLETE':'PARTIAL_OR_BETTER'},{},now));

  const proposalAge=(now.getTime()-proposal.createdAt.getTime())/1000;
  c.push(critical('STALE_CAPITAL_PROPOSAL',Number.isFinite(maxProposalAge)&&proposalAge<=maxProposalAge?'PASS':'UNKNOWN',Number.isFinite(maxProposalAge)&&proposalAge<=maxProposalAge?'PROPOSAL_FRESH':'PROPOSAL_STALE_OR_POLICY_MISSING',{ageSeconds:proposalAge},{maxAgeSeconds:maxProposalAge},{externalDecisionId:proposal.externalDecisionId},now));

  const lifecycle=proposal.purchaseLifecycle;
  if(lifecycle.duplicateIdentityConflict===null)c.push(critical('DUPLICATE_ORDER','UNKNOWN','PURCHASE_QUEUE_IDENTITY_UNVERIFIABLE',{}, {},{source:lifecycle.reference},now));
  else c.push(critical('DUPLICATE_ORDER',lifecycle.duplicateIdentityConflict?'FAIL':'PASS',lifecycle.duplicateIdentityConflict?'DUPLICATE_PURCHASE_IDENTITY_EXISTS':'NO_DUPLICATE_PURCHASE_IDENTITY',{state:lifecycle.currentState},{duplicateForbidden:true},{source:lifecycle.reference},now));

  if(lifecycle.crossedSideEffectBoundary===null)c.push(critical('DUPLICATE_COMMITMENT','UNKNOWN','CURRENT_PROPOSAL_LIFECYCLE_UNVERIFIABLE',{state:lifecycle.currentState},{preCommitRequired:true},{source:lifecycle.reference},now));
  else c.push(critical('DUPLICATE_COMMITMENT',lifecycle.crossedSideEffectBoundary?'FAIL':'PASS',lifecycle.crossedSideEffectBoundary?'CURRENT_PROPOSAL_ALREADY_COMMITTED_OR_EXECUTING':'CURRENT_PROPOSAL_PRECOMMIT',{state:lifecycle.currentState,queueStatus:lifecycle.currentQueueStatus,status:lifecycle.currentStatus},{preCommitRequired:true},{source:lifecycle.reference},now));
  c.push(critical('DUPLICATE_ALLOCATION','PASS','DOMAIN2_RUN_SOURCE_IDENTITY_DATABASE_VERIFIED',{externalDecisionId:proposal.externalDecisionId},{unique:true},{runId:proposal.capitalAllocationRunId,sourceRecordId:proposal.sourceRecordId},now));

  c.push(concentration('CATEGORY_CONCENTRATION',exposure.categoryProvisional,exposure.categoryAuthoritative,proposal.requestedAmount,total,numberCfg(cfg,'maxCategoryExposurePct'),proposal.categoryKey,now));
  c.push(concentration('SKU_CONCENTRATION',exposure.skuProvisional,exposure.skuAuthoritative,proposal.requestedAmount,total,numberCfg(cfg,'maxSkuExposurePct'),proposal.skuKey,now));
  c.push(concentration('SUPPLIER_CONCENTRATION',exposure.supplierProvisional,exposure.supplierAuthoritative,proposal.requestedAmount,total,numberCfg(cfg,'maxSupplierExposurePct'),proposal.supplierKey,now));
  c.push(concentration('MARKETPLACE_CONCENTRATION',exposure.marketplaceProvisional,exposure.marketplaceAuthoritative,proposal.requestedAmount,total,numberCfg(cfg,'maxMarketplaceExposurePct'),proposal.marketplaceKey,now));
  c.push(critical('PRODUCT_CONCENTRATION','NOT_APPLICABLE','PRODUCT_DIMENSION_NOT_SEPARATE_FROM_SKU_IN_CURRENT_DOMAIN2_CONTRACT'));
  c.push(critical('COUNTERPARTY_EXPOSURE','NOT_APPLICABLE','COUNTERPARTY_NOT_PRESENT_IN_CURRENT_DOMAIN2_PROPOSAL'));
  c.push(critical('INVENTORY_EXPOSURE','NOT_APPLICABLE','INVENTORY_EXPOSURE_REQUIRES_AUTHORITATIVE_WAREHOUSE_FINANCIAL_READ_MODEL'));

  const acquisitionAge=proposal.currentAcquisitionObservedAt?(now.getTime()-proposal.currentAcquisitionObservedAt.getTime())/1000:Number.POSITIVE_INFINITY;
  const acquisitionResult=proposal.currentAcquisitionEvidence==='PASS'&&Number.isFinite(maxAcquisitionAge)&&acquisitionAge<=maxAcquisitionAge?'PASS':proposal.currentAcquisitionEvidence==='FAIL'?'FAIL':'UNKNOWN';
  c.push(critical('STALE_ACQUISITION_DECISION',acquisitionResult,acquisitionResult==='PASS'?'ACQUISITION_DECISION_CURRENT':acquisitionResult==='FAIL'?'ACQUISITION_DECISION_NO_LONGER_ELIGIBLE':'ACQUISITION_DECISION_FRESHNESS_UNVERIFIABLE',{status:proposal.currentAcquisitionEvidence,ageSeconds:Number.isFinite(acquisitionAge)?acquisitionAge:null},{maxAgeSeconds:maxAcquisitionAge,requiredStatus:'PASS'},{source:proposal.currentAcquisitionEvidenceReference},now));

  const approvalNeeded=proposal.executionStatus==='REVIEW_REQUIRED';
  c.push(critical('EXPIRED_APPROVAL',approvalNeeded?'HOLD':'PASS',approvalNeeded?'REQUIRED_APPROVAL_NOT_PROVEN_BY_DOMAIN2_PROPOSAL':'NO_SEPARATE_APPROVAL_REQUIRED_BY_PROPOSAL',{executionStatus:proposal.executionStatus},{},{},now));
  c.push(review('ABNORMAL_TRANSACTION_SIZE',Number.isFinite(abnormal)&&proposal.requestedAmount>=abnormal?'REVIEW':'PASS',Number.isFinite(abnormal)&&proposal.requestedAmount>=abnormal?'ABNORMAL_TRANSACTION_REQUIRES_HUMAN_REVIEW':'TRANSACTION_WITHIN_AUTOMATED_REVIEW_THRESHOLD',{requestedAmount:proposal.requestedAmount},{reviewAtOrAbove:abnormal},{},now));
  c.push(critical('CONFLICTING_FINANCIAL_EVIDENCE','PASS','NO_CONFLICT_REPORTED_BY_FINANCIAL_PROVIDER',{sourceHash:financial.sourceHash},{},{source:financial.sourceReference},now));

  const evaluationState=aggregate(c);
  const assessmentState:CapitalSafetyAssessmentState=evaluationState==='UNKNOWN'?'HOLD':evaluationState;
  const validUntil=minimumDate([new Date(now.getTime()+Math.max(1,Number.isFinite(ttl)?ttl:1)*1000),readiness?.validUntil??null,Number.isFinite(maxFinancialAge)?new Date(financial.observedAt.getTime()+maxFinancialAge*1000):null,Number.isFinite(maxProposalAge)?new Date(proposal.createdAt.getTime()+maxProposalAge*1000):null,proposal.currentAcquisitionObservedAt&&Number.isFinite(maxAcquisitionAge)?new Date(proposal.currentAcquisitionObservedAt.getTime()+maxAcquisitionAge*1000):null,policy?.effectiveUntil??null],now);
  return {evaluationState,assessmentState,reasonCodes:[...new Set(c.filter(x=>x.result!=='PASS'&&x.result!=='NOT_APPLICABLE').map(x=>x.reasonCode))],controls:c,validUntil};
}

export function aggregate(c:ControlResult[]):CapitalSafetyDecision['evaluationState']{if(c.some(x=>x.safetyCritical&&x.result==='UNKNOWN'))return 'UNKNOWN';if(c.some(x=>x.result==='FAIL'))return 'BLOCK';if(c.some(x=>x.result==='HOLD'))return 'HOLD';if(c.some(x=>x.result==='REVIEW'))return 'REVIEW';if(c.some(x=>x.result==='WARN'))return 'ALLOW_WITH_GUARD';return 'ALLOW';}
function limitControl(code:string,value:number,limit:number,failReason:string,now:Date):ControlResult{if(!Number.isFinite(limit))return critical(code,'UNKNOWN',`${code}_POLICY_THRESHOLD_MISSING`,{value},{}, {},now);return critical(code,value<=limit?'PASS':'FAIL',value<=limit?`${code}_PASS`:failReason,{value},{limit},{},now);}
function concentration(code:string,provisional:number,authoritative:number|null,amount:number,total:number,pct:number,key:string|null,now:Date):ControlResult{if(!key)return critical(code,'UNKNOWN',`${code}_DIMENSION_MISSING`,{}, {maxPct:pct},{},now);if(authoritative===null)return critical(code,'UNKNOWN',`${code}_AUTHORITATIVE_EXPOSURE_MISSING`,{key,provisional},{maxPct:pct},{},now);if(!Number.isFinite(total)||total<=0||!Number.isFinite(pct))return critical(code,'UNKNOWN',`${code}_POLICY_THRESHOLD_MISSING`,{key},{totalCapital:total,maxPct:pct},{},now);const projected=provisional+authoritative+amount,limit=total*pct;return critical(code,projected<=limit?'PASS':'FAIL',projected<=limit?`${code}_PASS`:`${code}_EXCEEDED`,{key,provisional,authoritative,requested:amount,projected},{limit,maxPct:pct},{},now);}
function numberCfg(x:Record<string,unknown>,k:string):number{const v=Number(x[k]);return Number.isFinite(v)?v:Number.NaN;}
function stringCfg(x:Record<string,unknown>,k:string,d:string):string{const v=x[k];return typeof v==='string'&&v.trim()?v.trim().toUpperCase():d;}
function boolCfg(x:Record<string,unknown>,k:string,d:boolean):boolean{return typeof x[k]==='boolean'?x[k] as boolean:d;}
function minimumDate(xs:Array<Date|null>,now:Date):Date{const valid=xs.filter((x):x is Date=>x instanceof Date&&!Number.isNaN(x.getTime()));const min=new Date(Math.min(...valid.map(x=>x.getTime())));return min.getTime()>now.getTime()?min:new Date(now.getTime()+1000);}
