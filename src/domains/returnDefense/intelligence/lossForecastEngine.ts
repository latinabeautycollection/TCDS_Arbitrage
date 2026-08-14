
import type { PoolClient } from "pg";

export class LossForecastEngine {
  public async forecast(
    client: PoolClient,
    manifestId: string,
  ): Promise<Record<string, unknown>> {
    const result = await client.query(
      `select jsonb_build_object(
        'forecast_30',return_defense.generate_baseline_loss_forecast(
          $1::uuid,30,'{}'::jsonb
        ),
        'forecast_60',return_defense.generate_baseline_loss_forecast(
          $1::uuid,60,'{}'::jsonb
        ),
        'forecast_90',return_defense.generate_baseline_loss_forecast(
          $1::uuid,90,'{}'::jsonb
        )
       ) result`,
      [manifestId],
    );
    return result.rows[0]!.result as Record<string, unknown>;
  }
}
