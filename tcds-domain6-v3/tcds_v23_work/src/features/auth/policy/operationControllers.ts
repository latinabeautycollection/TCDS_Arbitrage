export type AuthOperation = 'bootstrap' | 'authentication' | 'session';

export class OperationControllers {
  private readonly controllers = new Map<AuthOperation, AbortController>();

  async run<T>(operation: AuthOperation, work: (signal: AbortSignal) => Promise<T>): Promise<T> {
    this.cancel(operation);
    const controller = new AbortController();
    this.controllers.set(operation, controller);
    try {
      return await work(controller.signal);
    } finally {
      if (this.controllers.get(operation) === controller) this.controllers.delete(operation);
    }
  }

  cancel(operation: AuthOperation): void {
    this.controllers.get(operation)?.abort();
    this.controllers.delete(operation);
  }

  cancelAll(): void {
    for (const controller of this.controllers.values()) controller.abort();
    this.controllers.clear();
  }
}
