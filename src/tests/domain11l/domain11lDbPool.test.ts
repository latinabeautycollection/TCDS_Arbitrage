import fs from 'node:fs';
import { buildDomain11lPoolConfig } from '../../domains/governance/executive/db/domain11lDbPool';

describe('Domain 11L hardened DB TLS',()=>{
 const save={...process.env};
 afterEach(()=>{process.env={...save};jest.restoreAllMocks()});
 test('production refuses disabled TLS',()=>{
   process.env.DATABASE_URL='postgres://example/test'; process.env.NODE_ENV='production'; process.env.PG_SSL_ENABLED='false';
   expect(()=>buildDomain11lPoolConfig('test')).toThrow('DOMAIN11L_DATABASE_TLS_REQUIRED');
 });
 test('production refuses missing CA',()=>{
   process.env.DATABASE_URL='postgres://example/test'; process.env.NODE_ENV='production'; process.env.PG_SSL_ENABLED='true'; delete process.env.PG_SSL_CA_FILE;
   expect(()=>buildDomain11lPoolConfig('test')).toThrow('DOMAIN11L_DATABASE_TRUST_CA_REQUIRED');
 });
 test('production verifies peer when CA exists',()=>{
   process.env.DATABASE_URL='postgres://example/test'; process.env.NODE_ENV='production'; process.env.PG_SSL_ENABLED='true'; process.env.PG_SSL_CA_FILE='/tmp/tcds-test-ca.pem';
   jest.spyOn(fs,'readFileSync').mockReturnValue('TEST-CA');
   const cfg=buildDomain11lPoolConfig('test');
   expect(cfg.ssl).toEqual({ca:'TEST-CA',rejectUnauthorized:true});
 });
});
