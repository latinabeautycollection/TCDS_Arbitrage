export class IntelligenceTracing {
  private values = new Map<string, number>();
  record(name: string, value: number): void { this.values.set(name, value); }
  snapshot(): ReadonlyMap<string, number> { return new Map(this.values); }
}
