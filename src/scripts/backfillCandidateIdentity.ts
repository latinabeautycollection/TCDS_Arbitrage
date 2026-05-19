import { Pool } from 'pg';
import { deriveCandidateIdentity } from '../services/identity/candidateIdentity';

async function main() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });

  const { rows } = await pool.query(`
    SELECT
      c.id,
      c.brand,
      c.model,
      c.normalized_brand,
      c.normalized_model_family,
      c.source_category_key,
      l.title,
      l.category_key
    FROM arb.candidates c
    JOIN arb.listings l ON l.id = c.listing_id
           WHERE (
      c.normalized_model_family IS NULL
      OR c.normalized_brand IS NULL
      OR c.canonical_product_key IS NULL
      OR c.identity_confidence < 0.5
    )
    AND (l.title IS NOT NULL OR c.source_category_key IS NOT NULL)
  `);

  console.log(`Found ${rows.length} candidates to backfill`);

  let updated = 0;
  let failed = 0;

  for (const row of rows) {
    try {
            const identity = deriveCandidateIdentity({
        categoryKey: row.category_key ?? row.source_category_key,
        title: row.title,
        normalizedTitle: null,
        brand: row.brand ?? row.normalized_brand,
        model: row.model ?? row.normalized_model_family,
      });

      await pool.query(`
        UPDATE arb.candidates SET
          normalized_brand        = COALESCE(normalized_brand, $1),
          normalized_product_type = COALESCE(normalized_product_type, $2),
          normalized_model_family = $3,
          normalized_model_token  = COALESCE(normalized_model_token, $4),
          canonical_product_key   = COALESCE(canonical_product_key, $5),
          identity_confidence     = $6,
          is_accessory            = COALESCE(is_accessory, $7),
          is_bundle               = COALESCE(is_bundle, $8),
          updated_at              = now()
        WHERE id = $9
      `, [
        identity.normalizedBrand          ?? null,
        identity.normalizedProductType    ?? null,
        identity.normalizedModelFamily    ?? null,
        identity.normalizedModelToken     ?? null,
        identity.canonicalProductKey      ?? null,
        identity.identityConfidence       ?? 0,
        identity.isAccessory              ?? false,
        identity.isBundle                 ?? false,
        row.id,
      ]);

      updated++;
      if (updated % 50 === 0) console.log(`Updated ${updated}/${rows.length}`);
    } catch (err) {
      console.error(`Failed on candidate id ${row.id}:`, err);
      failed++;
    }
  }

  console.log(`Done. Updated ${updated}/${rows.length}, failed ${failed}`);
  await pool.end();
}

main().catch(console.error);
