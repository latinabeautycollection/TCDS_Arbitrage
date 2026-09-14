export type ScannerProviderErrorCode =
  | 'PROVIDER_DISABLED'
  | 'INVALID_CONFIGURATION'
  | 'CAPABILITY_CHECK_FAILED'
  | 'RUNTIME_ASSET_NOT_FOUND'
  | 'RUNTIME_VERSION_MISMATCH'
  | 'LICENSE_CONFIGURATION_MISSING'
  | 'LICENSE_VALIDATION_FAILED'
  | 'LICENSE_EXPIRED'
  | 'LICENSE_PLATFORM_INVALID'
  | 'LICENSE_APP_ID_INVALID'
  | 'LICENSE_DEVICE_INVALID'
  | 'LICENSE_SDK_VERSION_INVALID'
  | 'LICENSE_REJECTED'
  | 'DEVICE_ACTIVATION_FAILED'
  | 'NETWORK_REQUIRED'
  | 'SCAN_LIMIT_EXCEEDED'
  | 'REGISTRATION_REQUIRED'
  | 'UNLICENSED_FEATURE'
  | 'MISSING_RESOURCE'
  | 'DISPOSED_CONTEXT'
  | 'CONFLICTING_REQUIREMENTS'
  | 'CAMERA_AUTHORIZATION_REQUIRED'
  | 'CAMERA_RUNTIME_ERROR'
  | 'SUBSCRIPTION_ERROR'
  | 'SDK_INTERNAL_ERROR'
  | 'SDK_LOAD_FAILED'
  | 'SDK_INITIALIZATION_FAILED'
  | 'SDK_RUNTIME_FAILURE'
  | 'DISPOSE_FAILED'
  | 'UNKNOWN_PROVIDER_ERROR';

/**
 * Redacted summary of an underlying provider failure. The raw provider exception is never
 * retained, so no external payload crosses the provider boundary: only a validated error
 * name and a short message with credentials, URLs, hosts, IP addresses, e-mail addresses,
 * file paths and token-like strings removed. Some harmless detail (file or API names) may
 * also be removed; that is intentional.
 */
export interface ScannerProviderErrorCause {
  readonly name: string;
  readonly message: string;
}

export const PROVIDER_ERROR_CAUSE_MESSAGE_MAX_LENGTH = 160;

/** Longer input is cut before redaction so pattern matching stays fast. */
export const PROVIDER_ERROR_CAUSE_INPUT_MAX_LENGTH = 1000;

const REDACTED = '[redacted]';
const TRUNCATION_SUFFIX = '...';
const SAFE_ERROR_NAME = /^[A-Z][A-Za-z]{0,63}$/;
const PERCENT_ESCAPE = /%[0-9A-Fa-f]{2}/g;
// C0 and C1 control characters.
const CONTROL_CHARACTERS = /[\x00-\x1F\x7F-\x9F]/g;
// Soft hyphen, Arabic letter mark, Mongolian vowel separator, zero-width and bidi controls, BOM.
const INVISIBLE_CHARACTERS = new RegExp(
  `[${[
    [0x00ad, 0x00ad],
    [0x061c, 0x061c],
    [0x180e, 0x180e],
    [0x200b, 0x200f],
    [0x202a, 0x202e],
    [0x2060, 0x206f],
    [0xfeff, 0xfeff],
  ]
    .map(([from, to]) => `${String.fromCharCode(from)}-${String.fromCharCode(to)}`)
    .join('')}]`,
  'g',
);
const TOKEN_CANDIDATE = /[A-Za-z0-9+/=_.~%-]{16,}/g;

