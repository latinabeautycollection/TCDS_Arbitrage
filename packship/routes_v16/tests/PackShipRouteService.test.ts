import {PackShipRouteService} from "../src/domains/packShip/services/PackShipRouteService";
describe("V0.2 rejection",()=>{
 const service=new PackShipRouteService({} as any,{map:jest.fn()} as any);
 it("does not map business rejection into success",async()=>await expect(service.mapResult({ok:false,code:"PACKSHIP_ROW_VERSION_CONFLICT"})).rejects.toMatchObject({status:409,code:"PACKSHIP_ROW_VERSION_CONFLICT"}));
 it("fails closed without authoritative task",async()=>await expect(service.mapResult({ok:true,code:"OK"})).rejects.toMatchObject({status:502,code:"PACKSHIP_TASK_SNAPSHOT_MISSING"}));
});
