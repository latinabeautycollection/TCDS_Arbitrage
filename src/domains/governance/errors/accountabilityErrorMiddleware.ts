import type { ErrorRequestHandler } from 'express';

export const accountabilityErrorMiddleware:ErrorRequestHandler=(err,_req,res,_next)=>{
  const e=err as {message?:string;statusCode?:number;code?:string};
  const status =
    e.statusCode ??
    (e.code==='42501' ? 403 :
     e.code==='22P02' || e.code==='22007' || e.code==='22008' ? 400 :
     e.code==='23505' || e.code==='23514' ? 409 :
     e.code==='23503' ? 422 : 500);
  res.status(status).json({
    error: status>=500 ? 'ACCOUNTABILITY_INTERNAL_ERROR' : (e.message??'ACCOUNTABILITY_REQUEST_REJECTED')
  });
};
