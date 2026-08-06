import type{Pool}from'pg';export class AccessReadinessProbe{constructor(private readonly pool:Pool){}
 async check(){const{rows}=await this.pool.query<{ok:boolean;details:unknown}>('SELECT * FROM forensic.d7h1_r5_readiness()');
 const r=rows[0];return{name:'domain7h1-access',critical:true,ready:r?.ok===true,details:r?.details??{},checkedAt:new Date().toISOString()}}
}
