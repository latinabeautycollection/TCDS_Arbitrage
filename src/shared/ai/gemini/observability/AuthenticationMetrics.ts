export class AuthenticationMetrics {
  private successCount = 0;
  private failureCount = 0;
  private lastSuccessAt?: string;
  private lastFailureAt?: string;
  private lastFailureClass?: string;

  recordSuccess() { this.successCount += 1; this.lastSuccessAt = new Date().toISOString(); }
  recordFailure(errorClass?: string) { this.failureCount += 1; this.lastFailureAt = new Date().toISOString(); this.lastFailureClass = errorClass; }
  snapshot() { return { successCount: this.successCount, failureCount: this.failureCount, lastSuccessAt: this.lastSuccessAt, lastFailureAt: this.lastFailureAt, lastFailureClass: this.lastFailureClass }; }
}
