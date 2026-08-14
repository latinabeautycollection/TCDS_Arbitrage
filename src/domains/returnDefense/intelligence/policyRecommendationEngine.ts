
import type { PoolClient } from "pg";

export class PolicyRecommendationEngine {
  public async recommend(
    client: PoolClient,
    lossEventId: string,
  ): Promise<Record<string, unknown>> {
    const result = await client.query(
      `with loss as (
        select * from return_defense.loss_events
        where tenant_id=return_defense.current_tenant_id()
         and loss_event_id=$1::uuid
       ), inserted as (
        insert into return_defense.policy_recommendations(
         tenant_id,recommendation_type,title,rationale,target_scope,
         proposed_change,expected_loss_reduction,expected_labor_increase_minutes,
         expected_conversion_impact,affected_volume,confidence,
         counterfactual_estimate,rollback_condition,generated_by_type,
         correlation_id
        )
        select tenant_id,'POLICY',
         'Review loss controls for '||lifecycle_stage,
         'Generated from reconciled loss event '||loss_event_id::text,
         jsonb_build_object('lifecycle_stage',lifecycle_stage),
         jsonb_build_object('action','HUMAN_REVIEW'),
         greatest(net_realized_loss,0),0,0,1,60,
         jsonb_build_object('baseline_loss',net_realized_loss),
         jsonb_build_object('rollback_on_conversion_drop',true),
         'SYSTEM',return_defense.current_correlation_id()
        from loss
        returning policy_recommendation_id,recommendation_status
       )
       select to_jsonb(inserted) result from inserted`,
      [lossEventId],
    );
    return result.rows[0]!.result as Record<string, unknown>;
  }
}
