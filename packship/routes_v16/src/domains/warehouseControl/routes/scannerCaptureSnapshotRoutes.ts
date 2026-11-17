import { Router } from "express";
import type { Request, Response } from "express";
/** Structural integration seam: actual certified Warehouse Identity/Control adapters are injected at mount time. */
export interface ScannerPrincipalResolver {
  resolve(req:Request,res:Response,policy:{requireCsrf:boolean;requiredPermission:string;allowedAssuranceLevels:readonly ("AAL1"|"AAL2")[]}):Promise<unknown>;
}
export interface CaptureAuthorityRepository {
  loadSnapshot(principal:unknown):Promise<unknown>;
}

export function buildScannerCaptureSnapshotRoutes(input:{
  principalResolver:ScannerPrincipalResolver;
  captureAuthority:CaptureAuthorityRepository;
  allowedAssuranceLevels:readonly ("AAL1"|"AAL2")[];
}):Router{
  const r=Router();
  r.get("/api/v1/warehouse-control/scanner/capture-snapshot",async(req,res,next)=>{
    try{
      const principal=await input.principalResolver.resolve(req,res,{
        requireCsrf:false,requiredPermission:"PACKSHIP_PACK",
        allowedAssuranceLevels:input.allowedAssuranceLevels
      });
      res.setHeader("Cache-Control","no-store");
      res.json(await input.captureAuthority.loadSnapshot(principal));
    }catch(e){next(e)}
  });
  return r;
}
