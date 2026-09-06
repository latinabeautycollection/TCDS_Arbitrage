export interface ReliabilityPrincipal{reference:string;authSessionId:string;permissions:string[]}
export interface EvaluateSloRequest{sloDefinitionId:string;evaluationAt:Date;idempotencyKey:string;requestId:string;correlationId:string}
export interface EvaluateDriftRequest{baselineId:string;evaluationAt:Date;windowSeconds:number;idempotencyKey:string;requestId:string;correlationId:string}
export interface CreateBaselineRequest{
 driftCode:string;sourceAuthority:'11G'|'11H';sourceMetricCode:string;baselineType:'FIXED_CERTIFIED_BASELINE'|'ROLLING_BASELINE'|'RELEASE_BASELINE';
 methodology:'PERCENTAGE_DEVIATION'|'Z_SCORE';directionality:'HIGHER_IS_BAD'|'LOWER_IS_BAD'|'TWO_SIDED';
 from:Date;to:Date;minimumEvaluationSampleSize:number;sourceFreshnessSeconds:number;requestId:string;correlationId:string
}
