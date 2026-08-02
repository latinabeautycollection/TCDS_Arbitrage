import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { z } from 'zod';
import { HttpError } from './HttpError';

const correlationSchema = z.string()
  .trim()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9._:-]+$/);

export function resolveCorrelationId(req: Request): string {
  if (req.correlationId) return req.correlationId;

  const supplied = req.header('x-correlation-id');
  if (supplied) {
    const parsed = correlationSchema.safeParse(supplied);
    if (!parsed.success) {
      throw new HttpError(400, 'INVALID_CORRELATION_ID');
    }
    req.correlationId = parsed.data;
    return parsed.data;
  }

  const generated: string = randomUUID();
  req.correlationId = generated;
  return generated;
}

export const attachCorrelationId: RequestHandler = (
  req: Request,
  _res: Response,
  next: NextFunction,
): void => {
  try {
    resolveCorrelationId(req);
    next();
  } catch (error) {
    next(error);
  }
};
