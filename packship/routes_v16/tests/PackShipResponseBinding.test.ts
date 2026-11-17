import { PackShipRouteService } from "../src/domains/packShip/services/PackShipRouteService";
const TASK="11111111-1111-4111-8111-111111111111";
const OTHER="22222222-2222-4222-8222-222222222222";
describe("V0.2 authoritative identity binding",()=>{
 const mapper={map:jest.fn(async()=>({ok:true}))};const service=new PackShipRouteService({} as any,mapper as any);
 it("rejects cross-task snapshot before mapping",async()=>{
  await expect(service.mapResult({ok:true,code:"OK",task:{packingTaskId:OTHER} as any},{taskId:TASK})).rejects.toMatchObject({code:"PACKSHIP_CROSS_TASK_RESPONSE"});
 });
 it("rejects cross-shipment snapshot",async()=>{
  await expect(service.mapResult({ok:true,code:"OK",task:{packingTaskId:TASK,shipment:{shipmentId:OTHER}} as any},{shipmentId:TASK})).rejects.toMatchObject({code:"PACKSHIP_CROSS_SHIPMENT_RESPONSE"});
 });
});
