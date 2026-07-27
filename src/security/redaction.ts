/**
 * Secret redaction.
 *
 * Every string that can reach a log, a persisted event, an error surface, an
 * export, or a model prompt passes through here first. The rules below are
 * deliberately conservative: a false positive costs a few masked characters,
 * a false negative leaks a credential.
 *
 * This module must never depend on application state, storage, or React so it
 * can be used from workers and from the error boundary of a half-booted app.
 */

/** Replacement text substituted for a detected secret. */
export const REDACTED = '[redacted]';

interface RedactionRule {
  readonly name: string;
  readonly pattern: RegExp;
  /**
   * Which capture group holds the secret. `0` means the whole match is the
   * secret; a positive number keeps the surrounding text and masks only that
   * group (used for `key=value` shapes so the key name stays readable).
   */
  readonly group: number;
}

/**
 * Ordered rules. Broad structural rules (assignment shapes) run before
 * vendor-specific token shapes so that `OPENAI_API_KEY=sk-...` is masked once
 * rather than producing overlapping rewrites.
 */
const RULES: readonly RedactionRule[] = [
  // Authorization / Proxy-Authorization headers, with or without a scheme.
  { name: 'auth-header', pattern: /\b(?:authorization|proxy-authorization)\b\s*[:=]\s*(?:bearer\s+|basic\s+|token\s+)?([^\s,;"'`]+)/gi, group: 1 },

  // `x-api-key: value`, `api-key: value`, `x-goog-api-key: value`.
  { name: 'api-key-header', pattern: /\b(?:x-[\w-]*api-key|api-key|x-goog-api-key)\b\s*[:=]\s*([^\s,;"'`]+)/gi, group: 1 },

  // Generic assignment shapes: SOMETHING_SECRET = "value".
  { name: 'assigned-secret', pattern: /\b([\w.-]*(?:api[_-]?key|apikey|secret|password|passwd|token|credential|private[_-]?key|access[_-]?key|session[_-]?key|passphrase)[\w.-]*)\b\s*[:=]\s*["'`]?([^\s,;"'`]{4,})["'`]?/gi, group: 2 },

  // URL userinfo: https://user:password@host.
  { name: 'url-userinfo', pattern: /\b([a-z][a-z0-9+.-]*:\/\/[^\s/:@]+):([^\s/@]+)@/gi, group: 2 },

  // Query-string credentials: ?key=... / &access_token=...
  { name: 'url-query-secret', pattern: /([?&](?:key|api_key|apikey|access_token|token|auth|signature|sig)=)([^&\s"'`]+)/gi, group: 2 },

  // Vendor token shapes that are recognisable on their own.
  { name: 'openai-key', pattern: /\bsk-(?:proj-|ant-|or-|live-|test-)?[A-Za-z0-9_-]{16,}/g, group: 0 },
  { name: 'anthropic-key', pattern: /\bsk-ant-[A-Za-z0-9_-]{16,}/g, group: 0 },
  { name: 'google-key', pattern: /\bAIza[0-9A-Za-z_-]{20,}/g, group: 0 },
  { name: 'groq-key', pattern: /\bgsk_[A-Za-z0-9]{20,}/g, group: 0 },
  { name: 'github-token', pattern: /\b(?:ghp|gho|ghu|ghs|ghr|github_pat)_[A-Za-z0-9_]{20,}/g, group: 0 },
  { name: 'slack-token', pattern: /\bxox[abposr]-[A-Za-z0-9-]{10,}/g, group: 0 },
  { name: 'aws-access-key-id', pattern: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g, group: 0 },
  { name: 'hugging-face-token', pattern: /\bhf_[A-Za-z0-9]{20,}/g, group: 0 },

  // JWTs — three base64url segments. Only matched when the header segment
  // starts with `eyJ`, which is what `{"` encodes to.
  { name: 'jwt', pattern: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g, group: 0 },

  // PEM private key blocks.
  { name: 'pem-private-key', pattern: /-----BEGIN (?:[A-Z ]+ )?PRIVATE KEY-----[\s\S]*?-----END (?:[A-Z ]+ )?PRIVATE KEY-----/g, group: 0 },
];

/** Property names whose values are always masked, regardless of shape. */
const SENSITIVE_KEY_RE = /(api[_-]?key|apikey|secret|password|passwd|token|credential|private[_-]?key|access[_-]?key|session[_-]?key|passphrase|authorization|cookie)/i;

/** Values registered at runtime (e.g. the key the user just typed). */
const registeredSecrets = new Set<string>();

/**
 * Registers a literal secret so it is masked everywhere even if its shape is
 * not recognised by any rule. Values shorter than 8 characters are ignored:
 * masking them would corrupt unrelated text far more often than it would
 * protect anything.
 */
export function registerSecret(value: string | null | undefined): void {
  if (typeof value === 'string' && value.length >= 8) registeredSecrets.add(value);
}

/** Removes a previously registered secret (e.g. when the vault is locked). */
export function unregisterSecret(value: string | null | undefined): void {
  if (typeof value === 'string') registeredSecrets.delete(value);
}

/** Clears every registered secret. Used by tests and by vault teardown. */
export function clearRegisteredSecrets(): void {
  registeredSecrets.clear();
}

/**
 * Masks secrets in a string.
 *
 * Rules run in order. Each rule masks only its designated capture group so the
 * surrounding text stays diagnosable — `GEMINI_API_KEY=[redacted]` is far more
 * useful in a bug report than `[redacted]`.
 */
export function redactString(input: string): string {
  if (!input) return input;
  let output = input;

  for (const secret of registeredSecrets) {
    output = output.split(secret).join(REDACTED);
  }

  for (const rule of RULES) {
    // Rules carry the `g` flag, so `lastIndex` is reset per call by using a
    // fresh RegExp rather than mutating the shared instance.
    const re = new RegExp(rule.pattern.source, rule.pattern.flags);
    output = output.replace(re, (match, ...groups) => {
      if (rule.group === 0) return REDACTED;
      const captured = groups[rule.group - 1];
      if (typeof captured !== 'string' || captured.length === 0) return match;
      const at = match.lastIndexOf(captured);
      if (at < 0) return match;
      return match.slice(0, at) + REDACTED + match.slice(at + captured.length);
    });
  }

  return output;
}

/**
 * Recursively masks secrets in an arbitrary value.
 *
 * Objects are walked by key: a key that looks sensitive has its value replaced
 * wholesale, otherwise the value is redacted by content. Cycles are tracked so
 * a self-referential object cannot hang the caller. Depth is bounded because
 * this runs on untrusted tool output.
 */
export function redactValue<T>(value: T, maxDepth = 8): T {
  return redactInternal(value, maxDepth, new WeakSet<object>()) as T;
}

function redactInternal(value: unknown, depthRemaining: number, seen: WeakSet<object>): unknown {
  if (typeof value === 'string') return redactString(value);
  if (value === null || typeof value !== 'object') return value;
  if (depthRemaining <= 0) return '[truncated]';
  if (seen.has(value as object)) return '[circular]';
  seen.add(value as object);

  if (Array.isArray(value)) {
    return value.map((entry) => redactInternal(entry, depthRemaining - 1, seen));
  }

  if (value instanceof Error) {
    return { name: value.name, message: redactString(value.message) };
  }

  const source = value as Record<string, unknown>;
  const output: Record<string, unknown> = {};
  for (const key of Object.keys(source)) {
    output[key] = SENSITIVE_KEY_RE.test(key)
      ? REDACTED
      : redactInternal(source[key], depthRemaining - 1, seen);
  }
  return output;
}

/** True when the input still contains something that looks like a secret. */
export function containsSecret(input: string): boolean {
  return redactString(input) !== input;
}
