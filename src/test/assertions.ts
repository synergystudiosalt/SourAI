import { expect } from 'vitest';

import { containsSecret, redactString } from '../security/redaction';

/**
 * Secret canary assertion.
 *
 * Used by the tests that guard everything leaving memory — persisted events,
 * audit exports, error surfaces, prompt payloads, log lines. Serializes the
 * value first so nested credentials are caught too.
 */
export function expectNoSecrets(value: unknown, context?: string): void {
  const serialized = typeof value === 'string' ? value : JSON.stringify(value ?? null);
  if (!serialized) return;
  if (containsSecret(serialized)) {
    const where = context ? ` in ${context}` : '';
    expect.fail(
      `Credential-shaped content leaked${where}. Redacted preview:\n${redactString(serialized).slice(0, 800)}`
    );
  }
}

/** A set of realistic credential shapes for canary tests. */
export const SECRET_CANARIES = {
  openai: 'sk-proj-abcdefghijklmnopqrstuvwxyz012345',
  anthropic: 'sk-ant-api03-abcdefghijklmnopqrstuvwxyz012345',
  google: 'AIzaSyA1bcdefghijklmnopqrstuvwxyz0123456',
  groq: 'gsk_abcdefghijklmnopqrstuvwxyz0123456789',
  github: 'ghp_abcdefghijklmnopqrstuvwxyz0123456789',
  bearer: 'Authorization: Bearer abcdefghijklmnopqrstuvwxyz',
} as const;
