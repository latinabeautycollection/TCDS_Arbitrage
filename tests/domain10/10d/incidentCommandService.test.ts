import { parseSmsIncidentCommand } from "../../../src/domains/operations/incidents/services/incidentCommandService";
describe("10D SMS incident command parser",()=>{
 it("accepts explicit ACK/OWN/DECLINE plus incident key",()=>{
  expect(parseSmsIncidentCommand("ACK INC-20260813-ABC123")).toEqual({command:"ACK",incidentKey:"INC-20260813-ABC123"});
  expect(parseSmsIncidentCommand("OWN inc-20260813-abc123")).toEqual({command:"OWN",incidentKey:"INC-20260813-ABC123"});
 });
 it("does not consume START/STOP/HELP",()=>{
  expect(parseSmsIncidentCommand("STOP")).toBeNull();expect(parseSmsIncidentCommand("HELP")).toBeNull();expect(parseSmsIncidentCommand("START")).toBeNull();
 });
});
