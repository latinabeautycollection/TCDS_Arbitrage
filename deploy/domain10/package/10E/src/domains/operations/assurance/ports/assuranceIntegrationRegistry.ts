import type { AssuranceEventIntakePort } from "./assuranceEventIntakePort";

let port:AssuranceEventIntakePort|undefined;

export function configureAssuranceEventIntake(value:AssuranceEventIntakePort):void{
  if(port) throw new Error("Domain 10E event-intake port already configured");
  port=value;
}

export function assuranceEventIntake():AssuranceEventIntakePort{
  if(!port){
    throw new Error("Domain 10E event-intake port is not configured by the production composition root");
  }
  return port;
}
