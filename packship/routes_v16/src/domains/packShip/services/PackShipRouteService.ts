import type { PackShipV02Repository } from "../repositories/PackShipV02Repository";
import type { PackShipTaskResponseMapper } from "../mappers/PackShipTaskResponseMapper";
import type {
  OperationHeaders, PackagingOptionsResponse, V022PackagingOption, V022PackagingOptionsResult, V02Result,
} from "../contracts/packShipRouteTypes";
import { routeError } from "../auth/PackShipPrincipalResolver";

export class PackShipRouteService {
  constructor(
    private readonly repo: PackShipV02Repository,
    private readonly mapper: PackShipTaskResponseMapper,
  ) {}

  async mapResult(result: V02Result, expected?: {taskId?:string;shipmentId?:string}) {
    // A wrong scan is a normal outcome, already recorded by the database as evidence (row version unchanged).
    // 422 makes PR #13 classify it as REJECTED ("scan again"), never UNCERTAIN (5xx) or CONFLICT (409).
    if (result && result.ok === false && typeof result.code === "string" &&
        Object.prototype.hasOwnProperty.call(WRONG_SCAN_CODES, result.code)) {
      throw routeError(422, WRONG_SCAN_CODES[result.code]);
    }
    if (!result || result.ok !== true) {
      const code=typeof result?.code==="string" && /^PACKSHIP_[A-Z0-9_]+$/.test(result.code)
        ? result.code : "PACKSHIP_BACKEND_REJECTED";
      throw routeError(backendHttpStatus(code),code);
    }
    if(!result.task) throw routeError(502,"PACKSHIP_TASK_SNAPSHOT_MISSING");
    if(expected?.taskId && result.task.packingTaskId !== expected.taskId)
      throw routeError(502,"PACKSHIP_CROSS_TASK_RESPONSE");
    if(expected?.shipmentId && result.task.shipment?.shipmentId !== expected.shipmentId)
      throw routeError(502,"PACKSHIP_CROSS_SHIPMENT_RESPONSE");
    return this.mapper.map(result.task);
  }

  async listPackagingOptions(authSessionId:string,taskId:string):Promise<PackagingOptionsResponse>{
    return mapPackagingOptions(await this.repo.listPackagingOptions(authSessionId,taskId),taskId);
  }
  getTask(authSessionId:string,taskId:string){return this.repo.getTask(authSessionId,taskId).then(r=>this.mapResult(r,{taskId}));}
  claim(authSessionId:string,taskId:string,op:OperationHeaders){return this.repo.claim(authSessionId,taskId,op).then(r=>this.mapResult(r,{taskId}));}
  verifySource(input:any){return this.repo.verifySource(input).then(r=>this.mapResult(r,{taskId:input.taskId}));}
  verifyItem(input:any){return this.repo.verifyItem(input).then(r=>this.mapResult(r,{taskId:input.taskId}));}
  selectPackage(input:any){return this.repo.selectPackage(input).then(r=>this.mapResult(r,{taskId:input.taskId}));}
  recordMeasurements(input:any){return this.repo.recordMeasurements(input).then(r=>this.mapResult(r,{taskId:input.taskId}));}
  complete(input:any){return this.repo.complete(input).then(r=>this.mapResult(r,{taskId:input.taskId}));}
  verifyLabel(input:any){return this.repo.verifyLabel(input).then(r=>this.mapResult(r,{shipmentId:input.shipmentId}));}
  stageOutbound(input:any){return this.repo.stageOutbound(input).then(r=>this.mapResult(r,{shipmentId:input.shipmentId}));}
}

/** V0.2 ok:false scan outcomes → PR #13 message-catalog codes. The three marked NEW need catalog entries in the PWA. */
export const WRONG_SCAN_CODES: Record<string, string> = {
  WRONG_ITEM: "PACK_WRONG_SERIALIZED_ITEM",
  ITEM_ALREADY_VERIFIED: "PACK_DUPLICATE_SCAN",
  TRACKING_MISMATCH: "SHIP_TRACKING_MISMATCH",
  WRONG_SOURCE: "PACK_WRONG_SOURCE",                   // NEW catalog entry
  PACKAGE_MISMATCH: "SHIP_PACKAGE_LABEL_MISMATCH",     // NEW catalog entry
  WRONG_LOCATION: "PACK_WRONG_OUTBOUND_LOCATION",      // NEW catalog entry
};

