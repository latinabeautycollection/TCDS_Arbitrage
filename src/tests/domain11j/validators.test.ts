import{evaluateBody,recoveryBody,approvalBody,uuid}from'../../domains/governance/validators/controlValidators';
const U='123e4567-e89b-42d3-a456-426614174000';
test('valid UUID accepted',()=>expect(uuid(U)).toBe(U));
test('invalid UUID rejected',()=>expect(()=>uuid('bananas')).toThrow());
test('evaluate requires stable identity fields',()=>expect(()=>evaluateBody({ruleCode:'R',triggerReference:'X',requestId:U,correlationId:U,idempotencyKey:''})).toThrow());
test('recovery approval rejects arbitrary decision',()=>expect(()=>approvalBody(U,{decision:'GREEN',justification:'x',requestId:U,correlationId:U})).toThrow());
test('recovery requires immutable decision id',()=>expect(()=>recoveryBody({restrictedControlDecisionId:'x'})).toThrow());
