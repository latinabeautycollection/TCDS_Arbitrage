import type { Request,Response,NextFunction } from "express";

const HTTP:Record<string,number>={
  PACKSHIP_SESSION_INVALID:401,
  PACKSHIP_ACTOR_NOT_ALLOWED:403,
  PACKSHIP_FACILITY_MISMATCH:403,
  PACKSHIP_STATION_MISMATCH:403,
  PACKSHIP_TASK_NOT_FOUND:404,
  PACKSHIP_SHIPMENT_NOT_FOUND:404,
  PACKSHIP_ORDER_NOT_FOUND:404,
  PACKSHIP_TASK_CLAIMED_BY_OTHER:409,
  PACKSHIP_CLAIM_REQUIRED:409,
  PACKSHIP_ROW_VERSION_CONFLICT:409,
  PACKSHIP_INVALID_STATUS:409,
  PACKSHIP_ACTIVE_TASK_EXISTS:409,
  PACKSHIP_PRECONDITION_FAILED:409,
  PACKSHIP_SHIPMENT_AMBIGUOUS:409,
  PACKSHIP_IDEMPOTENCY_KEY_REUSED:422,
  PACKSHIP_IDEMPOTENCY_KEY_INVALID:422,
  PACKSHIP_INPUT_INVALID:422,
  PACKSHIP_CAPTURE_INVALID:422,
  PACKSHIP_JSON_REQUIRED:415,
  PACKSHIP_CROSS_TASK_RESPONSE:502,
  PACKSHIP_CROSS_SHIPMENT_RESPONSE:502,
  PACKSHIP_METADATA_MISSING:502,
  PACKSHIP_STATUS_UNKNOWN:502,
  PACKSHIP_SNAPSHOT_INVALID:502,
  PACKSHIP_TASK_SNAPSHOT_MISSING:502,
  // V1.6: codes the routes already threw but V1.5 never mapped (each would have become a host 500).
  CSRF_VALIDATION_REQUIRED:403,
  X_REQUEST_ID_INVALID:400,
  X_CORRELATION_ID_INVALID:400,
  PACKSHIP_SNAPSHOT_VERSION_UNSUPPORTED:502,
  PACKSHIP_ROUTE_ACTION_UNKNOWN:500,
  AUTH_SECURITY_DEPENDENCY_UNAVAILABLE:503,
  // V1.6: wrong scans (V0.2 ok:false) as PR #13 catalog codes; 422 = REJECTED, scan again.
  PACK_WRONG_SERIALIZED_ITEM:422,
  PACK_DUPLICATE_SCAN:422,
  SHIP_TRACKING_MISMATCH:422,
  PACK_WRONG_SOURCE:422,
  SHIP_PACKAGE_LABEL_MISMATCH:422,
  PACK_WRONG_OUTBOUND_LOCATION:422,
};

export function packShipErrorMiddleware(err:any,_req:Request,res:Response,next:NextFunction){
  const code=typeof err?.message==="string"&&HTTP[err.message]?err.message:err?.code;
  const approved=typeof err?.status==="number" && [400,401,403,404,409,415,422,502,503].includes(err.status);
  if(!code || !Object.prototype.hasOwnProperty.call(HTTP,code)){next(err);return}
  // Do not reflect DB exception details or untrusted object contents to public clients.
  const safeCode = typeof code === "string" && /^[A-Z][A-Z0-9_]{2,80}$/.test(code) ? code : "PACKSHIP_REQUEST_FAILED";
  res.setHeader("Cache-Control","no-store");
  // Do not let arbitrary thrown status override the governed error mapping.
  res.status(HTTP[code]).json({code:safeCode});
}
