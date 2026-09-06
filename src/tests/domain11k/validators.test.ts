import{uuid,manifest,positiveInt,isoDate}from'../../domains/governance/validators/releaseCertificationValidators';
const U='123e4567-e89b-42d3-a456-426614174000',H='a'.repeat(64);
test('uuid strict',()=>{expect(uuid(U)).toBe(U);expect(()=>uuid('x')).toThrow()});
test('manifest requires six sha256 identities',()=>expect(()=>manifest({sourceManifestSha256:H})).toThrow());
test('positive gate version',()=>expect(()=>positiveInt(0,'GATE')).toThrow());
test('date validation',()=>expect(()=>isoDate('not-a-date','DATE')).toThrow());
