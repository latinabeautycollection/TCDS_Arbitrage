import type { Pool } from 'pg';
import { pool } from '../../../db/pool';

// Reuse the app's shared, SSL-configured pool (Supabase self-signed cert in chain).
export function getPool(): Pool {
  return pool;
}
