export interface ReplayContext{releaseCandidateId:string;scenarioCode:string;scenarioVersion:number;fixtureReference:string;input:Record<string,unknown>;policyVersionId?:string;configurationSha256?:string}
export interface ReplayAdapter{target:string;execute(context:ReplayContext):Promise<Record<string,unknown>>}
export class ReplayAdapterRegistry{
 private readonly m=new Map<string,ReplayAdapter>();
 register(adapter:ReplayAdapter){if(this.m.has(adapter.target))throw new Error(`DUPLICATE_REPLAY_ADAPTER:${adapter.target}`);this.m.set(adapter.target,adapter);return this}
 require(target:string){const a=this.m.get(target);if(!a)throw Object.assign(new Error(`REPLAY_ADAPTER_UNAVAILABLE:${target}`),{statusCode:503});return a}
}
export class ReplayExecutionEngine{
 constructor(private readonly adapters:ReplayAdapterRegistry){}
 async execute(target:string,context:ReplayContext){return this.adapters.require(target).execute(context)}
}
