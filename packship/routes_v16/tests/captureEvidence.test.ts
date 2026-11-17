import {captureFromBody,captureFromLabelEvidence} from "../src/domains/packShip/services/captureEvidence";
describe("capture evidence",()=>{
 const CAM={source:"CAMERA",provider:"scandit",capturedAt:"2026-11-17T04:00:00Z",canonicalSymbology:"EAN13_UPCA",observationId:"o"};
 it("preserves genuine capture source",()=>expect(captureFromBody({capture:CAM})).toMatchObject({source:"CAMERA",observationId:"o",canonicalSymbology:"EAN13_UPCA"}));
 it("refuses CAMERA without provider, timestamp or symbology family (V1.5 rule)",()=>{
  for(const k of ["provider","capturedAt","canonicalSymbology","observationId"]){const c:any={...CAM};delete c[k];
   expect(()=>captureFromBody({capture:c})).toThrow("PACKSHIP_CAPTURE_INVALID");}
 });
 it("refuses an exact symbology as the family (EAN13 is not EAN13_UPCA)",()=>expect(()=>captureFromBody({capture:{...CAM,canonicalSymbology:"EAN13"}})).toThrow());
 it("refuses unknown capture fields",()=>expect(()=>captureFromBody({capture:{...CAM,extra:1}})).toThrow());
 it("does not fabricate MANUAL",()=>expect(captureFromBody({})).toEqual({}));
 it("rejects forged source",()=>expect(()=>captureFromBody({capture:{source:"FAKE"}})).toThrow());
 it("rejects reused physical observation",()=>expect(()=>captureFromLabelEvidence({physicalEvidence:{tracking:{observationId:"same"},package:{observationId:"same"}}})).toThrow());
});
