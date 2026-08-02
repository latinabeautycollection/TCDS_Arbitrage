import type { Request } from 'express';
import { z } from 'zod';
import { HttpError } from './HttpError';

export function requireRouteParam(
  req: Request,
  name: string,
  maxLength = 256,
): string {
  const raw = req.params[name];
  const candidate = Array.isArray(raw)
    ? raw.length === 1 ? raw[0] : undefined
    : raw;
  const value = typeof candidate === 'string' ? candidate.trim() : '';

  if (!value || value.length > maxLength) {
    throw new HttpError(400, 'INVALID_ROUTE_PARAMETER', { parameter: name });
  }
  return value;
}

export function requireUuidRouteParam(req: Request, name: string): string {
  const value = requireRouteParam(req, name, 36);
  const parsed = z.string().uuid().safeParse(value);
  if (!parsed.success) {
    throw new HttpError(400, 'INVALID_UUID_ROUTE_PARAMETER', { parameter: name });
  }
  return parsed.data;
}
