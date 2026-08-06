export class ForensicAccessError extends Error{
 constructor(readonly code:string,message:string,readonly statusCode:number,readonly details?:Readonly<Record<string,unknown>>){
  super(message);this.name='ForensicAccessError';
 }
}
