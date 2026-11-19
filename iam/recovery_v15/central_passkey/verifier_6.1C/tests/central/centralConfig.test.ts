import {describe,expect,it} from 'vitest';
import {readCentralConfig} from '../../src/central/centralConfig';

const base={VERIFIER_INSTANCE:'v',CHALLENGE_HASH_KEY:'h'.repeat(48),CLAIM_HASH_KEY:'k'.repeat(48),RESULT_SIGNING_PRIVATE_KEY_PEM:'p'.repeat(80),
  RP_ID:'warehouse-app.tcdsolutionsgroup.com'};
const full={CENTRAL_RP_ID:'login-stg.tcdsolutionsgroup.com',CENTRAL_ORIGIN:'https://login-stg.tcdsolutionsgroup.com',
  CENTRAL_DATABASE_URL:'postgres://u@h/d',CENTRAL_WORKLOAD_SECRET:'s'.repeat(48)};

describe('central config',()=>{
  it('absent: the central routes are not mounted (verifier unchanged)',()=>expect(readCentralConfig({},base)).toBeNull());
  it('partial: refuses to start',()=>expect(()=>readCentralConfig({CENTRAL_RP_ID:full.CENTRAL_RP_ID},base)).toThrow('CENTRAL_CONFIG_INCOMPLETE'));
  it('origin must be https://<rp id>',()=>expect(()=>readCentralConfig({...full,CENTRAL_ORIGIN:'https://evil.example'},base)).toThrow('CENTRAL_ORIGIN_MUST_BE_HTTPS_RP_ID'));
  it('the Warehouse RP cannot be the central RP',()=>expect(()=>readCentralConfig({...full,CENTRAL_RP_ID:base.RP_ID,
    CENTRAL_ORIGIN:'https://'+base.RP_ID},base)).toThrow('CENTRAL_RP_ID_MUST_DIFFER_FROM_WAREHOUSE_RP_ID'));
  it('short workload secret refused',()=>expect(()=>readCentralConfig({...full,CENTRAL_WORKLOAD_SECRET:'short'},base)).toThrow());
  it('complete: login challenge lifetime defaults to 120 s',()=>expect(readCentralConfig(full,base)?.CENTRAL_LOGIN_TTL_SECONDS).toBe(120));
});
