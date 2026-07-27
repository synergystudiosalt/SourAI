/// <reference types="vite/client" />

/**
 * Public build configuration.
 *
 * Everything declared here is statically inlined into the browser bundle by
 * Vite and is therefore READABLE BY ANYONE who loads the app. These are public
 * configuration values, not secrets. Provider API keys, OAuth client secrets,
 * Git tokens, signing keys, and encryption keys must never appear here — see
 * docs/adr/0005-credential-handling.md.
 */
interface ImportMetaEnv {
  /** Deployment environment label, e.g. `production` | `preview` | `development`. */
  readonly VITE_APP_ENV?: string;
  /** Git SHA of the build, surfaced in the UI and in bug reports. */
  readonly VITE_RELEASE_SHA?: string;

  /** Default provider id selected for a fresh install. */
  readonly VITE_DEFAULT_PROVIDER?: string;
  /** Default model id selected for a fresh install. */
  readonly VITE_DEFAULT_MODEL?: string;

  /** Feature flags. `'true'` enables; anything else leaves the coded default. */
  readonly VITE_ENABLE_WEBLLM?: string;
  readonly VITE_ENABLE_WEBCONTAINERS?: string;
  readonly VITE_ENABLE_PYODIDE?: string;
  readonly VITE_ENABLE_CLIENT_AGENT?: string;
  readonly VITE_ENABLE_OPFS_PROJECTS?: string;
  readonly VITE_ENABLE_LOCAL_FOLDER_PROJECTS?: string;
  readonly VITE_ENABLE_REMOTE_MCP?: string;
  readonly VITE_ENABLE_EDIT_PREDICTION?: string;
  readonly VITE_ENABLE_AUDIT_LOG?: string;
  readonly VITE_ENABLE_TELEMETRY?: string;
  /** Allows runtime flag overrides outside development builds. */
  readonly VITE_ALLOW_FLAG_OVERRIDES?: string;

  /** Comma-separated origin allowlists enforced before any outbound request. */
  readonly VITE_ALLOWED_PROVIDER_ORIGINS?: string;
  readonly VITE_ALLOWED_MCP_ORIGINS?: string;

  /** Public OAuth client id for a browser PKCE flow. Never a client secret. */
  readonly VITE_PUBLIC_GITHUB_CLIENT_ID?: string;
  /** Public Sentry DSN. Only used when telemetry consent has been granted. */
  readonly VITE_SENTRY_DSN?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
