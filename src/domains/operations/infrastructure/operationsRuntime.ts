import type { Pool, PoolClient } from "pg";

export interface Domain10Logger {
  info(message: string, context?: Record<string, unknown>): void;
  warn(message: string, context?: Record<string, unknown>): void;
  error(message: string, context?: Record<string, unknown>): void;
}

export interface Domain10Metrics {
  increment(name: string, labels?: Record<string, string>): void;
  observe(name: string, value: number, labels?: Record<string, string>): void;
  gauge(name: string, value: number, labels?: Record<string, string>): void;
}

export interface Domain10Span {
  setAttribute(name: string, value: string | number | boolean): void;
  end(): void;
}

export interface Domain10Tracer {
  startSpan(name: string): Domain10Span;
}

export interface Domain10Runtime {
  pool: Pool;
  logger: Domain10Logger;
  metrics: Domain10Metrics;
  tracer: Domain10Tracer;
}

let runtime: Domain10Runtime | undefined;

export function configureDomain10Runtime(value: Domain10Runtime): void {
  if (runtime) throw new Error("Domain 10 runtime already configured");
  runtime = value;
}

export function domain10Runtime(): Domain10Runtime {
  if (!runtime) throw new Error("Domain 10 runtime has not been configured by the production composition root");
  return runtime;
}

export async function transaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await domain10Runtime().pool.connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
