import { adaptReviewed10BEventIntake } from "../../../src/domains/operations/assurance/adapters/reviewed10BEventIntakeAdapter";

describe("10E reviewed 10B adapter",()=>{
  it("hands assurance fact to 10B without creating notification/provider work",async()=>{
    const accept=jest.fn(async()=>({eventId:"e-1",inserted:true}));
    const port=adaptReviewed10BEventIntake(accept);
    const event:any={
      sourceKey:"DOMAIN10_ASSURANCE",
      sourceEventId:"ASSURANCE:x:COMMUNICATION_ASSURANCE_BREACH",
      eventType:"COMMUNICATION_ASSURANCE_BREACH",
      occurredAt:new Date().toISOString(),
      severity:"HIGH",
      classification:"INTERNAL",
      subjectType:"COMMUNICATION_ASSURANCE_POLICY",
      subjectId:"GRAPH_ACCEPTANCE",
      correlationId:"00000000-0000-4000-8000-000000000001",
      schemaVersion:1,
      producer:"DOMAIN10_10E",
      payload:{}
    };
    const result=await port.acceptOperationalEvent(event);
    expect(result).toEqual({eventId:"e-1",inserted:true});
    expect(accept).toHaveBeenCalledTimes(1);
  });
});