// Applied in order: credentials first so their values are removed whole.
const REDACTION_PATTERNS: readonly RegExp[] = [
  /\b(?:proxy-)?authorization\b["']?\s*[:=]\s*["']?(?:(?:basic|bearer|digest|negotiate|token)\s+)?[^\s,;"']+/gi,
  /\bbearer\b\s*[:=]?\s*[^\s,;"']+/gi,
  /\b(?:basic|digest|negotiate)\s+(?=[A-Za-z0-9+/]*\d)[A-Za-z0-9+/]{8,}={0,2}/gi,
  /["']?\b[\w-]{0,40}?(?:api[_-]?key|licen[cs]e(?:[\s_-]?key)?|access[_-]?token|refresh[_-]?token|id[_-]?token|token|secret|passw(?:or)?d|pwd|credentials?|session[_-]?id|signature|key)["']?\s*[:=]\s*(?:"[^"]*"|'[^']*'|[^\s,;]+)/gi,
  /\beyJ[\w-]*\.[\w-]*(?:\.[\w-]*)?/g,
  /[a-z][a-z0-9+.-]*:\/\/[^\s'"<>]+/gi,
  /\b(?:blob|data|file|mailto):[^\s'"<>]+/gi,
  /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g,
  /(?<![\w:])(?=[0-9a-f:]*(?:::|[a-f]))(?:[0-9a-f]{0,4}:){2,7}[0-9a-f]{0,4}(?:%\w+)?(?![\w:])/gi,
  /(?:\b[A-Za-z]:|~)?(?:[\\/][^\s\\/'"<>]+)+[\\/]?|\b[\w.-]+(?:[\\/][^\s\\/'"<>]+)+[\\/]?/g,
  /\b\d{1,3}(?:\.\d{1,3}){3}\b/g,
  /\b0x[0-9a-f]{8}\b/gi,
  /(?<![\p{L}\p{N}_.-])(?:[\p{L}\p{N}][\p{L}\p{N}-]*\.)+\p{L}{2,}(?![\p{L}\p{N}_-])/giu,
  /\b(?=[\w-]*[A-Za-z])[\w-]+:\d{2,5}\b/g,
];

function decodePercentEscapes(text: string): string {
  return text.replace(PERCENT_ESCAPE, (escape) => String.fromCharCode(Number.parseInt(escape.slice(1), 16)));
}

function limitInput(message: string): string {
  if (message.length <= PROVIDER_ERROR_CAUSE_INPUT_MAX_LENGTH) return message;
  // Drop the word that was cut so a partial secret cannot slip under the token rules.
  const cut = message.slice(0, PROVIDER_ERROR_CAUSE_INPUT_MAX_LENGTH).replace(/\s/g, ' ');
  const boundary = cut.lastIndexOf(' ');
  return `${boundary > 0 ? cut.slice(0, boundary) : ''} ${REDACTED}`;
}

function redactMessage(message: string): string {
  let text = decodePercentEscapes(decodePercentEscapes(limitInput(message)))
    .normalize('NFKC')
    .replace(INVISIBLE_CHARACTERS, '')
    .replace(CONTROL_CHARACTERS, ' ');
  for (const pattern of REDACTION_PATTERNS) text = text.replace(pattern, REDACTED);
  text = text.replace(TOKEN_CANDIDATE, (candidate) =>
    /\d/.test(candidate) || candidate.length >= 32 ? REDACTED : candidate,
  );
  text = text.replace(/\s+/g, ' ').trim();

  return text.length > PROVIDER_ERROR_CAUSE_MESSAGE_MAX_LENGTH
    ? `${text.slice(0, PROVIDER_ERROR_CAUSE_MESSAGE_MAX_LENGTH - TRUNCATION_SUFFIX.length)}${TRUNCATION_SUFFIX}`
    : text;
}

function readProperty(value: object, key: 'name' | 'message'): unknown {
  try {
    return (value as Record<string, unknown>)[key];
  } catch {
    return undefined;
  }
}

/** Never throws, and never returns any part of the original value except redacted text. */
export function sanitizeProviderErrorCause(value: unknown): ScannerProviderErrorCause | undefined {
  if (value === undefined || value === null) return undefined;

  let name: unknown;
  let message: unknown;

  if (typeof value === 'string') {
    message = value;
  } else if (typeof value === 'object') {
    name = readProperty(value, 'name');
    message = readProperty(value, 'message');
  }

  try {
    return Object.freeze({
      name: typeof name === 'string' && SAFE_ERROR_NAME.test(name) ? name : 'Error',
      message: typeof message === 'string' ? redactMessage(message) : '',
    });
  } catch {
    return Object.freeze({ name: 'Error', message: '' });
  }
}

export class ScannerProviderError extends Error {
  /** Redacted summary only. Set once at construction; cannot be reassigned. */
  declare readonly cause?: ScannerProviderErrorCause;

  constructor(
    public readonly code: ScannerProviderErrorCode,
    message: string,
    public readonly retryable: boolean,
    public readonly provider: string,
    public readonly providerStatusCode?: number,
    cause?: unknown,
  ) {
    super(message);
    this.name = 'ScannerProviderError';
    Object.defineProperty(this, 'cause', {
      value: sanitizeProviderErrorCause(cause),
      enumerable: true,
      writable: false,
      configurable: false,
    });
  }
}
