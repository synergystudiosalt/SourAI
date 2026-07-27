import { describe, expect, it } from 'vitest';

import { SECRET_CANARIES, expectNoSecrets } from '../test/assertions';
import {
  SourError,
  cancelled,
  isAbortError,
  isSourError,
  normalizeError,
  unsupportedCapability,
  validationFailed,
} from './errors';

describe('SourError', () => {
  it('redacts the message, user action, and details at construction', () => {
    const error = new SourError({
      code: 'provider_rejected',
      message: `Provider rejected key ${SECRET_CANARIES.openai}`,
      causeCategory: 'provider',
      userAction: `Check ${SECRET_CANARIES.anthropic}`,
      details: { requestHeaders: { authorization: `Bearer ${SECRET_CANARIES.groq}` } },
    });

    expect(error.message).not.toContain(SECRET_CANARIES.openai);
    expectNoSecrets(error.toData(), 'SourError.toData()');
    expectNoSecrets(JSON.stringify(error), 'JSON.stringify(SourError)');
  });

  it('keeps the original cause out of the serialized form', () => {
    const raw = new Error(`upstream said ${SECRET_CANARIES.google}`);
    const error = new SourError({
      code: 'provider_failed',
      message: 'The provider request failed.',
      causeCategory: 'provider',
      cause: raw,
    });

    expect(error.cause).toBe(raw);
    expectNoSecrets(JSON.stringify(error), 'serialized SourError with a cause');
    expect(Object.keys(error.toData())).not.toContain('cause');
  });

  it('derives retryability from the category unless told otherwise', () => {
    expect(new SourError({ code: 'x', message: 'm', causeCategory: 'network' }).retryable).toBe(true);
    expect(new SourError({ code: 'x', message: 'm', causeCategory: 'validation' }).retryable).toBe(false);
    expect(new SourError({ code: 'x', message: 'm', causeCategory: 'network', retryable: false }).retryable).toBe(false);
  });

  it('is structured-cloneable once converted to data', () => {
    const error = validationFailed('tool arguments', { tool: 'file_write' });
    expect(() => structuredClone(error.toData())).not.toThrow();
  });
});

describe('normalizeError', () => {
  it('returns an existing SourError unchanged', () => {
    const original = cancelled('The run');
    expect(normalizeError(original)).toBe(original);
  });

  it('maps an AbortError to the cancelled category rather than a failure', () => {
    const abort = new DOMException('The user aborted a request.', 'AbortError');
    const normalized = normalizeError(abort);
    expect(normalized.causeCategory).toBe('cancelled');
    expect(normalized.retryable).toBe(false);
    expect(isAbortError(normalized)).toBe(true);
  });

  it('wraps a plain Error, keeping the message and applying the fallback category', () => {
    const normalized = normalizeError(new Error('disk is full'), { causeCategory: 'storage' });
    expect(normalized.message).toBe('disk is full');
    expect(normalized.causeCategory).toBe('storage');
    expect(isSourError(normalized)).toBe(true);
  });

  it('handles values that are not Errors at all', () => {
    expect(normalizeError('something broke').message).toBe('something broke');
    expect(normalizeError(undefined).message).toBe('An unexpected error occurred.');
    expect(normalizeError({ weird: true }).code).toBe('unexpected_error');
  });

  it('redacts secrets carried by a raw thrown string', () => {
    const normalized = normalizeError(`network error for ${SECRET_CANARIES.github}`);
    expectNoSecrets(normalized.toData(), 'normalized thrown string');
  });
});

describe('error constructors', () => {
  it('unsupportedCapability names the capability and what the user can do', () => {
    const error = unsupportedCapability('The Node.js runtime', 'Use a Chromium-based browser to run commands.');
    expect(error.causeCategory).toBe('unsupported');
    expect(error.retryable).toBe(false);
    expect(error.userAction).toBe('Use a Chromium-based browser to run commands.');
    expect(error.details).toEqual({ capability: 'The Node.js runtime' });
  });
});
