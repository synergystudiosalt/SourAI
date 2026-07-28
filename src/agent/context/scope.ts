import { SourError } from '../../contracts/errors';
import { isWithinRoot, workspacePath, workspaceRoot, type WorkspacePath } from '../../filesystem';
import { compileGlob } from './glob';

/**
 * The set of workspace paths a run is allowed to read.
 *
 * The scope is enforced twice on purpose: the host filters a project snapshot
 * before anything crosses into the agent worker, and the worker re-applies the
 * same rules to every tool read. A provider therefore cannot reach an excluded
 * file even if a tool, adapter, or snapshot builder is wrong.
 */

export type ScopeDenialReason = 'outside-roots' | 'sensitive' | 'excluded';

export type ScopeDecision =
  | { readonly allowed: true }
  | { readonly allowed: false; readonly reason: ScopeDenialReason; readonly pattern?: string };

export interface ContextScopeConfig {
  /** Allowed roots. An empty list, or a list containing '', means the project root. */
  readonly roots?: readonly string[];
  /** User-configured exclusions, applied in addition to the sensitive defaults. */
  readonly excludedPaths?: readonly string[];
  /** Replaces the default noise exclusions when provided. */
  readonly noisePaths?: readonly string[];
}

export interface ContextScopeDescription {
  readonly roots: readonly string[];
  readonly sensitivePatterns: readonly string[];
  readonly excludedPatterns: readonly string[];
  readonly noisePatterns: readonly string[];
}

/**
 * Paths that are never sent anywhere, cannot be re-enabled by configuration,
 * and are excluded before a user ever sees a context preview.
 */
export const SENSITIVE_PATH_PATTERNS: readonly string[] = Object.freeze([
  '**/.env',
  '**/.env.*',
  '**/.git/**',
  '**/.npmrc',
  '**/.netrc',
  '**/.git-credentials',
  '**/.aws/**',
  '**/.ssh/**',
  '**/*.pem',
  '**/*.key',
  '**/*.p12',
  '**/*.pfx',
  '**/*.jks',
  '**/*.keystore',
  '**/id_rsa*',
  '**/id_ed25519*',
  '**/id_ecdsa*',
  '**/*.secret',
  '**/secrets.*',
  '**/credentials.json',
  '**/service-account*.json',
]);

/** Large or generated paths excluded by default. Callers may replace these. */
export const DEFAULT_NOISE_PATTERNS: readonly string[] = Object.freeze([
  'node_modules/**',
  '**/node_modules/**',
  'dist/**',
  'build/**',
  'coverage/**',
  '.next/**',
  '.turbo/**',
  '**/*.min.js',
  '**/*.map',
  'package-lock.json',
  'pnpm-lock.yaml',
  'yarn.lock',
]);

const MAX_PATTERNS = 128;

interface CompiledPattern {
  readonly source: string;
  readonly expression: RegExp;
}

function compileAll(patterns: readonly string[], field: string): readonly CompiledPattern[] {
  if (patterns.length > MAX_PATTERNS) {
    throw new TypeError(`${field} accepts at most ${MAX_PATTERNS} patterns.`);
  }
  return Object.freeze(
    patterns.map((source) => {
      if (typeof source !== 'string' || !source.trim()) {
        throw new TypeError(`${field} entries must be non-empty strings.`);
      }
      return Object.freeze({ source, expression: compileGlob(source) });
    })
  );
}

export class ContextScope {
  readonly #roots: readonly WorkspacePath[];
  readonly #sensitive: readonly CompiledPattern[];
  readonly #excluded: readonly CompiledPattern[];
  readonly #noise: readonly CompiledPattern[];

  constructor(config: ContextScopeConfig = {}) {
    const roots = (config.roots ?? []).map((value) => workspacePath(value, true));
    this.#roots = Object.freeze(roots.includes(workspaceRoot()) || roots.length === 0 ? [workspaceRoot()] : roots);
    this.#sensitive = compileAll(SENSITIVE_PATH_PATTERNS, 'sensitivePatterns');
    this.#excluded = compileAll(config.excludedPaths ?? [], 'excludedPaths');
    this.#noise = compileAll(config.noisePaths ?? DEFAULT_NOISE_PATTERNS, 'noisePaths');
  }

