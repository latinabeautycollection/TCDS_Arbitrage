export interface WeatherRiskSnapshot { originRisk:number; destinationRisk:number; routeRisk:number; expectedDelayDays:number; sourceTimestamp:Date; sourceName:string; reasonCodes:string[]; }
export interface WeatherRiskGateway { assess(input:{originPostalCode:string;destinationPostalCode:string;shipDate:Date;carrierCode?:string;}):Promise<WeatherRiskSnapshot>; }
