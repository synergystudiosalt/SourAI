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
 * Separator between a credential's key name and its value.
 *
 * The optional quote before the separator is what makes JSON work:
 * `{"api_key":"…"}` puts a `"` between the key and the colon, and without this
 * every JSON-encoded credential passes through untouched — which is the shape
 * credentials most often take in a logged fetch header, an echoed request body,
 * or a provider error response.
 */
const ASSIGN = String.raw`["'\`]?\s*[:=]\s*["'\`]?`;

/**
 * Characters a credential value may contain.
 *
 * Brackets and parentheses are excluded so a function call on the right-hand
 * side of a key-like name (`passwordHash: bcryptCompare(a, b)`) cannot be
 * captured and mangled.
 */
const VALUE = String.raw`[^\s,;"'\`()\[\]{}<>]`;

/**
 * Dedicated header, URL, and vendor-token rules. Generic assignments are
 * handled by the single-pass scanner below so long key names remain supported
 * without the overlapping wildcard pattern that previously caused quadratic
 * backtracking.
 */
const RULES: readonly RedactionRule[] = [
  // Authorization / Proxy-Authorization headers, with or without a scheme.
  {
    name: 'auth-header',
    pattern: new RegExp(String.raw`\b(?:authorization|proxy-authorization)\b${ASSIGN}(?:bearer\s+|basic\s+|token\s+)?(${VALUE}+)`, 'gi'),
    group: 1,
  },

  // `x-api-key: value`, `api-key: value`, `x-goog-api-key: value`.
  {
    name: 'api-key-header',
    pattern: new RegExp(String.raw`\b(?:x-[\w-]{0,40}api-key|api-key|x-goog-api-key)\b${ASSIGN}(${VALUE}+)`, 'gi'),
    group: 1,
  },

  // URL userinfo: https://user:password@host.
  { name: 'url-userinfo', pattern: /\b([a-z][a-z0-9+.-]*:\/\/[^\s/:@]+):([^\s/@]+)@/gi, group: 2 },

  // Credentials in a query string or a URL fragment.
  {
    name: 'url-query-secret',
    pattern: /([?&#](?:key|api_key|apikey|access_token|id_token|refresh_token|token|auth|signature|sig)=)([^&\s"'`]+)/gi,
    group: 2,
  },

  // Vendor token shapes that are recognisable on their own.
  { name: 'openai-key', pattern: /\bsk-(?:proj-|ant-|or-|live-|test-)?[A-Za-z0-9_-]{16,}/g, group: 0 },
  { name: 'anthropic-key', pattern: /\bsk-ant-[A-Za-z0-9_-]{16,}/g, group: 0 },
  { name: 'google-key', pattern: /\bAIza[0-9A-Za-z_-]{20,}/g, group: 0 },
  { name: 'groq-key', pattern: /\bgsk_[A-Za-z0-9]{20,}/g, group: 0 },
  { name: 'github-token', pattern: /\b(?:ghp|gho|ghu|ghs|ghr|github_pat)_[A-Za-z0-9_]{20,}/g, group: 0 },
  { name: 'slack-token', pattern: /\bxox[abposr]-[A-Za-z0-9-]{10,}/g, group: 0 },
  { name: 'aws-access-key-id', pattern: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g, group: 0 },
  { name: 'hugging-face-token', pattern: /\bhf_[A-Za-z0-9]{20,}/g, group: 0 },
  { name: 'xai-key', pattern: /\bxai-[A-Za-z0-9]{20,}/g, group: 0 },
  { name: 'fireworks-key', pattern: /\bfw_[A-Za-z0-9]{20,}/g, group: 0 },
  { name: 'openrouter-key', pattern: /\bsk-or-v1-[a-f0-9]{32,}/g, group: 0 },
  { name: 'stripe-key', pattern: /\b(?:sk|rk|pk)_(?:live|test)_[A-Za-z0-9]{16,}/g, group: 0 },
  { name: 'google-oauth-token', pattern: /\bya29\.[A-Za-z0-9_-]{20,}/g, group: 0 },

  // JWTs — three base64url segments. Only matched when the header segment
  // starts with `eyJ`, which is what `{"` encodes to.
  { name: 'jwt', pattern: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g, group: 0 },

  // PEM private key blocks.
  { name: 'pem-private-key', pattern: /-----BEGIN (?:[A-Z ]+ )?PRIVATE KEY-----[\s\S]*?-----END (?:[A-Z ]+ )?PRIVATE KEY-----/g, group: 0 },
];

/**
 * Generic assignment scanner.
 *
 * The key is captured as one greedy identifier and checked in code. This is
 * deliberately different from putting `.*secret.*` inside the regex: there is
 * only one possible start per identifier, so even a multi-megabyte identifier
 * is scanned linearly rather than enumerating every possible split point.
 *
 * Quoted values may contain spaces, which covers JSON and passphrases. The
 * unquoted branch stops at source/config punctuation.
 */
const SENSITIVE_ASSIGNMENT_RE =
  /(^|[^\w$.-])([A-Za-z_$][\w$.-]*)(["'`]?\s*[:=]\s*)(?:"([^"\r\n]*)"|'([^'\r\n]*)'|`([^`\r\n]*)`|([^\s,;"'`()\[\]{}<>]+))/gm;

/** Property names whose values are always masked, regardless of shape. */
const SENSITIVE_KEY_RE = /(api[_-]?key|apikey|secret|password|passwd|token|credential|private[_-]?key|access[_-]?key|session[_-]?key|passphrase|authorization|cookie)/i;

/** Type words and source expressions that are not runtime credential values. */
const TYPE_OR_CODE_VALUE_RE =
  /^(?:string|number|boolean|unknown|any|null|undefined|void|object|never|symbol|bigint|true|false|function|readonly|required|optional|process\.env\.[A-Za-z_$][\w$]*)$/i;

/** A declaration prefix makes an unquoted identifier an expression, not a literal secret. */
const DECLARATION_PREFIX_RE =
  /(?:^|[;{}])\s*(?:(?:export|declare|public|private|protected|static|readonly|abstract)\s+)*(?:const|let|var|type|class|interface)\s*$/;

/**
 * Values registered at runtime (e.g. keys held by active provider configs).
 *
 * Counts are required because two providers can legitimately share a key.
 * Removing one owner must not disable redaction while another owner still
 * holds the same credential.
 */
const registeredSecrets = new Map<string, number>();

/**
 * Registers a literal secret so it is masked everywhere even if its shape is
 * not recognised by any rule. Registration is explicit, so even short values
 * are honoured; only the empty string and all-whitespace values are ignored.
 */
export function registerSecret(value: string | null | undefined): void {
  if (typeof value !== 'string' || value.length === 0 || value.trim().length === 0) return;
  registeredSecrets.set(value, (registeredSecrets.get(value) ?? 0) + 1);
}

/** Removes a previously registered secret (e.g. when the vault is locked). */
export function unregisterSecret(value: string | null | undefined): void {
  if (typeof value !== 'string') return;
  const owners = registeredSecrets.get(value);
  if (owners === undefined) return;
  if (owners <= 1) registeredSecrets.delete(value);
  else registeredSecrets.set(value, owners - 1);
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

  // Longest first prevents a short registered value from exposing the suffix
  // of a longer value that shares the same prefix.
  const literals = [...registeredSecrets.keys()].sort((a, b) => b.length - a.length);
  for (const secret of literals) {
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

  return redactSensitiveAssignments(output);
}

/**
 * Redacts generic sensitive assignments after the dedicated header/URL rules
 * have run. Source annotations and obvious expressions stay readable, while a
 * quoted value is always treated as data — even when it is one character long
 * or contains only letters.
 */
function redactSensitiveAssignments(input: string): string {
  const re = new RegExp(SENSITIVE_ASSIGNMENT_RE.source, SENSITIVE_ASSIGNMENT_RE.flags);
  return input.replace(
    re,
    (
      match,
      prefix: string,
      key: string,
      separator: string,
      doubleQuoted: string | undefined,
      singleQuoted: string | undefined,
      templateQuoted: string | undefined,
      unquoted: string | undefined,
      offset: number,
      source: string
    ) => {
      if (!SENSITIVE_KEY_RE.test(key)) return match;
      // Dedicated authorization rules preserve the useful Bearer/Basic scheme.
      if (/^(?:authorization|proxy-authorization)$/i.test(key)) return match;

      const captured = doubleQuoted ?? singleQuoted ?? templateQuoted ?? unquoted;
      if (captured === undefined || captured.length === 0 || captured === REDACTED) return match;

      const isQuoted =
        doubleQuoted !== undefined || singleQuoted !== undefined || templateQuoted !== undefined;
      if (!isQuoted && isClearlySourceExpression(captured, separator, prefix, offset, match, source)) {
        return match;
      }

      const at = match.lastIndexOf(captured);
      if (at < 0) return match;
      return match.slice(0, at) + REDACTED + match.slice(at + captured.length);
    }
  );
}

function isClearlySourceExpression(
  value: string,
  separator: string,
  prefix: string,
  offset: number,
  match: string,
  source: string
): boolean {
  if (TYPE_OR_CODE_VALUE_RE.test(value)) return true;

  const next = source[offset + match.length] ?? '';
  // Function calls, generic types, indexed types, and member access are source
  // expressions. The scanner intentionally stops before these delimiters.
  if (next === '(' || next === '[' || next === '<' || next === '.') return true;

  const keyOffset = offset + prefix.length;
  const lineStart = Math.max(source.lastIndexOf('\n', keyOffset - 1), source.lastIndexOf('\r', keyOffset - 1)) + 1;
  const beforeKey = source.slice(lineStart, keyOffset);
  if (DECLARATION_PREFIX_RE.test(beforeKey)) return true;

  // Custom TypeScript type names commonly start with an uppercase letter.
  // Restrict this exception to colon annotations; `API_KEY=ABC` remains data.
  return separator.includes(':') && /^[A-Z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*$/.test(value);
}

export type RedactedValue =
  | null
  | boolean
  | number
  | string
  | RedactedValue[]
  | { [key: string]: RedactedValue };

/**
 * Recursively masks secrets in an arbitrary value.
 *
 * Objects are walked by key: a key that looks sensitive has its value replaced
 * wholesale, otherwise the value is converted to plain JSON/structured-clone
 * safe data and redacted by content. The active recursion path is tracked so a
 * true cycle cannot hang the caller while repeated, non-cyclic references are
 * serialized normally. Depth is bounded because this runs on untrusted tool
 * output.
 */
export function redactValue(value: unknown, maxDepth = 8): RedactedValue {
  return redactInternal(value, maxDepth, new WeakSet<object>());
}

function redactInternal(value: unknown, depthRemaining: number, activePath: WeakSet<object>): RedactedValue {
  if (typeof value === 'string') return redactString(value);
  if (value === null || typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : `[${String(value)}]`;
  if (typeof value === 'bigint') return `${value.toString()}n`;
  if (typeof value === 'undefined') return '[undefined]';
  if (typeof value === 'function') return '[function]';
  if (typeof value === 'symbol') return '[symbol]';
  if (typeof value !== 'object') return `[${typeof value}]`;
  if (depthRemaining <= 0) return '[truncated]';
  if (activePath.has(value)) return '[circular]';
  activePath.add(value);

  try {
    if (Array.isArray(value)) {
      return value.map((entry) => redactInternal(entry, depthRemaining - 1, activePath));
    }

    if (value instanceof Date) {
      return Number.isNaN(value.getTime()) ? '[Invalid Date]' : value.toISOString();
    }

    if (value instanceof RegExp) return redactString(value.toString());
    if (typeof URL !== 'undefined' && value instanceof URL) return redactString(value.toString());

    if (value instanceof Map) {
      const entries: RedactedValue[] = [];
      for (const [key, entry] of value.entries()) {
        entries.push([
          redactInternal(key, depthRemaining - 1, activePath),
          typeof key === 'string' && SENSITIVE_KEY_RE.test(key)
            ? REDACTED
            : redactInternal(entry, depthRemaining - 1, activePath),
        ]);
      }
      return { '[map]': entries };
    }

    if (value instanceof Set) {
      return {
        '[set]': [...value].map((entry) => redactInternal(entry, depthRemaining - 1, activePath)),
      };
    }

    if (value instanceof Error) {
      const output: Record<string, RedactedValue> = Object.create(null);
      output.name = redactString(value.name);
      output.message = redactString(value.message);
      if (typeof value.stack === 'string') output.stack = redactString(value.stack);
      copyEnumerableDataProperties(value, output, depthRemaining, activePath);
      return output;
    }

    if (typeof ArrayBuffer !== 'undefined') {
      if (value instanceof ArrayBuffer) return `[ArrayBuffer ${value.byteLength} bytes]`;
      if (ArrayBuffer.isView(value)) {
        const name = value.constructor?.name || 'ArrayBufferView';
        return `[${name} ${value.byteLength} bytes]`;
      }
    }

    if (typeof Blob !== 'undefined' && value instanceof Blob) {
      const output: Record<string, RedactedValue> = {
        type: redactString(value.type),
        size: value.size,
      };
      if (typeof File !== 'undefined' && value instanceof File) {
        output.name = redactString(value.name);
        output.lastModified = value.lastModified;
      }
      return { '[blob]': output };
    }

    if (value instanceof WeakMap) return '[WeakMap]';
    if (value instanceof WeakSet) return '[WeakSet]';
    if (value instanceof Promise) return '[Promise]';

    const output: Record<string, RedactedValue> = Object.create(null);
    copyEnumerableDataProperties(value, output, depthRemaining, activePath);
    return output;
  } catch {
    return '[unserializable object]';
  } finally {
    activePath.delete(value);
  }
}

function copyEnumerableDataProperties(
  source: object,
  output: Record<string, RedactedValue>,
  depthRemaining: number,
  activePath: WeakSet<object>
): void {
  const keys = Object.keys(source);
  for (const key of keys) {
    if (SENSITIVE_KEY_RE.test(key)) {
      output[key] = REDACTED;
      continue;
    }

    let descriptor: PropertyDescriptor | undefined;
    try {
      descriptor = Object.getOwnPropertyDescriptor(source, key);
    } catch {
      output[key] = '[unavailable]';
      continue;
    }

    if (!descriptor) {
      output[key] = '[unavailable]';
    } else if (!('value' in descriptor)) {
      // Never execute an accessor while trying to report a different failure.
      output[key] = '[accessor]';
    } else {
      output[key] = redactInternal(descriptor.value, depthRemaining - 1, activePath);
    }
  }
}

/** True when the input still contains something that looks like a secret. */
export function containsSecret(input: string): boolean {
  return redactString(input) !== input;
}
