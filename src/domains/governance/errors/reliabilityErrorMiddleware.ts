import type{ErrorRequestHandler}from'express';
export const reliabilityErrorMiddleware:ErrorRequestHandler=(e,_q,r,_n)=>{const x=e as any;const s=x.statusCode??(x.code==='42501'?403:x.code==='23505'?409:x.code==='23514'?422:500);r.status(s).json({error:s>=500?'RELIABILITY_INTERNAL_ERROR':x.message??'RELIABILITY_REJECTED'})};
