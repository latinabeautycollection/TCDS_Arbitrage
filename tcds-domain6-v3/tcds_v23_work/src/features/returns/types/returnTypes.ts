export type ReturnStage =
  | 'IDENTIFY' | 'PACKAGE_INSPECTION' | 'CONTENTS' | 'EVIDENCE_COMPARE'
  | 'CONDITION_SAFETY' | 'RISK_REVIEW' | 'DISPOSITION' | 'HANDOFF' | 'COMPLETE';
export type ReturnOutcome = 'RESTOCK'|'QUARANTINE'|'CLAIM'|'REPAIR'|'DISPOSE'|'RETURN_TO_CUSTOMER'|'REVIEW_REQUIRED';
export type ReturnType = 'CUSTOMER_REMORSE'|'DEFECTIVE'|'WRONG_ITEM'|'NOT_AS_DESCRIBED'|'SHIPPING_DAMAGE'|'RETURN_TO_SENDER'|'UNDELIVERABLE'|'REFUSED_DELIVERY'|'WARRANTY'|'MARKETPLACE_DISPUTE'|'FRAUD_SWAP'|'INTERNAL_TRANSFER'|'RECALL'|'REPAIR_RETURN';
export type GateState = 'PASS'|'FAIL'|'PENDING'|'NA';
export type ReadinessState = 'READY'|'DEGRADED'|'OFFLINE';
export type MessageSeverity = 'INFO'|'SUCCESS'|'WARNING'|'ERROR'|'CRITICAL';
export type ReturnAction = 'RETRY'|'OPEN_STAGE'|'REQUEST_MANAGER'|'REQUEST_SECURITY'|'REQUEST_TAKEOVER'|'CONTACT_SUPPORT'|'NONE';

export interface ReturnMessage {
  code:string; severity:MessageSeverity; blocking:boolean; title:string; explanation:string; nextStep:string;
  retryable?:boolean; supportReference?:string; destinationStage?:ReturnStage; primaryAction?:ReturnAction; secondaryAction?:ReturnAction;
  field?:string; dismissible?:boolean;
}
export interface ReturnGate { code:string; label:string; state:GateState; stage:ReturnStage; detail?:string; }
export interface ReturnComponent { componentId:string; name:string; expectedQuantity:number; receivedQuantity:number; state:'MATCH'|'MISSING'|'EXTRA'|'DAMAGED'|'PENDING'; required:boolean; }
export interface ReturnItem {
  returnItemId:string; itemId?:string; productTitle:string; itemBarcode?:string; expectedSerialMasked?:string; receivedSerialMasked?:string;
  identityResult:'PENDING'|'MATCH'|'MISMATCH'|'UNREADABLE'|'NO_SERIAL'|'DUPLICATE'|'REVIEW_REQUIRED';
  quantityExpected:number; quantityReceived:number; conditionBefore?:string; conditionReturned?:string; components:ReturnComponent[];
}
export interface PackageInspection { packageCondition?:string; sealState?:string; tamperSuspected:boolean; wetOrContaminated:boolean; emptyPackage:boolean; evidenceComplete:boolean; }
export interface SafetyReview { batteryState?:string; contamination?:string; powerTest?:string; customerDataPresent?:boolean; activationLock?:boolean; sanitizationRequired?:boolean; sanitizationComplete?:boolean; }
export interface RiskAssessment { status:'NOT_STARTED'|'PROCESSING'|'ACCEPTED'|'REVIEW_REQUIRED'|'REJECTED'|'FAILED'; identityConfidence?:number; fraudRisk?:'LOW'|'MEDIUM'|'HIGH'|'CRITICAL'; safetyResult?:string; evidenceIntegrityResult?:string; recommendedDisposition?:ReturnOutcome; reasons:string[]; }
export interface FinancialResolution { refundStatus?:string; refundAmount?:number; restockingFee?:number; returnLabelCost?:number; shippingResponsibility?:string; claimRecoveryExpected?:number; writeOffAmount?:number; handoffStatus?:string; }
export interface DispositionOption { outcome:ReturnOutcome; label:string; permitted:boolean; approvalLevel:'OPERATOR'|'SUPERVISOR'|'MANAGER'|'EXECUTIVE'; blockers:string[]; requiredHandoff?:string; }
export interface ReturnSession {
  returnSessionId:string; returnNumber:string; orderNumber:string; shipmentId?:string; returnType?:ReturnType; stage:ReturnStage; status:string;
  authorizationStatus:'PENDING'|'AUTHORIZED'|'UNAUTHORIZED'|'EXCEPTION'; expectedItems:number; verifiedItems:number;
  facility:string; station:string; claimExpiresAt?:string; claimedByDisplayName?:string; rowVersion:number;
  items:ReturnItem[]; packageInspection:PackageInspection; safetyReview:SafetyReview; assessment:RiskAssessment;
  permittedDispositions:DispositionOption[]; selectedDisposition?:ReturnOutcome; financialResolution?:FinancialResolution;
  gates:ReturnGate[]; messages:ReturnMessage[]; readiness:Record<string,ReadinessState>;
}
export interface ReturnBootstrap { state:'READY_TO_SCAN'|'SESSION_ACTIVE'; session?:ReturnSession; }
export interface ReturnToast { id:string; message:ReturnMessage; createdAt:number; }
