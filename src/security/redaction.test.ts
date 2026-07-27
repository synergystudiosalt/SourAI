import { describe, expect, it } from 'vitest';

import { SECRET_CANARIES, expectNoSecrets } from '../test/assertions';
import {
  REDACTED,
  clearRegisteredSecrets,
  containsSecret,
  redactString,
  redactValue,
  registerSecret,
  unregisterSecret,
} from './redaction';

describe('redactString', () => {
  it('masks every vendor credential shape in the canary set', () => {
    for (const [name, secret] of Object.entries(SECRET_CANARIES)) {
      const output = redactString(`request failed with ${secret} attached`);
      expect(output, `${name} leaked`).not.toContain(secret);
      expect(output).toContain(REDACTED);
    }
  });

  it('keeps the variable name readable while masking the value', () => {
    expect(redactString('GEMINI_API_KEY=AIzaSyA1bcdefghijklmnopqrstuvwxyz0123456')).toBe(
      `GEMINI_API_KEY=${REDACTED}`
    );
  });

  it('masks a bearer token while keeping the header and scheme readable', () => {
    // The scheme is diagnostically useful and carries nothing secret, so only
    // the token itself is replaced.
    expect(redactString('Authorization: Bearer abc123def456ghi789jkl')).toBe(`Authorization: Bearer ${REDACTED}`);
    expect(redactString('authorization=Basic dXNlcjpwYXNzd29yZA==')).toBe(`authorization=Basic ${REDACTED}`);
  });

  it('masks credentials embedded in a URL', () => {
    expect(redactString('https://user:hunter2secret@example.com/repo.git')).toBe(
      `https://user:${REDACTED}@example.com/repo.git`
    );
    expect(redactString('https://api.example.com/v1?key=AIzaSyA1bcdefghijklmnopqrstuvwxyz0123456&x=1')).toBe(
      `https://api.example.com/v1?key=${REDACTED}&x=1`
    );
    expect(redactString('https://app.example.com/callback#access_token=abcdefghijklmnopqrstuvwxyz012345')).toBe(
      `https://app.example.com/callback#access_token=${REDACTED}`
    );
  });

  it('masks credentials in JSON while keeping the key readable', () => {
    expect(redactString('{"api_key":"abc"}')).toBe(`{"api_key":"${REDACTED}"}`);
    expect(redactString('{"refresh_token": "alphabeticonly"}')).toBe(`{"refresh_token": "${REDACTED}"}`);
    expect(redactString('{"password":"correct horse battery staple"}')).toBe(
      `{"password":"${REDACTED}"}`
    );
  });

  it('masks short and alphabetic values under unambiguous sensitive assignments', () => {
    expect(redactString('api_key=abc')).toBe(`api_key=${REDACTED}`);
    expect(redactString('password=huntertwo')).toBe(`password=${REDACTED}`);
    expect(redactString("passphrase='open sesame'")).toBe(`passphrase='${REDACTED}'`);
  });

  it('supports sensitive key names much longer than the old regex bound', () => {
    const key = `integration_${'descriptor_'.repeat(100)}api_key`;
    expect(redactString(`${key}=alphabeticonly`)).toBe(`${key}=${REDACTED}`);
  });

  it('does not corrupt TypeScript annotations or ordinary code with key-like identifiers', () => {
    const source = [
      'const token: string = value;',
      'const passwordHash: bcryptCompare(candidate, stored);',
      'const credential = process.env.PROVIDER_KEY;',
      'const accessToken = sessionStore;',
      'interface Config { token: CredentialType }',
      'type ApiKey = string;',
    ].join('\n');
    expect(redactString(source)).toBe(source);
  });

  it('masks a JWT', () => {
    const jwt = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dBjftJeZ4CVPmB92K27uhbUJU1p1r_wW1gFWFOEjXk';
    expect(redactString(`token ${jwt}`)).toBe(`token ${REDACTED}`);
  });

  it('masks a PEM private key block', () => {
    const pem = '-----BEGIN RSA PRIVATE KEY-----\nMIIEow==\n-----END RSA PRIVATE KEY-----';
    expect(redactString(pem)).toBe(REDACTED);
  });

  it('leaves ordinary text untouched', () => {
    const text = 'Updated src/App.tsx and ran 12 tests in 340ms.';
    expect(redactString(text)).toBe(text);
    expect(containsSecret(text)).toBe(false);
  });

  it('masks a registered literal secret that matches no pattern', () => {
    try {
      registerSecret('correct-horse-battery-staple');
      expect(redactString('the value is correct-horse-battery-staple ok')).toBe(`the value is ${REDACTED} ok`);
    } finally {
      clearRegisteredSecrets();
    }
  });

  it('honours explicitly registered short values and longest overlapping values first', () => {
    try {
      registerSecret('abc');
      registerSecret('abcdef');
      expect(redactString('abcdef / abc')).toBe(`${REDACTED} / ${REDACTED}`);
    } finally {
      clearRegisteredSecrets();
    }
  });

  it('keeps a shared literal protected until every owner unregisters it', () => {
    const shared = 'shared-provider-canary';
    try {
      registerSecret(shared);
      registerSecret(shared);

      unregisterSecret(shared);
      expect(redactString(shared)).toBe(REDACTED);

      unregisterSecret(shared);
      expect(redactString(shared)).toBe(shared);
    } finally {
      clearRegisteredSecrets();
    }
  });

  it('redacts a credential at the end of a full ~1 MB input without truncating safe content', () => {
    const safePrefix = 'x'.repeat(1024 * 1024);
    const input = `${safePrefix}\napi_key=alphabeticonly`;
    const startedAt = performance.now();
    const output = redactString(input);
    const elapsed = performance.now() - startedAt;

    expect(output).toBe(`${safePrefix}\napi_key=${REDACTED}`);
    expect(containsSecret(safePrefix)).toBe(false);
    // Deliberately generous for loaded CI while guarding the old ~35-second
    // quadratic path and proving the whole input, including its tail, is read.
    expect(elapsed).toBeLessThan(5_000);
  });
});

