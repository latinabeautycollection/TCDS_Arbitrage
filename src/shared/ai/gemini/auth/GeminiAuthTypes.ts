export interface GeminiAccessToken {
  accessToken?: string;
  apiKey?: string;
  expiresAt?: Date;
  authMode: 'SERVICE_ACCOUNT' | 'API_KEY' | 'VERTEX' | 'GOOGLE_MANAGED';
  projectId?: string;
  location?: string;
  principal?: string;
}

export interface GeminiAuthProvider {
  readonly mode: GeminiAccessToken['authMode'];
  canUse(): Promise<boolean> | boolean;
  getToken(): Promise<GeminiAccessToken>;
  healthCheck(): Promise<GeminiCredentialHealth>;
}

export interface GeminiCredentialHealth {
  healthy: boolean;
  mode: GeminiAccessToken['authMode'];
  principal?: string;
  projectId?: string;
  reason?: string;
  checkedAt: string;
  expiresAt?: string;
}
