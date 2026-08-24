import { adaptReviewed10BEventIntake } from "../../../src/domains/operations/incidents/adapters/notificationDecisionAdapter";
describe("10D -> reviewed 10B bridge",()=>{
 it("delegates escalation fact to 10B event intake without planning or sending",async()=>{
  let captured:any;const port=adaptReviewed10BEventIntake(async(input)=>{captured=input;return {eventId:"00000000-0000-4000-8000-000000000001",inserted:true};});
  const event:any={sourceKey:"DOMAIN_10_OPERATIONS",sourceEventId:"INC_ESC:x:1",eventType:"INC_ESC_TEST",occurredAt:new Date().toISOString(),severity:"HIGH",classification:"INTERNAL",subjectType:"INCIDENT",subjectId:"i",correlationId:"00000000-0000-4000-8000-000000000002",schemaVersion:1,producer:"DOMAIN10_10D",payload:{}};
  const r=await port.acceptOperationalEvent(event);expect(captured).toBe(event);expect(r.inserted).toBe(true);
 });
});
