jest.mock("../../../src/domains/operations/repositories/suppressionRepository",()=>({
  getMatchingSuppressionRules:jest.fn(async()=>[
    {ruleId:"g",ruleKey:"GLOBAL",windowSeconds:300,groupingStrategy:"EVENT_ONLY",groupingFields:[]},
    {ruleId:"s",ruleKey:"SMS_ONLY",channel:"SMS",windowSeconds:300,groupingStrategy:"EVENT_ONLY",groupingFields:[]}
  ]),
  hasRecentMatchingDecision:jest.fn(async(args:any)=>args.ruleId==="s")
}));
import { evaluateSuppression } from "../../../src/domains/operations/engines/suppressionEngine";

describe("suppressionEngine",()=>{
  it("evaluates every matching rule and preserves channel scope",async()=>{
    const result=await evaluateSuppression({
      eventType:"WORKER_FAILURE",decisionBasisAt:new Date().toISOString(),
      correlationId:"c",payload:{}
    } as any);
    expect(result).toHaveLength(2);
    expect(result.find(x=>x.ruleKey==="GLOBAL")?.suppressed).toBe(false);
    expect(result.find(x=>x.ruleKey==="SMS_ONLY")?.suppressed).toBe(true);
    expect(result.find(x=>x.ruleKey==="SMS_ONLY")?.channel).toBe("SMS");
  });
});
