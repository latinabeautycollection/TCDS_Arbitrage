const U=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA=/^[0-9a-f]{64}$/;
function bad(m:string){return Object.assign(new Error(m),{statusCode:400})}
export function uuid(v:unknown){const s=String(v??'');if(!U.test(s))throw bad('INVALID_UUID');return s}
export function sha256(v:unknown,n:string){const s=String(v??'').toLowerCase();if(!SHA.test(s))throw bad(`INVALID_${n}`);return s}
export function nonEmpty(v:unknown,n:string,max=512){const s=String(v??'').trim();if(!s||s.length>max)throw bad(`INVALID_${n}`);return s}
export function positiveInt(v:unknown,n:string){const x=Number(v);if(!Number.isInteger(x)||x<=0)throw bad(`INVALID_${n}`);return x}
export function isoDate(v:unknown,n:string){const s=String(v??'');const d=new Date(s);if(Number.isNaN(d.getTime()))throw bad(`INVALID_${n}`);return d.toISOString()}
export function oneOf<T extends readonly string[]>(v:unknown,n:string,allowed:T):T[number]{const s=String(v??'');if(!allowed.includes(s as T[number]))throw bad(`INVALID_${n}`);return s as T[number]}
export function manifest(v:unknown){if(!v||typeof v!=='object'||Array.isArray(v))throw bad('INVALID_RELEASE_MANIFEST');const x=v as Record<string,unknown>;for(const k of['sourceManifestSha256','artifactManifestSha256','migrationManifestSha256','configurationManifestSha256','policyManifestSha256','dependencyLockSha256'])sha256(x[k],k);if(!Array.isArray(x.artifacts)||!Array.isArray(x.migrations)||!Array.isArray(x.dependencies))throw bad('INVALID_RELEASE_MANIFEST_COLLECTIONS');return x}
