import { Pool } from 'pg';

const required=['DOMAIN11E_DATABASE_URL','DOMAIN11E_HTTP_DATABASE_URL','DOMAIN11E_SERVICE_DATABASE_URL','DOMAIN11E_SYSTEM_DATABASE_URL','DOMAIN11E_TEST_AUTH_SESSION_ID'] as const;
const ready=required.every(k=>Boolean(process.env[k]));
const describeDb=ready?describe:describe.skip;

describeDb('Domain11E actor identity isolation',()=>{
  const admin=new Pool({connectionString:process.env.DOMAIN11E_DATABASE_URL});
  const http=new Pool({connectionString:process.env.DOMAIN11E_HTTP_DATABASE_URL});
  const service=new Pool({connectionString:process.env.DOMAIN11E_SERVICE_DATABASE_URL});
  const system=new Pool({connectionString:process.env.DOMAIN11E_SYSTEM_DATABASE_URL});

  afterAll(async()=>{await Promise.all([admin.end(),http.end(),service.end(),system.end()]);});

  async function identity(pool:Pool){
    return (await pool.query(`select session_user,
      pg_has_role(session_user,'tcds_governance_lineage_http','MEMBER') http,
      pg_has_role(session_user,'tcds_governance_lineage_service','MEMBER') service,
      pg_has_role(session_user,'tcds_governance_lineage_system','MEMBER') system`)).rows[0];
  }

  test('HTTP/SERVICE/SYSTEM login identities are distinct and non-overlapping',async()=>{
    const [h,s,y]=await Promise.all([identity(http),identity(service),identity(system)]);
    expect(new Set([h.session_user,s.session_user,y.session_user]).size).toBe(3);
    expect(h).toMatchObject({http:true,service:false,system:false});
    expect(s).toMatchObject({http:false,service:true,system:false});
    expect(y).toMatchObject({http:false,service:false,system:true});
  });

  test('HTTP identity cannot execute raw actor-spoofing core functions',async()=>{
    const r=await http.query(`
      select has_function_privilege(session_user,p.oid,'EXECUTE') allowed
      from pg_proc p join pg_namespace n on n.oid=p.pronamespace
      where n.nspname='arb' and p.proname='domain11e_record_domain11_mutation'
    `);
    expect(r.rows.every(x=>x.allowed===false)).toBe(true);
  });

  test('HTTP USER evidence actor is derived from authenticated session',async()=>{
    const auth=process.env.DOMAIN11E_TEST_AUTH_SESSION_ID!;
    const expected=(await admin.query(`
      select user_id from warehouse_identity.v_effective_access_context
      where auth_session_id=$1::uuid and session_active and user_active
    `,[auth])).rows[0]?.user_id;
    expect(expected).toBeTruthy();
    const id=(await http.query<{id:string}>(`
      select arb.domain11e_record_access_audit_user(
        'CERT_ACTOR_BINDING','actor-binding',gen_random_uuid(),gen_random_uuid(),
        '{"cert":true}'::jsonb,'actor-cert-'||gen_random_uuid(),$1::uuid
      ) id
    `,[auth])).rows[0]!.id;
    const evidence=(await admin.query(`
      select a.actor_reference,t.auth_session_id,t.application_actor_reference
      from arb.audit_events a
      join arb.domain11e_actor_attestations t
        on t.evidence_kind='AUDIT' and t.source_record_id=a.audit_event_id
      where a.audit_event_id=$1::uuid
    `,[id])).rows[0];
    expect(evidence.actor_reference).toBe(expected);
    expect(evidence.application_actor_reference).toBe(expected);
    expect(evidence.auth_session_id).toBe(auth);
  });

  test('SERVICE and SYSTEM roles cannot execute USER wrappers',async()=>{
    for(const pool of [service,system]){
      const r=await pool.query(`
        select count(*)::int n from pg_proc p join pg_namespace n on n.oid=p.pronamespace
        where n.nspname='arb'
          and p.proname like 'domain11e_%_user'
          and has_function_privilege(session_user,p.oid,'EXECUTE')
      `);
      expect(r.rows[0].n).toBe(0);
    }
  });
});
