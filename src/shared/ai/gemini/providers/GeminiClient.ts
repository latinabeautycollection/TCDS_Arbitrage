import { AuthenticationDiscovery } from '../auth/AuthenticationDiscovery';
import { GeminiAuthConfig } from '../config/geminiAuthConfig';
import { classifyGeminiError } from '../errors/GeminiAuthError';
import { GeminiAuthAuditSink, ConsoleGeminiAuthAuditSink } from '../observability/AuthenticationAudit';

export interface GeminiGenerateInput { prompt: string; imageBase64?: string; mimeType?: string; model?: string; }
export interface GeminiGenerateOutput { text: string; model: string; authMode: string; raw?: unknown; }

export class GeminiClient {
  constructor(private readonly config: GeminiAuthConfig, private readonly audit: GeminiAuthAuditSink = new ConsoleGeminiAuthAuditSink()) {}

  async generate(input: GeminiGenerateInput): Promise<GeminiGenerateOutput> {
    const provider = await new AuthenticationDiscovery(this.config).discover();
    const token = await provider.getToken();
    const model = input.model || (input.imageBase64 ? this.config.GEMINI_MODEL_VISION : this.config.GEMINI_MODEL_TEXT);
    try {
      const out = token.authMode === 'VERTEX'
        ? await this.callVertex(model, input, token.accessToken!)
        : await this.callGenerativeLanguage(model, input, token);
      await this.audit.record({ eventType: 'gemini.generate', authMode: token.authMode, principal: token.principal, success: true, occurredAt: new Date().toISOString() });
      return { text: out.text, model, authMode: token.authMode, raw: out.raw };
    } catch (e: any) {
      const classified = classifyGeminiError(e);
      await this.audit.record({ eventType: 'gemini.generate', authMode: token.authMode, principal: token.principal, success: false, errorClass: classified.errorClass, details: classified.details, occurredAt: new Date().toISOString() });
      throw classified;
    }
  }

  private async callGenerativeLanguage(model: string, input: GeminiGenerateInput, token: any): Promise<{ text: string; raw: unknown }> {
    const url = token.apiKey
      ? `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(token.apiKey)}`
      : `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
    const headers: Record<string,string> = { 'content-type': 'application/json' };
    if (token.accessToken) headers.authorization = `Bearer ${token.accessToken}`;
    const parts: any[] = [{ text: input.prompt }];
    if (input.imageBase64) parts.push({ inline_data: { mime_type: input.mimeType || 'image/jpeg', data: input.imageBase64 } });
    const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify({ contents: [{ role: 'user', parts }] }) });
    const raw = await res.json();
    if (!res.ok) throw Object.assign(new Error(raw?.error?.message || res.statusText), { status: res.status, response: { data: raw } });
    return { text: raw?.candidates?.[0]?.content?.parts?.map((p: any) => p.text).filter(Boolean).join('\n') || '', raw };
  }

  private async callVertex(model: string, input: GeminiGenerateInput, accessToken: string): Promise<{ text: string; raw: unknown }> {
    const project = this.config.GOOGLE_CLOUD_PROJECT;
    if (!project) throw new Error('GOOGLE_CLOUD_PROJECT is required for Vertex Gemini calls');
    const location = this.config.GOOGLE_CLOUD_LOCATION;
    const url = `https://${location}-aiplatform.googleapis.com/v1/projects/${project}/locations/${location}/publishers/google/models/${model}:generateContent`;
    const parts: any[] = [{ text: input.prompt }];
    if (input.imageBase64) parts.push({ inlineData: { mimeType: input.mimeType || 'image/jpeg', data: input.imageBase64 } });
    const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${accessToken}` }, body: JSON.stringify({ contents: [{ role: 'user', parts }] }) });
    const raw = await res.json();
    if (!res.ok) throw Object.assign(new Error(raw?.error?.message || res.statusText), { status: res.status, response: { data: raw } });
    return { text: raw?.candidates?.[0]?.content?.parts?.map((p: any) => p.text).filter(Boolean).join('\n') || '', raw };
  }
}
