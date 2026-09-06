import { deterministicUuid,parseObservation,parseTraceParent,requireUuid } from '../../domains/governance/validators/observabilityValidators';
describe('11G V2 correlation validation',()=>{
 test('deterministic UUID is stable',()=>expect(deterministicUuid('same')).toBe(deterministicUuid('same')));
 test('same idempotency without IDs generates identical immutable context',()=>{const body={observationType:'REQUEST',subjectDomainCode:'DOMAIN_11',operationCode:'TEST',outcome:'SUCCESS',severity:'INFO',metadata:{state:'OK'},occurredAt:'2026-08-23T20:00:00Z',idempotencyKey:'same-key'};const a=parseObservation(body,{});const b=parseObservation(body,{});expect(a.correlationId).toBe(b.correlationId);expect(a.requestId).toBe(b.requestId);});
 test('rejects malformed supplied correlation',()=>expect(()=>requireUuid('abc','correlation_id')).toThrow());
 test('accepts W3C traceparent',()=>expect(parseTraceParent('00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01')?.traceId).toHaveLength(32));
});
