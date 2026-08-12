import { Router } from 'express';
import { z } from 'zod';
import type { BackupService } from '../services/backupService';
import type { RestoreService } from '../services/restoreService';

const uuid=z.uuid();
export function createResilienceRoutes(backup:BackupService,restore:RestoreService) {
  const router=Router();
  router.post('/backups',async(req,res,next)=>{try{
    const input=z.object({policyCode:z.string().min(3),sourceDatabaseReference:z.string().min(3),
      primaryObjectKey:z.string().min(3),secondaryObjectKey:z.string().min(3),idempotencyKey:uuid}).strict().parse(req.body);
    res.status(202).json(await backup.execute(req.accessPrincipal!,input));
  }catch(e){next(e)}});
  router.post('/restores',async(req,res,next)=>{try{
    const input=z.object({backupExecutionId:uuid,recoveryNamespace:z.string().regex(/^[a-z][a-z0-9_]{2,62}$/),
      recoveryDatabaseUrl:z.string().min(10),reason:z.string().min(20),idempotencyKey:uuid}).strict().parse(req.body);
    res.status(201).json(await restore.request(req.accessPrincipal!,input));
  }catch(e){next(e)}});
  router.post('/restores/:id/approve',async(req,res,next)=>{try{
    const body=z.object({idempotencyKey:uuid}).strict().parse(req.body);
    res.json(await restore.approve(req.accessPrincipal!,req.params.id!,body.idempotencyKey));
  }catch(e){next(e)}});
  router.post('/restores/:id/reconcile',async(req,res,next)=>{try{
    const body=z.object({idempotencyKey:uuid}).strict().parse(req.body);
    res.json(await restore.reconcile(req.accessPrincipal!,req.params.id!,body.idempotencyKey));
  }catch(e){next(e)}});
  router.post('/restores/:id/certify',async(req,res,next)=>{try{
    const body=z.object({decision:z.enum(['CERTIFY','REJECT']),reason:z.string().min(20),idempotencyKey:uuid}).strict().parse(req.body);
    res.json(await restore.certify(req.accessPrincipal!,req.params.id!,body.decision,body.reason,body.idempotencyKey));
  }catch(e){next(e)}});
  return router;
}
