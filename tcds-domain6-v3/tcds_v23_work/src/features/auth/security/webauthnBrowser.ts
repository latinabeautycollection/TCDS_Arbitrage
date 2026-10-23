import {fromBytes,toBytes} from './base64url';
import type {AuthenticationResponseJSON,PublicKeyCredentialCreationOptionsJSON,PublicKeyCredentialRequestOptionsJSON,RegistrationResponseJSON} from '../types/authTypes';

const descriptors=(items?:{id:string;type:PublicKeyCredentialType;transports?:AuthenticatorTransport[]}[])=>items?.map(x=>({...x,id:toBytes(x.id)}));
export async function platformAuthenticatorAvailable():Promise<boolean>{
  if(!window.PublicKeyCredential)return false;
  try{return await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();}catch{return false;}
}
export async function authenticateWithPasskey(options:PublicKeyCredentialRequestOptionsJSON):Promise<AuthenticationResponseJSON>{
  if(!window.PublicKeyCredential||!navigator.credentials)throw new Error('WEBAUTHN_UNSUPPORTED');
  const credential=await navigator.credentials.get({publicKey:{...options,challenge:toBytes(options.challenge),allowCredentials:descriptors(options.allowCredentials),userVerification:'required'},mediation:'optional'});
  if(!(credential instanceof PublicKeyCredential))throw new Error('PASSKEY_NOT_RETURNED');
  const r=credential.response as AuthenticatorAssertionResponse;
  return{id:credential.id,rawId:fromBytes(credential.rawId),type:credential.type as PublicKeyCredentialType,response:{authenticatorData:fromBytes(r.authenticatorData),clientDataJSON:fromBytes(r.clientDataJSON),signature:fromBytes(r.signature),userHandle:r.userHandle?fromBytes(r.userHandle):null},clientExtensionResults:credential.getClientExtensionResults(),authenticatorAttachment:credential.authenticatorAttachment as AuthenticatorAttachment|null};
}
export async function registerPasskey(options:PublicKeyCredentialCreationOptionsJSON):Promise<RegistrationResponseJSON>{
  if(!window.PublicKeyCredential||!navigator.credentials)throw new Error('WEBAUTHN_UNSUPPORTED');
  const credential=await navigator.credentials.create({publicKey:{...options,challenge:toBytes(options.challenge),user:{...options.user,id:toBytes(options.user.id)},excludeCredentials:descriptors(options.excludeCredentials),authenticatorSelection:{...options.authenticatorSelection,residentKey:'required',userVerification:'required'}}});
  if(!(credential instanceof PublicKeyCredential))throw new Error('PASSKEY_NOT_RETURNED');
  const r=credential.response as AuthenticatorAttestationResponse;
  return{id:credential.id,rawId:fromBytes(credential.rawId),type:credential.type as PublicKeyCredentialType,response:{attestationObject:fromBytes(r.attestationObject),clientDataJSON:fromBytes(r.clientDataJSON),transports:(typeof r.getTransports==='function'?r.getTransports():undefined) as AuthenticatorTransport[]|undefined,publicKeyAlgorithm:typeof r.getPublicKeyAlgorithm==='function'?r.getPublicKeyAlgorithm():undefined,publicKey:typeof r.getPublicKey==='function'&&r.getPublicKey()?fromBytes(r.getPublicKey()!):null},clientExtensionResults:credential.getClientExtensionResults(),authenticatorAttachment:credential.authenticatorAttachment as AuthenticatorAttachment|null};
}
