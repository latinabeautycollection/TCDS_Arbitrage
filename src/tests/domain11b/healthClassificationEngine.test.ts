import { HealthClassificationEngine } from "../../domains/governance/engines/healthClassificationEngine";
import type { HealthCheckDefinition, HealthCheckRuntime } from "../../domains/governance/models/healthTypes";
const definition: HealthCheckDefinition = {id:"d",componentId:"c",checkCode:"HTTP",version:1,mode:"PULL",kind:"HTTP",successState:"FUNCTIONAL",requiredForComponentHealth:true,degradesComponentHealth:true,intervalSeconds:30,timeoutMs:1000,observationTtlSeconds:90,failureThreshold:2,recoveryThreshold:2,jitterSeconds:0,configuration:{}};
const runtime=(over:Partial<HealthCheckRuntime>={}):HealthCheckRuntime=>({definitionId:"d",componentId:"c",consecutiveSuccesses:0,consecutiveFailures:0,...over});
describe("HealthClassificationEngine",()=>{
  it("degrades first failure then becomes unavailable at threshold",()=>{const e=new HealthClassificationEngine();expect(e.classify(definition,runtime(),{outcome:"FAILURE",evidence:{}}).healthState).toBe("DEGRADED");expect(e.classify(definition,runtime({consecutiveFailures:1,lastHealthState:"DEGRADED"}),{outcome:"FAILURE",evidence:{}}).healthState).toBe("UNAVAILABLE");});
  it("requires consecutive successes for recovery",()=>{const e=new HealthClassificationEngine();expect(e.classify(definition,runtime({lastHealthState:"UNAVAILABLE"}),{outcome:"SUCCESS",evidence:{}}).healthState).toBe("DEGRADED");expect(e.classify(definition,runtime({lastHealthState:"DEGRADED",consecutiveSuccesses:1}),{outcome:"SUCCESS",evidence:{}}).healthState).toBe("FUNCTIONAL");});
});
