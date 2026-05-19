import { Pool } from 'pg';
import { deriveWatchlistIdentity } from '../services/identity/watchlistIdentity';

async function main() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });

  const { rows } = await pool.query(`
        SELECT id, category_key, family_name, brand, model_family,
           normalized_brand, normalized_model_family, canonical_product_key, identity_confidence
    FROM arb.product_watchlist
    WHERE canonical_product_key IS NULL
       OR identity_confidence IS NULL
       OR identity_confidence < 0.5
       OR identity_json IS NULL
       OR identity_json = '{}'::jsonb
  `);

  console.log(`Found ${rows.length} watchlist entries to backfill`);

  let updated = 0;
  for (const row of rows) {
    try {
            const identity = deriveWatchlistIdentity({
        categoryKey: row.category_key,
        familyName: row.family_name,
        brand: row.brand ?? row.normalized_brand,
        modelFamily: row.model_family ?? row.normalized_model_family,
      });

      await pool.query(`
        UPDATE arb.product_watchlist SET
          normalized_brand = $1,
          normalized_product_type = $2,
          normalized_model_family = $3,
          normalized_model_token = $4,
          normalized_generation = $5,
          normalized_variant = $6,
          normalized_storage = $7,
          normalized_color = $8,
          normalized_platform = $9,
          canonical_product_key = $10,
          identity_confidence = $11,
          is_accessory = $12,
          is_bundle = $13,
          identity_json = $14::jsonb
        WHERE id = $15
      `, [
        identity.normalizedBrand || null,
        identity.normalizedProductType || null,
        identity.normalizedModelFamily || null,
        identity.normalizedModelToken || null,
        identity.normalizedGeneration || null,
        identity.normalizedVariant || null,
        identity.normalizedStorage || null,
        identity.normalizedColor || null,
        identity.normalizedPlatform || null,
        identity.canonicalProductKey || null,
        identity.identityConfidence ?? 0,
        identity.isAccessory ?? false,
        identity.isBundle ?? false,
        JSON.stringify(identity),
        row.id,
      ]);

      updated++;
      if (updated % 50 === 0) console.log(`Updated ${updated}/${rows.length}`);
    } catch (err) {
      console.error(`Failed on watchlist id ${row.id}:`, err);
    }
  }

  console.log(`Done. Updated ${updated}/${rows.length} watchlist entries`);
  await pool.end();
}

main().catch(console.error);
