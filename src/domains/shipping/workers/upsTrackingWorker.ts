import { Pool } from "pg";
import { UpsApi } from "../providers/upsApi";
import { UpsRepository } from "../repositories/upsRepository";
export class UpsTrackingWorker { constructor(private readonly db: Pool, private readonly api=new UpsApi(), private readonly repository=new UpsRepository(db)) {} async pollTrackingNumbers(trackingNumbers: string[]) { const results=[]; for (const trackingNumber of trackingNumbers) { const response=await this.api.track(trackingNumber,{returnMilestones:true,returnPOD:true}); const snapshotId=await this.repository.recordTracking({trackingNumber,response}); results.push({trackingNumber,snapshotId}); } return results; } }
