
import type { PoolClient } from "pg";
import type { PreSaleGateStage, GateEvaluation } from "../gates/gateTypes";
import type { RequestContext } from "../repositories/preventionControlPlaneRepository";
import { PreSaleGateRepository } from "../repositories/preSaleGateRepository";
import { RetailSourceQualityGate } from "../gates/retailSourceQualityGate";
import { AcquisitionProfitDefenseGate } from "../gates/acquisitionProfitDefenseGate";
import { SourceRecoveryWindowGate } from "../gates/sourceRecoveryWindowGate";
import { ReceivingIdentityGate } from "../gates/receivingIdentityGate";
import { InventoryIntegrityGate } from "../gates/inventoryIntegrityGate";

export class PreSaleGateOrchestrationService {
  private readonly gates = {
    RETAIL_SOURCE_QUALITY:new RetailSourceQualityGate(),
    ACQUISITION_PROFIT_DEFENSE:new AcquisitionProfitDefenseGate(),
    SOURCE_RECOVERY_WINDOW:new SourceRecoveryWindowGate(),
    RECEIVING_IDENTITY:new ReceivingIdentityGate(),
    INVENTORY_INTEGRITY:new InventoryIntegrityGate(),
  } as const;

  public constructor(private readonly repository:PreSaleGateRepository){}

  public evaluate(
    ctx:RequestContext,
    stage:PreSaleGateStage,
    passportId:string,
    input:Record<string,unknown>,
  ):Promise<GateEvaluation>{
    return this.repository.transaction(ctx,(client:PoolClient)=>
      this.gates[stage].evaluate(client,passportId,input));
  }
}
