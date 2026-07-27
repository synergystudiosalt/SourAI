import { describe, expect, it } from 'vitest';

import { SECRET_CANARIES, expectNoSecrets } from '../test/assertions';
import {
  SourError,
  cancelled,
  getSourErrorCause,
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

    expect(getSourErrorCause(error)).toBe(raw);
    expect((error as Error & { cause?: unknown }).cause).toBeUndefined();
    expectNoSecrets(JSON.stringify(error), 'serialized SourError with a cause');
    expect(Object.keys(error.toData())).not.toContain('cause');
  });

  it('does not leak a raw cause through the platform Error structured-clone path', () => {
    const raw = new Error(`upstream said ${SECRET_CANARIES.google}`);
    const error = normalizeError(raw, { causeCategory: 'provider' });
    const cloned = structuredClone(error) as Error & { cause?: unknown };

    expect(cloned.cause).toBeUndefined();
    expectNoSecrets(cloned.message, 'structured-cloned SourError message');
    expectNoSecrets(cloned.stack ?? '', 'structured-cloned SourError stack');
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

  it('defensively sanitizes unsupported detail values without invoking accessors', () => {
    let getterCalls = 0;
    const details: Record<string, unknown> = {
      count: 42n,
      callback: () => 'not serializable',
      marker: Symbol('not serializable'),
      missing: undefined,
      date: new Date('2025-01-02T03:04:05.000Z'),
      map: new Map([['provider', SECRET_CANARIES.openai]]),
      bytes: new Uint8Array([1, 2, 3]),
    };
    Object.defineProperty(details, 'danger', {
      enumerable: true,
      get() {
        getterCalls++;
        throw new Error('must not run');
      },
    });

    const error = new SourError({
      code: 'unsafe_details',
      message: 'The provider failed.',
      causeCategory: 'provider',
      details,
    });
    const data = error.toData();

    expect(getterCalls).toBe(0);
    expect(() => JSON.stringify(error)).not.toThrow();
    expect(() => structuredClone(data)).not.toThrow();
    expectNoSecrets(data, 'defensively sanitized error details');
  });

  it('is deeply immutable and returns a fresh immutable data snapshot each time', () => {
    const error = new SourError({
      code: 'immutable',
      message: 'Safe message',
      causeCategory: 'runtime',
      details: { nested: { safe: 'value' } },
    });
    const first = error.toData();
    const second = error.toData();
    const nested = error.details?.nested as Record<string, unknown>;

    expect(Object.isFrozen(error)).toBe(true);
    expect(Object.isFrozen(error.details)).toBe(true);
    expect(Object.isFrozen(nested)).toBe(true);
    expect(first).not.toBe(second);
    expect(first.details).not.toBe(second.details);
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first.details)).toBe(true);
    expect(Reflect.set(error, 'message', SECRET_CANARIES.openai)).toBe(false);
    expect(Reflect.set(nested, 'apiKey', SECRET_CANARIES.openai)).toBe(false);
    expect(error.message).toBe('Safe message');
    expectNoSecrets(error.toData(), 'immutable SourError');
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
