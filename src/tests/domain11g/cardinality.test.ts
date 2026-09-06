import { assertMetricCardinalityContract } from '../../domains/governance/observability/domain11gMetrics';
import { LOW_CARDINALITY_METRIC_LABELS,FORBIDDEN_METRIC_LABELS } from '../../domains/governance/constants/observabilityConstants';
describe('11G metric cardinality',()=>{
 test('metric labels pass contract',()=>expect(()=>assertMetricCardinalityContract()).not.toThrow());
 test('forbidden identifiers are never allowed labels',()=>{for(const x of FORBIDDEN_METRIC_LABELS)expect(LOW_CARDINALITY_METRIC_LABELS.has(x)).toBe(false);});
});
