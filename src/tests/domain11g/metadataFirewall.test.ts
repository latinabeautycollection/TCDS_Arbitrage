import { rejectSensitiveMetadata,sanitizeObservabilityMetadata } from '../../domains/governance/engines/observabilityMetadataFirewall';
describe('11G V2 metadata ownership firewall',()=>{
 test('accepts governed scalar metadata',()=>expect(()=>rejectSensitiveMetadata({state:'READY',attempts:2})).not.toThrow());
 test('rejects nested business object',()=>expect(()=>rejectSensitiveMetadata({targetReference:'x',sourceEntityId:{customerName:'x'} as any})).toThrow('OBSERVABILITY_METADATA_MUST_BE_SCALAR'));
 test('rejects ungoverned business key',()=>expect(()=>rejectSensitiveMetadata({customerName:'x'} as any)).toThrow('OBSERVABILITY_METADATA_KEY_NOT_ALLOWED'));
 test('redacts nested secret for logs',()=>expect((sanitizeObservabilityMetadata({a:{authorization:'Bearer x'}}) as any).a.authorization).toBe('[REDACTED]'));
});
