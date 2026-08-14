
import type { PoolClient } from "pg";
import type {
  PostSaleGateEvaluation,
  PostSaleGateStage,
} from "../gates/postSaleGateTypes";
import { ListingDefensibilityGate } from "../gates/listingDefensibilityGate";
import { OrderFulfillmentGate } from "../gates/orderFulfillmentGate";
import { PackingShipmentReleaseGate } from "../gates/packingShipmentReleaseGate";
import { DeliveryInterventionGate } from "../gates/deliveryInterventionGate";
import { ReturnDisputeRecoveryGate } from "../gates/returnDisputeRecoveryGate";

export class PostSaleGateOrchestrationService {
  private readonly gates = {
    LISTING_DEFENSIBILITY: new ListingDefensibilityGate(),
    ORDER_FULFILLMENT: new OrderFulfillmentGate(),
    PACKING_SHIPMENT_RELEASE: new PackingShipmentReleaseGate(),
    DELIVERY_INTERVENTION: new DeliveryInterventionGate(),
    RETURN_DISPUTE_RECOVERY: new ReturnDisputeRecoveryGate(),
  } as const;

  public evaluate(
    client: PoolClient,
    gateStage: PostSaleGateStage,
    passportId: string,
    facts: Record<string, unknown>,
  ): Promise<PostSaleGateEvaluation> {
    return this.gates[gateStage].evaluate(client, passportId, facts);
  }
}
