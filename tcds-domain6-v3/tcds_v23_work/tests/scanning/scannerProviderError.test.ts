import { describe, expect, it } from 'vitest';
import {
  PROVIDER_ERROR_CAUSE_MESSAGE_MAX_LENGTH,
  ScannerProviderError,
  sanitizeProviderErrorCause,
} from '../../src/lib/scanning/contracts/ScannerProviderError';

function redacted(message: string): string {
  return sanitizeProviderErrorCause(new Error(message))?.message ?? '';
}

function expectRemoved(message: string, fragments: string[]): void {
  const output = redacted(message);
  for (const fragment of fragments) expect(output).not.toContain(fragment);
}

describe('ScannerProviderError cause sanitization', () => {
  it('never keeps the raw underlying exception', () => {
    const raw = new TypeError('Runtime failed');
    const error = new ScannerProviderError(
      'SDK_LOAD_FAILED',
      'Scanner provider initialization failed.',
      true,
      'scandit',
      undefined,
      raw,
    );

    expect(error.cause).not.toBe(raw);
    expect(error.cause).not.toBeInstanceOf(Error);
    expect(error.cause).toEqual({ name: 'TypeError', message: 'Runtime failed' });
    expect(Object.keys(error.cause ?? {})).toEqual(['name', 'message']);
    expect(Object.isFrozen(error.cause)).toBe(true);
  });

  it('does not allow the cause to be replaced after construction', () => {
    const error = new ScannerProviderError('SDK_LOAD_FAILED', 'Failed.', true, 'scandit', undefined, new Error('x'));
    expect(Object.getOwnPropertyDescriptor(error, 'cause')).toMatchObject({ writable: false, configurable: false });
    expect(() => {
      (error as unknown as { cause: unknown }).cause = new Error('raw');
    }).toThrow(TypeError);
  });

  it('keeps no cause when none is given', () => {
    const error = new ScannerProviderError('PROVIDER_DISABLED', 'Scanner provider is disabled.', false, 'scandit');
    expect(error.cause).toBeUndefined();
    expect(sanitizeProviderErrorCause(undefined)).toBeUndefined();
    expect(sanitizeProviderErrorCause(null)).toBeUndefined();
  });

  it('redacts URLs, hosts, IP addresses, e-mail addresses, paths, key values and long tokens', () => {
    const cause = sanitizeProviderErrorCause(
      new Error(
        'Load failed https://warehouse-app.example.com/scandit/8.5.2/sdc-lib/a.wasm ' +
          'at /home/app/dist/worker.js for ops@example.com via 10.0.0.12 on cdn.example.com ' +
          'licenseKey=abc123 Authorization: Bearer xyz789 token AbCdEf0123456789AbCdEf0123456789',
      ),
    );

    for (const fragment of [
      'https://',
      'warehouse-app',
      '/home/app',
      'ops@example.com',
      '10.0.0.12',
      'cdn.example.com',
      'abc123',
      'xyz789',
      'AbCdEf0123456789',
    ]) {
      expect(cause?.message).not.toContain(fragment);
    }
    expect(cause?.message.startsWith('Load failed [redacted]')).toBe(true);
  });

  it('redacts quoted, compound, JSON and encoded key/value secrets', () => {
    expectRemoved('config {"licenseKey":"lk-value-1"} and { "password" : "pw value 2" }', ['lk-value-1', 'pw value 2']);
    expectRemoved('clientSecret=cs1 client_secret=cs2 refresh_token=rt3 license=li4 license key: lk5', [
      'cs1',
      'cs2',
      'rt3',
      'li4',
      'lk5',
    ]);
    expectRemoved('token%3Dencoded6 and api_key%253Ddouble7', ['encoded6', 'double7']);
  });

  it('redacts authorization schemes and bare bearer or basic credentials', () => {
    expectRemoved('Authorization: Basic dXNlcjpwYXNz', ['dXNlcjpwYXNz']);
    expectRemoved('bearer: tok999 and Basic dXNlcjE6cGFzczE=', ['tok999', 'dXNlcjE6cGFzczE=']);
    expect(redacted('basic barcode check failed')).toBe('basic barcode check failed');
  });

  it('redacts IPv6, host:port, digit-first hosts, encoded URLs and hex IPv4', () => {
    expectRemoved(
      'peer 2001:db8::1 and [fe80::1%eth0] db-prod:5432 1password.example.org https%3A%2F%2Fsecret.example.com%2Fx 0xC0A80001',
      ['2001:db8', 'fe80', 'db-prod', '5432', '1password', 'secret.example.com', '0xC0A80001'],
    );
    expect(redacted('started at 12:34:56')).toBe('started at 12:34:56');
  });

  it('redacts absolute, home, relative and Windows paths including spaces in names', () => {
    expectRemoved(
      'C:\\secretdir /secretone ~/secrettwo secretthree/file /home/josé/secretproj C:\\Users\\John Smith\\AppData\\Local',
      ['secretdir', 'secretone', 'secrettwo', 'secretthree', 'secretproj', 'John', 'Smith', 'AppData'],
    );
  });

  it('redacts JWTs and shorter or letter-only tokens', () => {
    expectRemoved(
      'jwt eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.sig_part-x key AKIAIOSFODNN7EXAMPLE id abcdefghij1234567890abc long abcdefghijklmnopqrstuvwxyzabcdef',
      ['eyJhbGci', 'AKIAIOSFODNN7EXAMPLE', 'abcdefghij1234567890abc', 'abcdefghijklmnopqrstuvwxyzabcdef'],
    );
  });

  it('removes invisible and control characters before redaction', () => {
    const zeroWidth = String.fromCharCode(0x200b);
    const bidi = String.fromCharCode(0x202e);
    const nextLine = String.fromCharCode(0x85);
    expectRemoved(`k${zeroWidth}ey=hidden111 ${bidi}bearer${nextLine}hidden222`, ['hidden111', 'hidden222']);
    expect(redacted(`plain${zeroWidth} text`)).toBe('plain text');
  });

  it('keeps a short message and strips control characters', () => {
    const withControls = ['line one', 'line two', 'end'].join(String.fromCharCode(10, 9));
    expect(redacted(withControls + String.fromCharCode(0))).toBe('line one line two end');

    const long = sanitizeProviderErrorCause(new Error('word '.repeat(200)));
    expect(long?.message.length).toBeLessThanOrEqual(PROVIDER_ERROR_CAUSE_MESSAGE_MAX_LENGTH);
    expect(long?.message.endsWith('...')).toBe(true);
  });

  it('stays fast on very long adversarial input and never leaks text past the input limit', () => {
    const started = performance.now();
    const cause = sanitizeProviderErrorCause(new Error(`${'a.'.repeat(50_000)} secret=late999`));
    expect(performance.now() - started).toBeLessThan(1500);
    expect(cause?.message.length).toBeLessThanOrEqual(PROVIDER_ERROR_CAUSE_MESSAGE_MAX_LENGTH);
    expect(cause?.message).not.toContain('late999');
  });

  it('replaces unsafe error names', () => {
    const raw = new Error('failed');
    raw.name = 'Bad<name> https://example.com';
    expect(sanitizeProviderErrorCause(raw)?.name).toBe('Error');

    raw.name = 'AbCd1234EfGh5678IjKl9012MnOp3456';
    expect(sanitizeProviderErrorCause(raw)?.name).toBe('Error');

    raw.name = 'hunter2_secret_value_9';
    expect(sanitizeProviderErrorCause(raw)?.name).toBe('Error');

    raw.name = 'NotAllowedError';
    expect(sanitizeProviderErrorCause(raw)?.name).toBe('NotAllowedError');
  });

  it('never throws and keeps nothing from hostile values', () => {
    const throwingGetter = {
      get message(): string {
        throw new Error('getter secret');
      },
    };
    const hostileProxy = new Proxy(
      {},
      {
        get() {
          throw new Error('proxy secret');
        },
      },
    );

    expect(sanitizeProviderErrorCause(throwingGetter)).toEqual({ name: 'Error', message: '' });
    expect(sanitizeProviderErrorCause(hostileProxy)).toEqual({ name: 'Error', message: '' });
    expect(
      () => new ScannerProviderError('UNKNOWN_PROVIDER_ERROR', 'Failed.', false, 'scandit', undefined, hostileProxy),
    ).not.toThrow();
  });

  it('handles non-Error values without keeping them', () => {
    expect(sanitizeProviderErrorCause('plain failure')).toEqual({ name: 'Error', message: 'plain failure' });
    expect(sanitizeProviderErrorCause(42)).toEqual({ name: 'Error', message: '' });

    const payload = { name: 'ScanditError', message: 'bad state', licenseKey: 'SECRET', stack: 'trace' };
    const cause = sanitizeProviderErrorCause(payload);
    expect(cause).toEqual({ name: 'ScanditError', message: 'bad state' });
    expect(Object.keys(cause ?? {})).toEqual(['name', 'message']);
  });
});
