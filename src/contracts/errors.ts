/**
 * Normalized application error.
 *
 * Every layer (provider adapters, filesystem adapters, workers, storage,
 * policy) throws or reports a `SourError` so the UI can render one consistent
 * failure surface and so persisted events never contain raw provider strings.
 *
 * Messages are redacted at construction time. There is no code path that
 * produces a `SourError` carrying an unredacted credential.
 */

import { redactString, redactValue } from '../security/redaction';

/** Coarse origin of a failure. Drives grouping, retry policy, and telemetry. */
export type SourErrorCategory =
  | 'provider'
  | 'policy'
  | 'filesystem'
  | 'runtime'
  | 'git'
  | 'storage'
  | 'network'
  | 'validation'
  | 'unsupported'
  | 'cancelled';

/** Serializable shape — safe to persist in the event log and to postMessage. */
export interface SourErrorData {
  readonly code: string;
  readonly message: string;
  readonly retryable: boolean;
  readonly userAction?: string;
  readonly details?: Record<string, unknown>;
  readonly causeCategory: SourErrorCategory;
}

export interface SourErrorInit {
  code: string;
  message: string;
  causeCategory: SourErrorCategory;
  retryable?: boolean;
  userAction?: string;
  details?: Record<string, unknown>;
  /** Original thrown value. Kept in memory only; never serialized. */
  cause?: unknown;
}

/** Categories that are retryable unless the caller says otherwise. */
const DEFAULT_RETRYABLE: ReadonlySet<SourErrorCategory> = new Set<SourErrorCategory>([
  'network',
  'provider',
  'storage',
]);

export class SourError extends Error implements SourErrorData {
  readonly code: string;
  readonly retryable: boolean;
  readonly userAction?: string;
  readonly details?: Record<string, unknown>;
  readonly causeCategory: SourErrorCategory;

  constructor(init: SourErrorInit) {
    super(redactString(init.message));
    this.name = 'SourError';
    this.code = init.code;
    this.causeCategory = init.causeCategory;
    this.retryable = init.retryable ?? DEFAULT_RETRYABLE.has(init.causeCategory);
    this.userAction = init.userAction ? redactString(init.userAction) : undefined;
    this.details = init.details ? (redactValue(init.details) as Record<string, unknown>) : undefined;
    if (init.cause !== undefined) {
      // Non-enumerable so structuredClone/JSON.stringify cannot pull an
      // unredacted provider error into a persisted event.
      Object.defineProperty(this, 'cause', { value: init.cause, enumerable: false, writable: false });
    }
  }

  /** Plain, redacted, structured-cloneable representation. */
  toData(): SourErrorData {
    return {
      code: this.code,
      message: this.message,
      retryable: this.retryable,
      userAction: this.userAction,
      details: this.details,
      causeCategory: this.causeCategory,
    };
  }

  toJSON(): SourErrorData {
    return this.toData();
  }
}

export function isSourError(value: unknown): value is SourError {
  return value instanceof SourError;
}

/** True for the several ways a browser signals "the caller aborted this". */
export function isAbortError(value: unknown): boolean {
  if (value instanceof SourError) return value.causeCategory === 'cancelled';
  if (typeof DOMException !== 'undefined' && value instanceof DOMException) {
    return value.name === 'AbortError';
  }
  return value instanceof Error && value.name === 'AbortError';
}

/**
 * Converts an unknown thrown value into a `SourError`.
 *
 * Anything already normalized is returned unchanged. Abort signals map to the
 * `cancelled` category rather than surfacing as failures, because a user
 * pressing Stop is not an error condition.
 */
export function normalizeError(value: unknown, fallback?: Partial<SourErrorInit>): SourError {
  if (value instanceof SourError) return value;

  if (isAbortError(value)) {
    return new SourError({
      code: 'cancelled',
      message: 'The operation was cancelled.',
      causeCategory: 'cancelled',
      retryable: false,
      cause: value,
    });
  }

  if (value instanceof Error) {
    return new SourError({
      code: fallback?.code ?? 'unexpected_error',
      message: value.message || fallback?.message || 'An unexpected error occurred.',
      causeCategory: fallback?.causeCategory ?? 'runtime',
      retryable: fallback?.retryable,
      userAction: fallback?.userAction,
      details: fallback?.details,
      cause: value,
    });
  }

  if (typeof value === 'string' && value.trim()) {
    return new SourError({
      code: fallback?.code ?? 'unexpected_error',
      message: value,
      causeCategory: fallback?.causeCategory ?? 'runtime',
      retryable: fallback?.retryable,
      userAction: fallback?.userAction,
      details: fallback?.details,
      cause: value,
    });
  }

  return new SourError({
    code: fallback?.code ?? 'unexpected_error',
    message: fallback?.message ?? 'An unexpected error occurred.',
    causeCategory: fallback?.causeCategory ?? 'runtime',
    retryable: fallback?.retryable,
    userAction: fallback?.userAction,
    details: fallback?.details,
    cause: value,
  });
}

// ── Constructors for the failures that already exist in this codebase ───────
// Each one names a concrete user action, because "something went wrong" is not
// a recoverable state for the person looking at the screen.

export function unsupportedCapability(capability: string, reason: string): SourError {
  return new SourError({
    code: 'unsupported_capability',
    message: `${capability} is not available in this browser.`,
    causeCategory: 'unsupported',
    retryable: false,
    userAction: reason,
    details: { capability },
  });
}

export function validationFailed(what: string, details?: Record<string, unknown>): SourError {
  return new SourError({
    code: 'validation_failed',
    message: `${what} failed validation.`,
    causeCategory: 'validation',
    retryable: false,
    userAction: 'This is an internal contract violation — please report it.',
    details,
  });
}

export function filesystemError(code: string, message: string, details?: Record<string, unknown>): SourError {
  return new SourError({ code, message, causeCategory: 'filesystem', retryable: false, details });
}

export function cancelled(what = 'The operation'): SourError {
  return new SourError({
    code: 'cancelled',
    message: `${what} was cancelled.`,
    causeCategory: 'cancelled',
    retryable: false,
  });
}
