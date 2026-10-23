import {fromBytes} from './base64url';
import type {DeviceEnrollmentProfile,DeviceSecrets} from '../types/authTypes';
export async function signDeviceNonce(rawNonce:string,profile:DeviceEnrollmentProfile,secrets:DeviceSecrets):Promise<string>{
  const data=new TextEncoder().encode(rawNonce);  // TCDS R11-20: sign the nonce text the verifier checks
  if(profile.algorithm==='Ed25519'){
    const signature=await crypto.subtle.sign({name:'Ed25519'},secrets.signingKey,data);
    return fromBytes(signature);
  }
  const signature=await crypto.subtle.sign({name:'ECDSA',hash:'SHA-256'},secrets.signingKey,data);
  return fromBytes(signature);
}
