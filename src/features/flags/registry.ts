/**
 * Feature flag registry.
 *
 * Flags exist so the client-only rewrite can land incrementally without ever
 * shipping a half-migrated code path to users. Each flag names the migration
 * phase that owns it; a flag is deleted once its phase is complete and the
 * legacy path has been removed.
 *
 * Environment values must be referenced as literal `import.meta.env.VITE_*`
 * property accesses — Vite performs a static text substitution at build time
 * and cannot resolve a computed lookup.
 */

export type FlagStability = 'stable' | 'beta' | 'experimental';

export interface FlagDefinition {
  /** Stable key used in code, storage overrides, and support conversations. */
  readonly key: FlagKey;
  readonly title: string;
  readonly description: string;
  /** Value used when no environment variable and no override is present. */
  readonly defaultValue: boolean;
  /** Raw build-time value, or `undefined` when the variable is unset. */
  readonly envValue: string | undefined;
  /** Name of the environment variable, shown in settings and docs. */
  readonly envVar: string;
  readonly stability: FlagStability;
  /** Migration phase that owns this flag. */
  readonly phase: number;
  /**
   * When true, the flag additionally requires a runtime capability check
   * before the feature may be used. The flag alone never implies support.
   */
  readonly requiresCapabilityCheck: boolean;
}

export type FlagKey =
  | 'clientAgentRuntime'
  | 'opfsProjects'
  | 'localFolderProjects'
  | 'webContainers'
  | 'pyodide'
  | 'webllm'
  | 'remoteMcp'
  | 'editPrediction'
  | 'auditLog'
  | 'telemetry';

const DEFINITIONS: readonly FlagDefinition[] = [
  {
    key: 'clientAgentRuntime',
    title: 'Client-only agent runtime',
    description:
      'Runs the structured agent loop in a browser worker. Disabling it never enables a server fallback.',
    defaultValue: true,
    envValue: import.meta.env.VITE_ENABLE_CLIENT_AGENT,
    envVar: 'VITE_ENABLE_CLIENT_AGENT',
    stability: 'experimental',
    phase: 3,
    requiresCapabilityCheck: true,
  },
  {
    key: 'opfsProjects',
    title: 'Browser-native projects (OPFS)',
    description: 'Stores virtual projects in the Origin Private File System instead of localStorage.',
    defaultValue: false,
    envValue: import.meta.env.VITE_ENABLE_OPFS_PROJECTS,
    envVar: 'VITE_ENABLE_OPFS_PROJECTS',
    stability: 'experimental',
    phase: 2,
    requiresCapabilityCheck: true,
  },
  {
    key: 'localFolderProjects',
    title: 'Local folder projects',
    description: 'Opens a real folder on disk through the File System Access API. Chromium-based browsers only.',
    defaultValue: true,
    envValue: import.meta.env.VITE_ENABLE_LOCAL_FOLDER_PROJECTS,
    envVar: 'VITE_ENABLE_LOCAL_FOLDER_PROJECTS',
    stability: 'beta',
    phase: 2,
    requiresCapabilityCheck: true,
  },
  {
    key: 'webContainers',
    title: 'Node.js runtime (WebContainer)',
    description:
      'Runs Node.js commands and dev servers in the browser. Requires cross-origin isolation and a commercial licence decision.',
    defaultValue: false,
    envValue: import.meta.env.VITE_ENABLE_WEBCONTAINERS,
    envVar: 'VITE_ENABLE_WEBCONTAINERS',
    stability: 'experimental',
    phase: 5,
    requiresCapabilityCheck: true,
  },
  {
    key: 'pyodide',
    title: 'Python runtime (Pyodide)',
    description: 'Runs Python in a worker. Only pure-Python and Pyodide-ported packages are supported.',
    defaultValue: false,
    envValue: import.meta.env.VITE_ENABLE_PYODIDE,
    envVar: 'VITE_ENABLE_PYODIDE',
    stability: 'experimental',
    phase: 5,
    requiresCapabilityCheck: true,
  },
  {
    key: 'webllm',
    title: 'Local models (WebLLM)',
    description: 'Runs inference on-device with WebGPU. No prompt or project content leaves the browser.',
    defaultValue: false,
    envValue: import.meta.env.VITE_ENABLE_WEBLLM,
    envVar: 'VITE_ENABLE_WEBLLM',
    stability: 'experimental',
    phase: 3,
    requiresCapabilityCheck: true,
  },
  {
    key: 'remoteMcp',
    title: 'Remote MCP servers',
    description: 'Connects to Streamable HTTP MCP endpoints. Local stdio MCP servers cannot be supported in a browser.',
    defaultValue: false,
    envValue: import.meta.env.VITE_ENABLE_REMOTE_MCP,
    envVar: 'VITE_ENABLE_REMOTE_MCP',
    stability: 'experimental',
    phase: 6,
    requiresCapabilityCheck: false,
  },
  {
    key: 'editPrediction',
    title: 'Edit prediction',
    description: 'Predicts the next edit as you type. Off by default for remote providers until explicitly consented to.',
    defaultValue: false,
    envValue: import.meta.env.VITE_ENABLE_EDIT_PREDICTION,
    envVar: 'VITE_ENABLE_EDIT_PREDICTION',
    stability: 'experimental',
    phase: 8,
    requiresCapabilityCheck: false,
  },
  {
    key: 'auditLog',
    title: 'Local audit log',
    description: 'Records a hash-chained, tamper-evident local log of security-relevant actions.',
    defaultValue: false,
    envValue: import.meta.env.VITE_ENABLE_AUDIT_LOG,
    envVar: 'VITE_ENABLE_AUDIT_LOG',
    stability: 'experimental',
    phase: 9,
    requiresCapabilityCheck: false,
  },
  {
    key: 'telemetry',
    title: 'Client telemetry',
    description: 'Sends anonymous error reports. Requires explicit consent; no request is made before consent is granted.',
    defaultValue: false,
    envValue: import.meta.env.VITE_ENABLE_TELEMETRY,
    envVar: 'VITE_ENABLE_TELEMETRY',
    stability: 'experimental',
    phase: 9,
    requiresCapabilityCheck: false,
  },
];

const BY_KEY: ReadonlyMap<FlagKey, FlagDefinition> = new Map(DEFINITIONS.map((d) => [d.key, d]));

export function listFlagDefinitions(): readonly FlagDefinition[] {
  return DEFINITIONS;
}

export function getFlagDefinition(key: FlagKey): FlagDefinition {
  const definition = BY_KEY.get(key);
  // A missing definition is a programming error, not a runtime condition:
  // `FlagKey` is a closed union, so this can only fire if the two drift.
  if (!definition) throw new Error(`Unknown feature flag: ${key}`);
  return definition;
}

/**
 * Parses an environment string. Only the exact strings `true`/`1`/`on` and
 * `false`/`0`/`off` are honoured; anything else (including an empty string,
 * which is what an unset Cloudflare Pages variable produces) falls through to
 * the coded default rather than being silently coerced.
 */
export function parseEnvFlag(raw: string | undefined): boolean | undefined {
  if (raw === undefined) return undefined;
  const value = raw.trim().toLowerCase();
  if (value === 'true' || value === '1' || value === 'on') return true;
  if (value === 'false' || value === '0' || value === 'off') return false;
  return undefined;
}
