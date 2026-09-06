import {randomUUID} from 'node:crypto';
import type {CalculateMetricRequest} from '../models/kpiTypes';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const METRIC=/^[A-Z][A-Z0-9_]{2,127}$/;
export function parseCalculateMetric(body:unknown):CalculateMetricRequest{
 const b=(body??{}) as Record<string,unknown>;const metricCode=String(b.metricCode??'');if(!METRIC.test(metricCode))throw bad('INVALID_METRIC_CODE');
 const from=new Date(String(b.from??'')),to=new Date(String(b.to??''));if(Number.isNaN(from.getTime())||Number.isNaN(to.getTime())||to<=from)throw bad('INVALID_WINDOW');
 if(to.getTime()-from.getTime()>366*86400000)throw bad('WINDOW_TOO_LARGE');
 const raw=b.dimensions??{};if(!raw||typeof raw!=='object'||Array.isArray(raw))throw bad('INVALID_DIMENSIONS');const dimensions:Record<string,string>={};
 for(const [k,v] of Object.entries(raw as Record<string,unknown>)){if(!/^[A-Za-z][A-Za-z0-9_.:-]{0,63}$/.test(k)||typeof v!=='string'||v.length>200)throw bad('INVALID_DIMENSION');dimensions[k]=v;}
 const currency=b.currencyCode===undefined?undefined:String(b.currencyCode).toUpperCase();if(currency&&!/^[A-Z]{3}$/.test(currency))throw bad('INVALID_CURRENCY');
 const idempotencyKey=String(b.idempotencyKey??'').trim();if(!idempotencyKey||idempotencyKey.length>300)throw bad('INVALID_IDEMPOTENCY_KEY');
 const restatementReason=b.restatementReason===undefined?undefined:String(b.restatementReason).trim();if(restatementReason!==undefined&&!restatementReason)throw bad('INVALID_RESTATEMENT_REASON');
 return {metricCode,window:{from,to},dimensions,currencyCode:currency,idempotencyKey,restatementReason};
}
export function requireUuid(v:unknown):string{const s=String(v??'');if(!UUID.test(s))throw bad('INVALID_UUID');return s;}
export function parseLimit(v:unknown):number{const n=Number(v??50);return Number.isInteger(n)&&n>0&&n<=500?n:50;}
export function resolveHeaderUuid(v:unknown):string{if(v===undefined||v===null||v==='')return randomUUID();const s=String(v);if(!UUID.test(s))throw bad('INVALID_CORRELATION_ID');return s;}
function bad(code:string){return Object.assign(new Error(code),{statusCode:400});}
