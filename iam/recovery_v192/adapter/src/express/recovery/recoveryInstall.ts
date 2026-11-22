import type {Express,RequestHandler} from 'express';
import type {Pool} from 'pg';
import Redis from 'ioredis';
import type {IdentityEnv} from '../../config/env';
import type {RateLimitService} from '../../services/rateLimitService';
import type {PasswordResetService} from '../../services/passwordResetService';
import {loadRecoveryConfig,deriveRecoveryKeys} from './recoveryConfig';
import {RecoveryStore} from './recoveryStore';
import {recoveryRouter} from './recoveryRoutes';
import {RecoveryWorkers} from './recoveryWorkers';
import {transportFor} from './recoveryDelivery';

export interface RecoveryInstallDeps{pool:Pool;env:IdentityEnv;limits:RateLimitService;resets:PasswordResetService;common:RequestHandler[]}

/**
 * Mounts /api/v1/auth/password-recovery behind the same 6.1B security chain as /api/v1/auth, and starts the code
 * issuance + delivery workers. Does nothing unless RECOVERY_ENABLED=true (config.json api.*). Must be called before
 * the /api/v1/auth mount so the recovery paths are handled here.
 */
export function installRecovery(app:Express,d:RecoveryInstallDeps){
  const cfg=loadRecoveryConfig(process.env);
  if(!cfg)return null;
  const keys=deriveRecoveryKeys(cfg.RECOVERY_MASTER_KEY);
  const redis=new Redis(d.env.REDIS_URL,{maxRetriesPerRequest:2,enableOfflineQueue:true});
  redis.on('error',e=>console.error(JSON.stringify({level:'error',msg:'recovery redis error',error:e.message})));
  const store=new RecoveryStore(redis as any,keys.cookie,keys.token);
  app.use('/api/v1/auth/password-recovery',...d.common,recoveryRouter({pool:d.pool,env:d.env,limits:d.limits,resets:d.resets,cfg,keys,store}));
  const workers=cfg.RECOVERY_WORKERS_ENABLED?new RecoveryWorkers(d.pool,keys,transportFor(cfg),cfg.RECOVERY_LINK_BASE,cfg.RECOVERY_TICK_MS):null;
  workers?.start();
  console.log(JSON.stringify({level:'info',msg:'password recovery mounted',workers:!!workers,delivery:cfg.RECOVERY_DELIVERY_MODE}));
  return {close:async()=>{await workers?.stop();await redis.quit().catch(()=>{});}};
}
