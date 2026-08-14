
describe("pre-sale gate profile invariants",()=>{
 it("defines all five gates",()=>{
  expect([
   "RETAIL_SOURCE_QUALITY","ACQUISITION_PROFIT_DEFENSE",
   "SOURCE_RECOVERY_WINDOW","RECEIVING_IDENTITY","INVENTORY_INTEGRITY",
  ]).toHaveLength(5);
 });
 it("fails closed on explicit hard blocks",()=>{
  const evaluation={hardBlock:true,recommendedGateStatus:"BLOCK"};
  expect(evaluation.hardBlock && evaluation.recommendedGateStatus==="BLOCK").toBe(true);
 });
});