  /** Whole-project scope with the default sensitive and noise exclusions. */
  static projectDefault(): ContextScope {
    return new ContextScope();
  }

  decide(value: string): ScopeDecision {
    let path: WorkspacePath;
    try {
      path = workspacePath(value);
    } catch {
      return { allowed: false, reason: 'outside-roots' };
    }
    if (!this.#roots.some((root) => isWithinRoot(path, root))) {
      return { allowed: false, reason: 'outside-roots' };
    }
    const sensitive = this.#sensitive.find((pattern) => pattern.expression.test(path));
    if (sensitive) return { allowed: false, reason: 'sensitive', pattern: sensitive.source };
    const excluded = this.#excluded.find((pattern) => pattern.expression.test(path));
    if (excluded) return { allowed: false, reason: 'excluded', pattern: excluded.source };
    const noise = this.#noise.find((pattern) => pattern.expression.test(path));
    if (noise) return { allowed: false, reason: 'excluded', pattern: noise.source };
    return { allowed: true };
  }

  allows(value: string): boolean {
    return this.decide(value).allowed;
  }

  /** Throws a policy error naming the reason, never the file contents. */
  assertReadable(value: string): WorkspacePath {
    const decision = this.decide(value);
    if (decision.allowed) return workspacePath(value);
    throw new SourError({
      code: 'context_scope_denied',
      message:
        decision.reason === 'sensitive'
          ? 'That path is excluded because it can hold credentials.'
          : decision.reason === 'excluded'
            ? 'That path is excluded from this run.'
            : 'That path is outside the approved context scope.',
      causeCategory: 'policy',
      retryable: false,
      userAction: 'Change the run context scope if this file should be readable.',
      details: { reason: decision.reason, ...(decision.pattern ? { pattern: decision.pattern } : {}) },
    });
  }

  /** True when a directory may contain readable paths, used to prune traversal. */
  allowsDirectory(value: string): boolean {
    let path: WorkspacePath;
    try {
      path = workspacePath(value, true);
    } catch {
      return false;
    }
    if (path === workspaceRoot()) return true;
    if (!this.#roots.some((root) => isWithinRoot(path, root) || isWithinRoot(root, path))) return false;
    const prefix = `${path}/`;
    return ![...this.#sensitive, ...this.#excluded, ...this.#noise].some(
      (pattern) => pattern.expression.test(path) || pattern.expression.test(`${prefix}x`)
    );
  }

  describe(): ContextScopeDescription {
    return Object.freeze({
      roots: Object.freeze(this.#roots.map(String)),
      sensitivePatterns: Object.freeze(this.#sensitive.map((pattern) => pattern.source)),
      excludedPatterns: Object.freeze(this.#excluded.map((pattern) => pattern.source)),
      noisePatterns: Object.freeze(this.#noise.map((pattern) => pattern.source)),
    });
  }

  /** Structured-cloneable form for the worker boundary. */
  toConfig(): Required<ContextScopeConfig> {
    const description = this.describe();
    return Object.freeze({
      roots: description.roots,
      excludedPaths: description.excludedPatterns,
      noisePaths: description.noisePatterns,
    });
  }

  /** Rebuilds a scope from untrusted structured-clone data. */
  static fromConfig(value: unknown): ContextScope {
    if (value === undefined || value === null) return ContextScope.projectDefault();
    if (typeof value !== 'object' || Array.isArray(value)) {
      throw new TypeError('Context scope configuration must be an object.');
    }
    const record = value as Record<string, unknown>;
    return new ContextScope({
      roots: stringList(record.roots, 'roots'),
      excludedPaths: stringList(record.excludedPaths, 'excludedPaths'),
      ...(record.noisePaths === undefined ? {} : { noisePaths: stringList(record.noisePaths, 'noisePaths') }),
    });
  }
}

function stringList(value: unknown, field: string): readonly string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new TypeError(`${field} must be an array of strings.`);
  return value.map((item) => {
    if (typeof item !== 'string') throw new TypeError(`${field} must be an array of strings.`);
    return item;
  });
}
