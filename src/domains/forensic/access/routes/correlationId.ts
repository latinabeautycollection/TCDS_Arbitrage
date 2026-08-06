import{randomUUID}from'node:crypto';import{z}from'zod';
export function resolveCorrelationId(value:unknown):string{
 if(value===undefined)return randomUUID();const parsed=z.uuid().safeParse(value);
 if(!parsed.success)throw new Error('x-correlation-id must be a UUID');return parsed.data;
}
