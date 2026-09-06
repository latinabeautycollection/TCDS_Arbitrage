import { SAFE_METADATA_KEYS } from '../constants/observabilityConstants';
const SECRET_PATTERNS=[/authorization/i,/access[_-]?token/i,/refresh[_-]?token/i,/client[_-]?secret/i,/password/i,/passwd/i,/api[_-]?key/i,/apikey/i,/cookie/i,/set-cookie/i,/private[_-]?key/i,/^secret$/i,/card[_-]?number/i,/cvv/i];
const MAX_STRING=2048;

export function rejectSensitiveMetadata(input:Record<string,unknown>):void{
  const serialized=JSON.stringify(input);
  if(Buffer.byteLength(serialized,'utf8')>16_384)throw Object.assign(new Error('OBSERVABILITY_METADATA_TOO_LARGE'),{statusCode:413});
  for(const [key,value] of Object.entries(input)){
    if(!SAFE_METADATA_KEYS.has(key))throw Object.assign(new Error('OBSERVABILITY_METADATA_KEY_NOT_ALLOWED'),{statusCode:400});
    if(SECRET_PATTERNS.some(p=>p.test(key)))throw Object.assign(new Error('OBSERVABILITY_METADATA_SECRET_REJECTED'),{statusCode:400});
    if(value!==null&&(typeof value==='object'||typeof value==='function'||typeof value==='symbol'))throw Object.assign(new Error('OBSERVABILITY_METADATA_MUST_BE_SCALAR'),{statusCode:400});
    if(typeof value==='string'&&value.length>MAX_STRING)throw Object.assign(new Error('OBSERVABILITY_METADATA_VALUE_TOO_LARGE'),{statusCode:413});
  }
}
export function sanitizeObservabilityMetadata(input:unknown):unknown{
  if(input===null||input===undefined||typeof input==='number'||typeof input==='boolean')return input;
  if(typeof input==='string')return input.length<=MAX_STRING?input:`${input.slice(0,MAX_STRING)}…`;
  if(Array.isArray(input))return input.slice(0,100).map(sanitizeObservabilityMetadata);
  if(typeof input!=='object')return String(input);
  const out:Record<string,unknown>={};
  for(const [k,v] of Object.entries(input as Record<string,unknown>))out[k]=SECRET_PATTERNS.some(p=>p.test(k))?'[REDACTED]':sanitizeObservabilityMetadata(v);
  return out;
}
