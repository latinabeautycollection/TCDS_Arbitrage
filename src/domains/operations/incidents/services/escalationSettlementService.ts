import { settleEscalationEmission } from "../repositories/escalationRepository";
import { domain10Runtime } from "../../infrastructure/operationsRuntime";
export async function processEscalationSettlement(emissionId:string,workerId:string):Promise<void>{
  const result=await settleEscalationEmission(emissionId,workerId);
  domain10Runtime().metrics.increment("domain10_incident_escalation_settlement_total",{result});
}
