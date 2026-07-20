export class KillSwitchManager {
  private disabled = false;
  private reason?: string;

  disable(reason: string): void {
    this.disabled = true;
    this.reason = reason;
  }
  enable(): void {
    this.disabled = false;
    this.reason = undefined;
  }
  assertEnabled(): void {
    if (this.disabled) throw new Error(`Shipping intelligence hub disabled: ${this.reason ?? "unknown"}`);
  }
  status(): { disabled: boolean; reason?: string } {
    return { disabled: this.disabled, ...(this.reason ? { reason: this.reason } : {}) };
  }
}
