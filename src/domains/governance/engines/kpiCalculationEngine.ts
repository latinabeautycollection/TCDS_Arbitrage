/**
 * Domain 11H V3 deliberately has no authoritative TypeScript financial calculator.
 * PostgreSQL resolves authoritative domain-owned source facts and executes the SHA-bound
 * calculator function. TypeScript is transport/orchestration only.
 */
export const DOMAIN11H_V3_DATABASE_AUTHORITY = true as const;
