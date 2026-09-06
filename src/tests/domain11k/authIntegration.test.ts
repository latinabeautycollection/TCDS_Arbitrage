import fs from'node:fs';import path from'node:path';
test('11K consumes production req.accessPrincipal identity contract',()=>{const s=fs.readFileSync(path.join(__dirname,'../../domains/governance/integration/releaseAuthorization.ts'),'utf8');expect(s).toContain('req.accessPrincipal');expect(s).not.toContain('res.locals as any')});
