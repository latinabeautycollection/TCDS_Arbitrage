export interface GeminiAuthAuditSink {
  record(event: { eventType: string; authMode?: string; principal?: string; success: boolean; errorClass?: string; details?: Record<string, unknown>; occurredAt: string }): Promise<void>;
}

export class ConsoleGeminiAuthAuditSink implements GeminiAuthAuditSink {
  async record(event: { eventType: string; authMode?: string; principal?: string; success: boolean; errorClass?: string; details?: Record<string, unknown>; occurredAt: string }): Promise<void> {
    console.log(JSON.stringify({ component: 'GeminiAuthenticationEngine', ...event }));
  }
}
