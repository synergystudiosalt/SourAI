import { describe, expect, it } from 'vitest';

import { SECRET_CANARIES, expectNoSecrets } from '../test/assertions';
import {
  REDACTED,
  clearRegisteredSecrets,
  containsSecret,
  redactString,
  redactValue,
  registerSecret,
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

  it('ignores registered values too short to mask safely', () => {
    try {
      registerSecret('abc');
      expect(redactString('abc is a common substring')).toBe('abc is a common substring');
    } finally {
      clearRegisteredSecrets();
    }
  });
});

describe('redactValue', () => {
  it('masks values under sensitive keys regardless of their shape', () => {
    const result = redactValue({ apiKey: 'plain-value', nested: { password: 'p', safe: 'keep' } });
    expect(result).toEqual({ apiKey: REDACTED, nested: { password: REDACTED, safe: 'keep' } });
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

  it('bounds recursion depth so untrusted tool output cannot exhaust the stack', () => {
    let deep: Record<string, unknown> = { value: 'leaf' };
    for (let i = 0; i < 50; i++) deep = { child: deep };
    expect(() => redactValue(deep)).not.toThrow();
    expect(JSON.stringify(redactValue(deep))).toContain('[truncated]');
  });
});
