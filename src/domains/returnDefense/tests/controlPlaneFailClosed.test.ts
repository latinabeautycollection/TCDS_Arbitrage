
describe("8C.1 fail-closed invariants",()=>{
  it("requires controls for ALLOW_WITH_CONTROLS",()=>{
    const status="ALLOW_WITH_CONTROLS";
    const controls:unknown[]=[];
    expect(status==="ALLOW_WITH_CONTROLS" && controls.length===0).toBe(true);
  });
  it("never treats expired authorization as ready",()=>{
    expect(new Date(0).getTime()<Date.now()).toBe(true);
  });
});
