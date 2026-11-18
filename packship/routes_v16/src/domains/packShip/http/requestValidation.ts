import type { Request } from "express";
import { routeError } from "../auth/PackShipPrincipalResolver";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
type Body = Record<string, unknown>;
export function validUuid(value: unknown, field: string): string {
  if (typeof value !== "string" || !UUID.test(value)) throw routeError(422, "PACKSHIP_INPUT_INVALID", {field});
  return value;
}
export function validBarcode(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim() || value.length > 1024 || /[\x00-\x08\x0B\x0C\x0E-\x1F]/.test(value))
    throw routeError(422, "PACKSHIP_INPUT_INVALID", {field});
  return value;
}
export function validVersion(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0)
    throw routeError(422, "PACKSHIP_INPUT_INVALID", {field});
  return value;
}
export function validPositive(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0 || value > 1e7)
    throw routeError(422, "PACKSHIP_INPUT_INVALID", {field});
  return value;
}
export function requireBody(req: Request): Body {
  const contentType = req.header("content-type") ?? "";
  if (!/^application\/json(?:\s*;|$)/i.test(contentType)) throw routeError(415, "PACKSHIP_JSON_REQUIRED");
  if (!req.body || typeof req.body !== "object" || Array.isArray(req.body)) throw routeError(422, "PACKSHIP_INPUT_INVALID");
  return req.body as Body;
}
export function validatePackShipRequest(req: Request, action: string): Body {
  if (req.params.taskId !== undefined) validUuid(req.params.taskId, "taskId");
  if (req.params.shipmentId !== undefined) validUuid(req.params.shipmentId, "shipmentId");
  if (action === "getTask" || action === "completionCheck" || action === "packagingOptions") return {};
  const b = requireBody(req);
  switch (action) {
    case "claim": break;
    case "scanSource": case "scanItem":
      validVersion(b.rowVersion, "rowVersion"); validBarcode(b.barcode, "barcode"); break;
    case "selectPackage":
      validVersion(b.rowVersion, "rowVersion"); validUuid(b.profileId, "profileId");
      if (b.reason !== undefined && (typeof b.reason !== "string" || b.reason.length > 2000)) throw routeError(422,"PACKSHIP_INPUT_INVALID",{field:"reason"});
      break;
    case "recordMeasurements":
      validVersion(b.rowVersion,"rowVersion"); validUuid(b.packageId,"packageId"); validVersion(b.packageRowVersion,"packageRowVersion");
      for (const k of ["weightOz","lengthIn","widthIn","heightIn"]) validPositive(b[k],k);
      if (b.weightSource !== undefined && (b.weightSource === null || typeof b.weightSource !== "object" || Array.isArray(b.weightSource)))
        throw routeError(422,"PACKSHIP_INPUT_INVALID",{field:"weightSource"});
      break;
    case "complete":
      validVersion(b.rowVersion,"rowVersion"); validUuid(b.packageId,"packageId"); validVersion(b.packageRowVersion,"packageRowVersion"); break;
    case "verifyLabel":
      validBarcode(b.trackingBarcode,"trackingBarcode"); validBarcode(b.packageBarcode,"packageBarcode"); break;
    case "stageOutbound": validBarcode(b.locationBarcode,"locationBarcode"); break;
    default: throw routeError(500,"PACKSHIP_ROUTE_ACTION_UNKNOWN");
  }
  return b;
}
