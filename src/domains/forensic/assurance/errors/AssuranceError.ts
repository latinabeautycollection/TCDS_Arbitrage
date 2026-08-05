export class AssuranceError extends Error{
 constructor(public readonly code:string,message:string,public readonly status:number,
 public readonly details?:Readonly<Record<string,unknown>>){super(message);this.name='AssuranceError'}
}
