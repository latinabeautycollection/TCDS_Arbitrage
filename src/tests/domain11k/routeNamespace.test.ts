import fs from'node:fs';import path from'node:path';
test('11K does not collide with root health ready metrics',()=>{const s=fs.readFileSync(path.join(__dirname,'../../domains/governance/routes/releaseCertificationRoutes.ts'),'utf8');expect(s).not.toMatch(/['"]\/health['"]|['"]\/ready['"]|['"]\/metrics['"]/);expect(s).toContain('/governance/release');expect(s).toContain('/governance/replay')});
