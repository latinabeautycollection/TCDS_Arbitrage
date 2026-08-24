jest.mock("../../../src/domains/operations/config/operationsEnv",()=>({operationsEnv:()=>({
  DOMAIN10_EVENT_MAX_PAYLOAD_BYTES:1024,DOMAIN10_EVENT_MAX_CLOCK_SKEW_SECONDS:300
})}));
import {
  validateEnvelope,validatePayloadAgainstContract
} from "../../../src/domains/operations/validators/eventEnvelopeValidator";

describe("event validation",()=>{
  it("validates the frozen JSON-schema payload",()=>{
    const e=validateEnvelope({
      sourceKey:"DOMAIN_3_SHIPPING",sourceEventId:"1",eventType:"WORKER_FAILURE",
      occurredAt:new Date().toISOString(),severity:"HIGH",classification:"INTERNAL",
      correlationId:"00000000-0000-4000-8000-000000000001",
      schemaVersion:1,producer:"test",payload:{code:"E1"}
    });
    expect(()=>validatePayloadAgainstContract(e,{
      eventType:"WORKER_FAILURE",schemaVersion:1,lifecycleState:"FROZEN",
      jsonSchema:{type:"object",required:["code"],properties:{code:{type:"string"}},additionalProperties:false},
      schemaHash:"h",requiredTopLevelFields:["code"],topLevelTypes:{code:"string"}
    })).not.toThrow();
  });

  it("rejects future-skewed events",()=>{
    const future=new Date(Date.now()+3600_000).toISOString();
    expect(()=>validateEnvelope({
      sourceKey:"DOMAIN_3_SHIPPING",sourceEventId:"1",eventType:"WORKER_FAILURE",
      occurredAt:future,severity:"HIGH",classification:"INTERNAL",
      correlationId:"00000000-0000-4000-8000-000000000001",
      schemaVersion:1,producer:"test",payload:{code:"E1"}
    })).toThrow(/future/i);
  });
});