function backendHttpStatus(code:string):number {
 if(code.includes("NOT_FOUND"))return 404;
 if(code.includes("FACILITY_MISMATCH")||code.includes("ACTOR_NOT_ALLOWED"))return 403;
 if(code.includes("SESSION_INVALID"))return 401;
 if(code.includes("INPUT_INVALID")||code.includes("IDEMPOTENCY_KEY_REUSED"))return 422;
 return 409;
}

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const numOrNull=(v:unknown)=>v===null||v===undefined?null:(typeof v==="number"&&Number.isFinite(v)?v:NaN);
const str=(v:unknown)=>typeof v==="string"&&v.length>0&&v.length<=200;

/** Pure: V0.2.2 list result → packship.packaging-options.v1. Refuses anything it cannot vouch for (502). */
export function mapPackagingOptions(result:V022PackagingOptionsResult, taskId:string):PackagingOptionsResponse{
  if(!result || result.ok!==true){
    const code=typeof result?.code==="string" && /^PACKSHIP_[A-Z0-9_]+$/.test(result.code)?result.code:"PACKSHIP_BACKEND_REJECTED";
    throw routeError(backendHttpStatus(code),code);
  }
  if(result.packingTaskId!==taskId) throw routeError(502,"PACKSHIP_CROSS_TASK_RESPONSE");
  const bad=()=>routeError(502,"PACKSHIP_PACKAGING_OPTIONS_INVALID");
  const b=result.basis;
  if(!str(result.taskStatus)||!Number.isSafeInteger(result.taskRowVersion)||typeof result.selectable!=="boolean"
     ||!str(result.eligibilityRule)||!Array.isArray(result.options)||!b||typeof b!=="object") throw bad();
  const basis={itemCount:Number(b.itemCount),knownWeightOz:Number(b.knownWeightOz),itemsWithoutWeight:Number(b.itemsWithoutWeight),
    categories:Array.isArray(b.categories)?b.categories.filter((c:unknown)=>typeof c==="string"):[],itemsWithoutCategory:Number(b.itemsWithoutCategory)};
  if([basis.itemCount,basis.knownWeightOz,basis.itemsWithoutWeight,basis.itemsWithoutCategory].some(n=>!Number.isFinite(n)||n<0)) throw bad();
  const seen=new Set<string>();
  const options=result.options.map((o:any):V022PackagingOption=>{
    if(!o||typeof o!=="object"||typeof o.profileId!=="string"||!UUID.test(o.profileId)||seen.has(o.profileId)
       ||!str(o.profileCode)||!str(o.profileName)||!str(o.packagingTypeCode)||!Number.isSafeInteger(o.version)||o.version<1) throw bad();
    seen.add(o.profileId);
    const out={profileId:o.profileId,profileCode:o.profileCode,profileName:o.profileName,version:o.version,
      packagingTypeCode:o.packagingTypeCode,itemCategoryKey:typeof o.itemCategoryKey==="string"?o.itemCategoryKey:null,
      maximumWeightOz:numOrNull(o.maximumWeightOz),minimumLengthIn:numOrNull(o.minimumLengthIn),
      minimumWidthIn:numOrNull(o.minimumWidthIn),minimumHeightIn:numOrNull(o.minimumHeightIn)};
    if([out.maximumWeightOz,out.minimumLengthIn,out.minimumWidthIn,out.minimumHeightIn].some(n=>Number.isNaN(n))) throw bad();
    return out;
  });
  return {contractVersion:"packship.packaging-options.v1",taskId,taskStatus:result.taskStatus as string,
    taskRowVersion:result.taskRowVersion as number,selectable:result.selectable,eligibilityRule:result.eligibilityRule as string,
    basis,options};
}
