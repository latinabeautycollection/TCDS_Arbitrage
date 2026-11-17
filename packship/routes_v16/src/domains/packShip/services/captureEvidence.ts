import type { CaptureEvidence } from "../contracts/packShipRouteTypes";
import { routeError } from "../auth/PackShipPrincipalResolver";
const SOURCES=new Set(["CAMERA","MANUAL","HID"]);
const CANONICAL=new Set(["CODE128","EAN13_UPCA","QR"]);
const EXACT=new Set(["CODE128","EAN13","UPC_A","QR","CODE39","DATAMATRIX","EAN8","GS1_128","ITF14","PDF417","UPC_E"]);
export function captureFromBody(body:unknown):CaptureEvidence {
  if(!body || typeof body!=="object" || Array.isArray(body)) throw routeError(422,"PACKSHIP_INPUT_INVALID");
  const c=(body as Record<string,unknown>).capture;
  // Absence is a genuinely unknown source; never invent MANUAL from an absent capture.
  if(c===undefined || c===null) return {} as CaptureEvidence;
  if(typeof c!=="object" || Array.isArray(c)) throw routeError(422,"PACKSHIP_INPUT_INVALID");
  const x=c as Record<string,unknown>;
  if(!SOURCES.has(x.source as string))throw routeError(422,"PACKSHIP_CAPTURE_INVALID");
  if(x.canonicalSymbology!==undefined && !CANONICAL.has(x.canonicalSymbology as string))throw routeError(422,"PACKSHIP_CAPTURE_INVALID");
  if(x.symbology!==undefined && !EXACT.has(x.symbology as string))throw routeError(422,"PACKSHIP_CAPTURE_INVALID");
  if(x.source==="CAMERA" && (
      typeof x.observationId!=="string" || !x.observationId ||
      typeof x.provider!=="string" || !x.provider.trim() || x.provider.length>128 ||
      typeof x.capturedAt!=="string" || !Number.isFinite(Date.parse(x.capturedAt)) ||
      !CANONICAL.has(x.canonicalSymbology as string)
    )) throw routeError(422,"PACKSHIP_CAPTURE_INVALID");
  if(x.observationId!==undefined && (typeof x.observationId!=="string" || x.observationId.length>160))throw routeError(422,"PACKSHIP_CAPTURE_INVALID");
  if(x.capturedAt!==undefined && (typeof x.capturedAt!=="string" || !Number.isFinite(Date.parse(x.capturedAt))))throw routeError(422,"PACKSHIP_CAPTURE_INVALID");
  if(x.captureDurationMs!==undefined && (typeof x.captureDurationMs!=="number" || !Number.isFinite(x.captureDurationMs) || x.captureDurationMs<0))throw routeError(422,"PACKSHIP_CAPTURE_INVALID");
  if(Object.keys(x).some(k=>!["source","symbology","canonicalSymbology","provider","observationId","capturedAt","captureDurationMs"].includes(k))) throw routeError(422,"PACKSHIP_CAPTURE_INVALID");
  return Object.fromEntries(Object.entries(x).filter(([k])=>["source","symbology","canonicalSymbology","provider","observationId","capturedAt","captureDurationMs"].includes(k))) as CaptureEvidence;
}
export function captureFromLabelEvidence(body:unknown):CaptureEvidence {
 const c=captureFromBody(body);
 const pair=(body as any)?.physicalEvidence;
 if(pair!==undefined && pair!==null){
   if(typeof pair!=="object" || Array.isArray(pair) || !pair.tracking || !pair.package ||
     typeof pair.tracking!=="object" || typeof pair.package!=="object")throw routeError(422,"PACKSHIP_CAPTURE_INVALID");
   const a=pair.tracking.observationId,b=pair.package.observationId;
   if(typeof a!=="string" || !a || typeof b!=="string" || !b || a===b)throw routeError(422,"PACKSHIP_CAPTURE_INVALID");
 }
 return c;
}
