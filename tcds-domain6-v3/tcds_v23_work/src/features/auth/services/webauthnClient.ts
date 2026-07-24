export interface AuthenticationOptionsJSON {
  challenge: string;
  timeout?: number;
  rpId?: string;
  userVerification?: UserVerificationRequirement;
  allowCredentials?: Array<{
    id: string;
    type: PublicKeyCredentialType;
    transports?: AuthenticatorTransport[];
  }>;
  extensions?: AuthenticationExtensionsClientInputs;
}

export interface AuthenticationResponseJSON {
  id: string;
  rawId: string;
  type: PublicKeyCredentialType;
  response: {
    authenticatorData: string;
    clientDataJSON: string;
    signature: string;
    userHandle: string | null;
  };
  clientExtensionResults: AuthenticationExtensionsClientOutputs;
  authenticatorAttachment: AuthenticatorAttachment | null;
}

function base64UrlToBuffer(value: string): ArrayBuffer {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes.buffer;
}

function bufferToBase64Url(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

export async function startPasskeyAuthentication(options: AuthenticationOptionsJSON): Promise<AuthenticationResponseJSON> {
  if (!window.PublicKeyCredential || !navigator.credentials) {
    throw new Error('WebAuthn is not supported on this device.');
  }

  const credential = await navigator.credentials.get({
    publicKey: {
      challenge: base64UrlToBuffer(options.challenge),
      timeout: options.timeout,
      rpId: options.rpId,
      userVerification: options.userVerification ?? 'required',
      allowCredentials: options.allowCredentials?.map((entry) => ({
        id: base64UrlToBuffer(entry.id),
        type: entry.type,
        transports: entry.transports,
      })),
      extensions: options.extensions,
    },
    mediation: 'optional',
  });

  if (!(credential instanceof PublicKeyCredential)) {
    throw new Error('No passkey assertion was returned.');
  }

  const response = credential.response as AuthenticatorAssertionResponse;
  return {
    id: credential.id,
    rawId: bufferToBase64Url(credential.rawId),
    type: credential.type as PublicKeyCredentialType,
    response: {
      authenticatorData: bufferToBase64Url(response.authenticatorData),
      clientDataJSON: bufferToBase64Url(response.clientDataJSON),
      signature: bufferToBase64Url(response.signature),
      userHandle: response.userHandle ? bufferToBase64Url(response.userHandle) : null,
    },
    clientExtensionResults: credential.getClientExtensionResults(),
    authenticatorAttachment: credential.authenticatorAttachment as AuthenticatorAttachment | null,
  };
}
