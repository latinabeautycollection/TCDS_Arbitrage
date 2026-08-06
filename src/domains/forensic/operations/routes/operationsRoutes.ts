import { Router } from 'express';
import { z } from 'zod';
import type { OperationsService } from '../services/operationsService';

export function createOperationsRoutes(service: OperationsService) {
  const router=Router();

  router.post('/alerts',async(req,res,next)=>{try{
    const b=z.object({code:z.string().min(3),severity:z.enum(['INFO','WARNING','HIGH','CRITICAL']),
      sourceType:z.string().min(2),sourceReference:z.string().min(1),summary:z.string().min(10),
      details:z.record(z.string(),z.unknown()),dedupeKey:z.string().min(3)}).strict().parse(req.body);
    res.status(201).json(await service.createAlert(req.accessPrincipal!,b));
  }catch(e){next(e)}});

  router.get('/alerts',async(req,res,next)=>{try{
    res.json(await service.listAlerts(req.accessPrincipal!,
      typeof req.query.status==='string'?req.query.status:undefined));
  }catch(e){next(e)}});

  router.get('/alerts/:id',async(req,res,next)=>{try{
    res.json(await service.getAlert(req.accessPrincipal!,req.params.id!));
  }catch(e){next(e)}});

  router.get('/alerts/:id/events',async(req,res,next)=>{try{
    res.json(await service.alertEvents(req.accessPrincipal!,req.params.id!));
  }catch(e){next(e)}});

  router.get('/alerts/:id/verify',async(req,res,next)=>{try{
    res.json(await service.verifyAlert(req.accessPrincipal!,req.params.id!));
  }catch(e){next(e)}});

  router.post('/alerts/:id/transition',async(req,res,next)=>{try{
    const b=z.object({action:z.enum(['ACKNOWLEDGE','ASSIGN','ESCALATE','CLOSE','REOPEN']),
      reason:z.string().min(10),assignee:z.uuid().optional()}).strict().parse(req.body);
    res.json(await service.transition(req.accessPrincipal!,req.params.id!,b.action,b.reason,b.assignee));
  }catch(e){next(e)}});

  router.get('/command-center',async(req,res,next)=>{try{
    res.json(await service.snapshot(req.accessPrincipal!));
  }catch(e){next(e)}});

  router.post('/executive-reports',async(req,res,next)=>{try{
    const b=z.object({reportDate:z.iso.date(),asOfAt:z.iso.datetime(),
      schemaVersion:z.string().min(1),idempotencyKey:z.uuid()}).strict().parse(req.body);
    res.status(201).json(await service.report(req.accessPrincipal!,b));
  }catch(e){next(e)}});

  router.get('/executive-reports',async(req,res,next)=>{try{
    res.json(await service.reports(req.accessPrincipal!));
  }catch(e){next(e)}});

  router.post('/handoffs',async(req,res,next)=>{try{
    const b=z.object({releaseDecisionId:z.uuid(),handoffCode:z.string().min(3),
      ownerUserId:z.uuid(),backupOwnerUserId:z.uuid(),runbookUri:z.string().min(3),
      ownership:z.record(z.string(),z.unknown())}).strict().parse(req.body);
    res.status(201).json(await service.createHandoff(req.accessPrincipal!,b));
  }catch(e){next(e)}});

  router.get('/handoffs',async(req,res,next)=>{try{
    res.json(await service.handoffs(req.accessPrincipal!));
  }catch(e){next(e)}});

  router.post('/handoffs/:id/attest',async(req,res,next)=>{try{
    const b=z.object({decision:z.enum(['ACCEPT','REJECT']),notes:z.string().min(20)}).strict().parse(req.body);
    res.json(await service.attest(req.accessPrincipal!,req.params.id!,b.decision,b.notes));
  }catch(e){next(e)}});

  return router;
}
