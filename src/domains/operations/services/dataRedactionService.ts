import { EMAIL_POLICY } from "../config/emailPolicyConfig";

export function validateNoForbiddenVariables(vars:Record<string,unknown>):void{
  for(const key of Object.keys(vars)){
    if(EMAIL_POLICY.forbiddenVariablePatterns.some(p=>p.test(key))){
      throw new Error(`Forbidden sensitive variable in email payload: ${key}`);
    }
  }
}
