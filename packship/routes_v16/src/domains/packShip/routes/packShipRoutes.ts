import { Router } from "express";
import type { PackShipPrincipalResolver } from "../auth/PackShipPrincipalResolver";
import type { PackShipRouteService } from "../services/PackShipRouteService";
import { requireOperationHeaders } from "../http/operationHeaders";
import { captureFromBody, captureFromLabelEvidence } from "../services/captureEvidence";
import { validatePackShipRequest } from "../http/requestValidation";

export function buildPackShipRoutes(input:{
  principalResolver: PackShipPrincipalResolver;
  service: PackShipRouteService;
}):Router{
  const r=Router();

  r.get("/api/v1/packing/tasks/:taskId", async(req,res,next)=>{
    try{
      const p=await input.principalResolver.resolve(req,res,false);
      validatePackShipRequest(req,"getTask");
      res.setHeader("Cache-Control","no-store");
      res.json(await input.service.getTask(p.authSessionId,req.params.taskId));
    }catch(e){next(e)}
  });

  r.post("/api/v1/packing/tasks/:taskId/completion-check", async(req,res,next)=>{
    try{
      const p=await input.principalResolver.resolve(req,res,true);
      validatePackShipRequest(req,"completionCheck");
      res.setHeader("Cache-Control","no-store");
      res.json(await input.service.getTask(p.authSessionId,req.params.taskId));
    }catch(e){next(e)}
  });

  r.post("/api/v1/packing/tasks/:taskId/claim", async(req,res,next)=>{
    try{
      const p=await input.principalResolver.resolve(req,res,true);
      validatePackShipRequest(req,"claim");
      res.json(await input.service.claim(p.authSessionId,req.params.taskId,requireOperationHeaders(req)));
    }catch(e){next(e)}
  });

  r.post("/api/v1/packing/tasks/:taskId/scan-source", async(req,res,next)=>{
    try{
      const p=await input.principalResolver.resolve(req,res,true);
      validatePackShipRequest(req,"scanSource");
      res.json(await input.service.verifySource({
        authSessionId:p.authSessionId,taskId:req.params.taskId,rowVersion:req.body.rowVersion,
        barcode:req.body.barcode,capture:captureFromBody(req.body),op:requireOperationHeaders(req)
      }));
    }catch(e){next(e)}
  });

  r.post("/api/v1/packing/tasks/:taskId/scan-item", async(req,res,next)=>{
    try{
      const p=await input.principalResolver.resolve(req,res,true);
      validatePackShipRequest(req,"scanItem");
      res.json(await input.service.verifyItem({
        authSessionId:p.authSessionId,taskId:req.params.taskId,rowVersion:req.body.rowVersion,
        barcode:req.body.barcode,capture:captureFromBody(req.body),op:requireOperationHeaders(req)
      }));
    }catch(e){next(e)}
  });

  r.post("/api/v1/packing/tasks/:taskId/package", async(req,res,next)=>{
    try{
      const p=await input.principalResolver.resolve(req,res,true);
      validatePackShipRequest(req,"selectPackage");
      res.json(await input.service.selectPackage({
        authSessionId:p.authSessionId,taskId:req.params.taskId,rowVersion:req.body.rowVersion,
        profileId:req.body.profileId,reason:req.body.reason,op:requireOperationHeaders(req)
      }));
    }catch(e){next(e)}
  });

  r.post("/api/v1/packing/tasks/:taskId/measurements", async(req,res,next)=>{
    try{
      const p=await input.principalResolver.resolve(req,res,true);
      validatePackShipRequest(req,"recordMeasurements");
      res.json(await input.service.recordMeasurements({
        authSessionId:p.authSessionId,taskId:req.params.taskId,taskRowVersion:req.body.rowVersion,
        packageId:req.body.packageId,packageRowVersion:req.body.packageRowVersion,
        weightOz:req.body.weightOz,lengthIn:req.body.lengthIn,widthIn:req.body.widthIn,heightIn:req.body.heightIn,
        weightSource:req.body.weightSource,op:requireOperationHeaders(req)
      }));
    }catch(e){next(e)}
  });

  r.post("/api/v1/packing/tasks/:taskId/seal", async(req,res,next)=>{
    try{
      const p=await input.principalResolver.resolve(req,res,true);
      validatePackShipRequest(req,"complete");
      res.json(await input.service.complete({
        authSessionId:p.authSessionId,taskId:req.params.taskId,taskRowVersion:req.body.rowVersion,
        packageId:req.body.packageId,packageRowVersion:req.body.packageRowVersion,
        op:requireOperationHeaders(req)
      }));
    }catch(e){next(e)}
  });

  r.post("/api/v1/shipments/:shipmentId/label/verify", async(req,res,next)=>{
    try{
      const p=await input.principalResolver.resolve(req,res,true);
      validatePackShipRequest(req,"verifyLabel");
      res.json(await input.service.verifyLabel({
        authSessionId:p.authSessionId,shipmentId:req.params.shipmentId,
        trackingBarcode:req.body.trackingBarcode,packageBarcode:req.body.packageBarcode,
        physicalEvidence:req.body.physicalEvidence,capture:captureFromLabelEvidence(req.body),
        op:requireOperationHeaders(req)
      }));
    }catch(e){next(e)}
  });

  r.post("/api/v1/shipments/:shipmentId/outbound-stage", async(req,res,next)=>{
    try{
      const p=await input.principalResolver.resolve(req,res,true);
      validatePackShipRequest(req,"stageOutbound");
      res.json(await input.service.stageOutbound({
        authSessionId:p.authSessionId,shipmentId:req.params.shipmentId,
        locationBarcode:req.body.locationBarcode,capture:captureFromBody(req.body),
        op:requireOperationHeaders(req)
      }));
    }catch(e){next(e)}
  });

  return r;
}
