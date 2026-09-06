const U=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function bad(m:string){return Object.assign(new Error(m),{statusCode:400})}
export function uuid(v:unknown){const s=String(v??'');if(!U.test(s))throw bad('INVALID_UUID');return s}
export function key(v:unknown){const s=String(v??'').trim();if(!s||s.length>300)throw bad('INVALID_IDEMPOTENCY_KEY');return s}
export function date(v:unknown){const d=new Date(String(v??''));if(Number.isNaN(d.getTime()))throw bad('INVALID_DATE');return d}
export function positiveInt(v:unknown,name:string){const n=Number(v);if(!Number.isInteger(n)||n<=0)throw bad(`INVALID_${name}`);return n}
export function parseEvaluateSlo(body:any){return{evaluationAt:body?.evaluationAt?date(body.evaluationAt):new Date(),idempotencyKey:key(body?.idempotencyKey),requestId:uuid(body?.requestId),correlationId:uuid(body?.correlationId)}}
export function parseEvaluateDrift(body:any){return{evaluationAt:body?.evaluationAt?date(body.evaluationAt):new Date(),windowSeconds:positiveInt(body?.windowSeconds,'WINDOW_SECONDS'),idempotencyKey:key(body?.idempotencyKey),requestId:uuid(body?.requestId),correlationId:uuid(body?.correlationId)}}
export function parseBaseline(body:any){
 const sa=String(body?.sourceAuthority??'');if(!['11G','11H'].includes(sa))throw bad('INVALID_SOURCE_AUTHORITY');
 const bt=String(body?.baselineType??'');if(!['FIXED_CERTIFIED_BASELINE','ROLLING_BASELINE','RELEASE_BASELINE'].includes(bt))throw bad('INVALID_BASELINE_TYPE');
 const m=String(body?.methodology??'');if(!['PERCENTAGE_DEVIATION','Z_SCORE'].includes(m))throw bad('UNSUPPORTED_DRIFT_METHOD');
 const dir=String(body?.directionality??'');if(!['HIGHER_IS_BAD','LOWER_IS_BAD','TWO_SIDED'].includes(dir))throw bad('INVALID_DIRECTIONALITY');
 const from=date(body?.from),to=date(body?.to);if(to<=from)throw bad('INVALID_BASELINE_WINDOW');
 return{driftCode:String(body?.driftCode??'').trim(),sourceAuthority:sa as '11G'|'11H',sourceMetricCode:String(body?.sourceMetricCode??'').trim(),
  baselineType:bt as any,methodology:m as 'PERCENTAGE_DEVIATION'|'Z_SCORE',directionality:dir as any,from,to,
  minimumEvaluationSampleSize:positiveInt(body?.minimumEvaluationSampleSize,'MINIMUM_EVALUATION_SAMPLE_SIZE'),
  sourceFreshnessSeconds:positiveInt(body?.sourceFreshnessSeconds,'SOURCE_FRESHNESS_SECONDS'),
  requestId:uuid(body?.requestId),correlationId:uuid(body?.correlationId)}
}