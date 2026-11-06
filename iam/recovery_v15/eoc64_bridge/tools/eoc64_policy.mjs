export const MODULES=Object.freeze(['executive','capital','acquisition','market','retail','pqp','purchasing','warehouse','shipping','returns','identity','hardware','governance','forensic','ai','administration','decisions','agents','knowledge','scenarios']);
export const POSITION_MAP=Object.freeze({CEO:'CEO',VICE_PRESIDENT:'VICE_PRESIDENT',CTO:'DIRECTOR',WAREHOUSE_ADMINISTRATOR:'MANAGER',WAREHOUSE_GENERAL_MANAGER:'MANAGER',IT_MANAGER:'MANAGER'});
export const uuid=v=>typeof v==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
export function normalizeClaims(claims,issuer,clientId,acr){
 if(!claims||claims.iss!==issuer||!(typeof claims.sub==='string'&&claims.sub.length>=1&&claims.sub.length<=255&&!/[\x00-\x1f]/.test(claims.sub))||!(claims.aud===clientId||Array.isArray(claims.aud)&&claims.aud.includes(clientId))||(Array.isArray(claims.aud)&&claims.aud.length>1&&claims.azp!==clientId))throw Error('OIDC_IDENTITY_INVALID');
 const auth=claims.auth_time;if(typeof auth!=='number'||!Number.isFinite(auth)||auth>Date.now()/1000+60||Date.now()/1000-auth>600)throw Error('OIDC_AUTH_STALE');
 if(!acr||claims.acr!==acr)throw Error('OIDC_ACR_REQUIRED');
 const methods=Array.isArray(claims.amr)?claims.amr.filter(x=>typeof x==='string'&&x.length<=64):[];
 if(!methods.length)throw Error('OIDC_AMR_REQUIRED');
 return {issuer,providerSubject:claims.sub,methods,authenticatedAt:new Date(auth*1000).toISOString()};
}
export function activeAppointment(apps,now=new Date()){
 if(!Array.isArray(apps))return null;
 const valid=apps.filter(a=>a.appointment_status==='ACTIVE'&&a.record_status==='VERIFIED'&&uuid(a.iam_user_id)&&a.position_active===true&&Number.isFinite(Date.parse(a.iam_link_verified_at))&&a.iam_link_authority==='TCDS_GOVERNED_IAM'&&a.iam_link_evidence_reference&&Number.isFinite(Date.parse(a.approved_at))&&a.approval_reference&&a.effective_from&&Number.isFinite(Date.parse(a.effective_from))&&new Date(a.effective_from).getTime()<=now.getTime()&&(!a.effective_until||(Number.isFinite(Date.parse(a.effective_until))&&new Date(a.effective_until).getTime()+86400000>now.getTime()))&&POSITION_MAP[a.position_code]);
 return valid.length===1?valid[0]:null;
}
export function effectiveGrants(_position,grants,now=Date.now()){
 // No title-derived entitlement, even CEO: each module VIEW needs an approved grant.
 return (grants??[]).filter(g=>MODULES.includes(g.module_id)&&['VIEW','INVESTIGATE','MANAGE','APPROVE','ADMINISTER','EXPORT','EXECUTE','CONFIGURE'].includes(g.operation)&&uuid(g.approved_by)&&uuid(g.secondary_approved_by)&&g.approved_by!==g.secondary_approved_by&&Number.isFinite(Date.parse(g.approved_at))&&g.approval_reference&&g.valid_from&&Number.isFinite(Date.parse(g.valid_from))&&Date.parse(g.valid_from)<=now&&g.valid_until&&Number.isFinite(Date.parse(g.valid_until))&&Date.parse(g.valid_until)>now&&!g.revoked_at&&['ENTERPRISE','BUSINESS_UNIT','DEPARTMENT','FACILITY','TEAM','RESOURCE'].includes(g.scope_kind)&&Array.isArray(g.scope_ids)&&(g.scope_kind==='ENTERPRISE'?g.scope_ids.length===0:g.scope_ids.length>0)).map(g=>({moduleId:g.module_id,operations:[g.operation],scope:{kind:g.scope_kind,ids:g.scope_ids},expiresAt:g.valid_until}));
}
export const isAuthorized=(grants,module,operation,scopeId)=>grants.some(g=>g.moduleId===module&&g.operations.includes(operation)&&(g.scope.kind==='ENTERPRISE'||typeof scopeId==='string'&&g.scope.ids.includes(scopeId)));
export const uiMethods=amr=>[...new Set((amr??[]).map(m=>({pwd:'PASSWORD',password:'PASSWORD',webauthn:'PASSKEY',passkey:'PASSKEY',fido2:'PASSKEY',hwk:'WEBAUTHN_SECURITY_KEY',totp:'TOTP',otp:'TOTP'})[String(m).toLowerCase()]).filter(Boolean))];
