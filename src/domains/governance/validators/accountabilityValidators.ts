function bad(message:string):never{throw Object.assign(new Error(message),{statusCode:400});}
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA=/^[0-9a-f]{64}$/;
const DOMAIN=/^DOMAIN_(?:[1-9]|1[01])$/;
export function requireString(v:unknown,name:string,max=512):string { if(typeof v!=='string'||!v.trim()||v.length>max) bad(`invalid_${name}`); return v.trim(); }
export function optionalUuid(v:unknown,name:string):string|undefined { if(v===undefined||v===null||v==='') return undefined; if(typeof v!=='string'||!UUID.test(v)) bad(`invalid_${name}`); return v; }
export function requireUuid(v:unknown,name:string):string { const x=optionalUuid(v,name); if(!x) bad(`invalid_${name}`); return x; }
export function requireSha(v:unknown,name:string):string { if(typeof v!=='string'||!SHA.test(v)) bad(`invalid_${name}`); return v; }
export function requireDomain(v:unknown):`DOMAIN_${number}` { if(typeof v!=='string'||!DOMAIN.test(v)) bad('invalid_domain_code'); return v as `DOMAIN_${number}`; }
export function requireDate(v:unknown,name:string):Date { if(typeof v!=='string'&&!(v instanceof Date)) bad(`invalid_${name}`); const d=v instanceof Date?v:new Date(v); if(Number.isNaN(d.getTime())) bad(`invalid_${name}`); return d; }
export function requireObject(v:unknown,name:string):Record<string,unknown> { if(v===undefined) return {}; if(v===null||typeof v!=='object'||Array.isArray(v)) bad(`invalid_${name}`); return v as Record<string,unknown>; }
export function boundedInt(v:unknown,name:string,min:number,max:number,def:number):number { if(v===undefined) return def; const n=Number(v); if(!Number.isInteger(n)||n<min||n>max) bad(`invalid_${name}`); return n; }

export function requireEnum<T extends string>(v:unknown,name:string,values:readonly T[]):T { const x=requireString(v,name,64); if(!values.includes(x as T)) bad(`invalid_${name}`); return x as T; }
