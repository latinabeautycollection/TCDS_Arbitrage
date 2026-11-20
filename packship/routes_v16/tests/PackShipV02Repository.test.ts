// V1.6.1 (2026-11-20, found on the LV2TEST run): a typed label pair (no physicalEvidence) was sent as the jsonb value
// null instead of SQL NULL, so packship_verify_label_pair_v2 refused every typed pair with PACKSHIP_INPUT_INVALID (422).
import {PackShipV02Repository} from "../src/domains/packShip/repositories/PackShipV02Repository";
const OP={idempotencyKey:"k-1",requestId:"00000000-0000-4000-8000-000000000001",correlationId:"00000000-0000-4000-8000-000000000002"};
function fake(){const calls:any[]=[];return{calls,pool:{query:async(sql:string,values:unknown[])=>{calls.push({sql,values});return{rows:[{result:{ok:true,code:"OK"}}]};}}};}
const base={authSessionId:"00000000-0000-4000-8000-0000000000aa",shipmentId:"00000000-0000-4000-8000-0000000000bb",
  trackingBarcode:"1ZPSTEST4393930010",packageBarcode:"TCDS-PKG-1D21A05BA6C1",capture:{}};
describe("verifyLabel physical evidence parameter ($5)",()=>{
 it("absent evidence (typed pair, the PWA omits the field) is SQL NULL, not the JSON text 'null'",async()=>{
  const f=fake();await new PackShipV02Repository(f.pool as any).verifyLabel({...base,op:OP} as any);
  expect(f.calls[0].sql).toContain("packship_verify_label_pair_v2");
  expect(f.calls[0].values[4]).toBeNull();
  expect(f.calls[0].values[5]).toBe("{}");
 });
 it("explicit null evidence in the body is SQL NULL too",async()=>{
  const f=fake();await new PackShipV02Repository(f.pool as any).verifyLabel({...base,physicalEvidence:null,op:OP} as any);
  expect(f.calls[0].values[4]).toBeNull();
 });
 it("camera evidence is still sent as its JSON object",async()=>{
  const ev={labelPairId:"lp-1",tracking:{labelPairId:"lp-1",observationId:"t"},package:{observationId:"p"}};
  const f=fake();await new PackShipV02Repository(f.pool as any).verifyLabel({...base,physicalEvidence:ev,op:OP} as any);
  expect(JSON.parse(f.calls[0].values[4] as string)).toEqual(ev);
 });
 it("parameter order matches the function signature",async()=>{
  const f=fake();await new PackShipV02Repository(f.pool as any).verifyLabel({...base,op:OP} as any);
  expect(f.calls[0].values).toEqual([base.authSessionId,base.shipmentId,base.trackingBarcode,base.packageBarcode,null,"{}",OP.idempotencyKey,OP.requestId,OP.correlationId]);
 });
});
