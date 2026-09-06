export interface CapitalSafetyLogger{info(message:string,meta?:Record<string,unknown>):void;warn(message:string,meta?:Record<string,unknown>):void;error(message:string,meta?:Record<string,unknown>):void;}
export interface CapitalSafetyMetrics{assessment(state:string):void;rejection(reason:string):void;duration(seconds:number,outcome:string):void;}
export const noopCapitalSafetyMetrics:CapitalSafetyMetrics={assessment:()=>undefined,rejection:()=>undefined,duration:()=>undefined};
