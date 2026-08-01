export type ForensicActorType='user'|'worker'|'system'|'api'|'service_account';
export interface AuthenticatedForensicPrincipal{actorType:ForensicActorType;actorId:string;actorName?:string;tenantKey:string;permissions:ReadonlySet<string>}
export interface ForensicRequestContext{principal:AuthenticatedForensicPrincipal;correlationId:string}
export interface ForensicLogger{info(message:string,context?:Record<string,unknown>):void;warn(message:string,context?:Record<string,unknown>):void;error(message:string,context?:Record<string,unknown>):void}
export interface ManifestBuildJob{manifestRequestId:string;tenantKey:string;correlationId:string}
export interface OutboxManifestPayload{chainId:string;manifestType:string;tenantKey:string}
