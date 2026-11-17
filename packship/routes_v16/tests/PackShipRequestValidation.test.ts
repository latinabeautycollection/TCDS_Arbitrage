import { validatePackShipRequest } from "../src/domains/packShip/http/requestValidation";
const UUID="11111111-1111-4111-8111-111111111111";
function req(body:any,headers:Record<string,string>={"content-type":"application/json"}){return {params:{taskId:UUID},body,header:(k:string)=>headers[k.toLowerCase()] } as any;}
describe("HTTP boundary rejects malformed tasks before SQL",()=>{
 it("rejects missing request body",()=>expect(()=>validatePackShipRequest(req(undefined),"scanItem")).toThrow());
 it("rejects invalid row versions",()=>expect(()=>validatePackShipRequest(req({barcode:"ITEM",rowVersion:"1"}),"scanItem")).toThrow());
 it("rejects missing seal package identity",()=>expect(()=>validatePackShipRequest(req({rowVersion:1}),"complete")).toThrow());
 it("rejects bogus measurement values",()=>expect(()=>validatePackShipRequest(req({rowVersion:1,packageId:UUID,packageRowVersion:1,weightOz:-1,lengthIn:10,widthIn:10,heightIn:10}),"recordMeasurements")).toThrow());
 it("rejects malformed task id",()=>expect(()=>validatePackShipRequest({...req({}),params:{taskId:"bad"}},"claim")).toThrow());
 it("accepts minimally valid item scan",()=>expect(validatePackShipRequest(req({rowVersion:4,barcode:"ABC"}),"scanItem")).toEqual({rowVersion:4,barcode:"ABC"}));
});