describe('redactValue', () => {
  it('masks values under sensitive keys regardless of their shape', () => {
    const result = redactValue({ apiKey: 'plain-value', nested: { password: 'p', safe: 'keep' } });
    expect(result).toEqual({ apiKey: REDACTED, nested: { password: REDACTED, safe: 'keep' } });
  });

  it('preserves sensitive Map keys while masking their values', () => {
    expect(redactValue(new Map([['authorization', 'short-private-value']]))).toEqual({
      '[map]': [['authorization', REDACTED]],
    });
  });

  it('redacts secrets inside arrays and error objects', () => {
    const result = redactValue({
      logs: [`failed with ${SECRET_CANARIES.openai}`],
      error: new Error(`bad key ${SECRET_CANARIES.groq}`),
    });
    expectNoSecrets(result);
  });

  it('survives a circular structure', () => {
    const cyclic: Record<string, unknown> = { name: 'root' };
    cyclic.self = cyclic;
    expect(redactValue(cyclic)).toEqual({ name: 'root', self: '[circular]' });
  });

  it('serializes repeated references normally rather than calling them circular', () => {
    const shared = { value: 'keep' };
    expect(redactValue({ first: shared, second: shared })).toEqual({
      first: { value: 'keep' },
      second: { value: 'keep' },
    });
  });

  it('produces JSON-safe and structured-cloneable plain data for supported special values', () => {
    const result = redactValue({
      bigint: 42n,
      callback: () => 'nope',
      symbol: Symbol('hidden'),
      missing: undefined,
      invalidNumber: Number.NaN,
      date: new Date('2025-01-02T03:04:05.000Z'),
      map: new Map([['key', SECRET_CANARIES.openai]]),
      set: new Set([1, 2]),
      error: new Error(`provider failed with ${SECRET_CANARIES.groq}`),
      buffer: new Uint8Array([1, 2, 3]),
      blob: new Blob(['private bytes'], { type: 'application/octet-stream' }),
    });

    expect(() => JSON.stringify(result)).not.toThrow();
    expect(() => structuredClone(result)).not.toThrow();
    expectNoSecrets(result, 'sanitized special values');
    expect(JSON.stringify(result)).toContain('42n');
    expect(JSON.stringify(result)).toContain('Uint8Array 3 bytes');
  });

  it('does not invoke accessors and survives hostile proxies', () => {
    let getterCalls = 0;
    const withAccessor: Record<string, unknown> = {};
    Object.defineProperty(withAccessor, 'danger', {
      enumerable: true,
      get() {
        getterCalls++;
        throw new Error('must not run');
      },
    });
    const hostile = new Proxy(
      {},
      {
        ownKeys() {
          throw new Error('blocked');
        },
      }
    );

    expect(redactValue(withAccessor)).toEqual({ danger: '[accessor]' });
    expect(getterCalls).toBe(0);
    expect(redactValue(hostile)).toBe('[unserializable object]');
  });

  it('bounds recursion depth so untrusted tool output cannot exhaust the stack', () => {
    let deep: Record<string, unknown> = { value: 'leaf' };
    for (let i = 0; i < 50; i++) deep = { child: deep };
    expect(() => redactValue(deep)).not.toThrow();
    expect(JSON.stringify(redactValue(deep))).toContain('[truncated]');
  });
});
