jest.mock("../../../src/domains/operations/repositories/policyRepository",()=>({
  getPolicyCandidates:jest.fn(async()=>[
    {policyId:"a",policyKey:"A",policyVersion:1,decisionPriority:100,patternSpecificity:7,templates:[],
     definitionHash:"h",eventTypePattern:"WORKER_*",minimumSeverity:"NOTICE",maximumClassification:"INTERNAL",
     audienceId:"x",audienceKey:"OPS",audienceType:"STATIC",emailEnabled:false,smsEnabled:false,
     acknowledgementRequired:false,incidentRequired:false,suppressionWindowSeconds:0,maxDeliveryAttempts:5},
    {policyId:"b",policyKey:"B",policyVersion:1,decisionPriority:100,patternSpecificity:7,templates:[],
     definitionHash:"h",eventTypePattern:"WORKER_*",minimumSeverity:"NOTICE",maximumClassification:"INTERNAL",
     audienceId:"x",audienceKey:"OPS",audienceType:"STATIC",emailEnabled:false,smsEnabled:false,
     acknowledgementRequired:false,incidentRequired:false,suppressionWindowSeconds:0,maxDeliveryAttempts:5}
  ])
}));
import { resolveAuthoritativePolicy } from "../../../src/domains/operations/engines/notificationPolicyEngine";

describe("notificationPolicyEngine",()=>{
  it("fails closed on a top-precedence tie",async()=>{
    await expect(resolveAuthoritativePolicy({eventType:"WORKER_FAILURE"} as any))
      .rejects.toMatchObject({code:"POLICY_AMBIGUOUS"});
  });
});
