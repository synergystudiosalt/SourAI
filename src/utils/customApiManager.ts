/**
 * Manages custom API configurations for external providers.
 *
 * Provider metadata may be persisted, but credentials are session-only. Older
 * builds wrote `apiKey` into localStorage; reading that format migrates the key
 * into memory for the current tab and immediately rewrites the stored value
 * without the credential.
 */

import { registerSecret, unregisterSecret } from '../security/redaction';

export type CustomApiProvider = 'groq' | 'gemini' | 'claude' | 'openai';

export interface CustomApiConfig {
  id: string;
  provider: CustomApiProvider;
  apiKey: string;
  modelName: string;
  createdAt: number;
}

const STORAGE_KEY = 'sour_custom_apis';
const PROVIDERS: ReadonlySet<string> = new Set(['groq', 'gemini', 'claude', 'openai']);
const sessionKeys = new Map<string, string>();

type StoredCustomApiConfig = Omit<CustomApiConfig, 'apiKey'>;

function isStoredConfig(value: unknown): value is StoredCustomApiConfig {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const candidate = value as Partial<StoredCustomApiConfig>;
  return (
    typeof candidate.id === 'string' &&
    PROVIDERS.has(candidate.provider ?? '') &&
    typeof candidate.modelName === 'string' &&
    typeof candidate.createdAt === 'number' &&
    Number.isFinite(candidate.createdAt)
  );
}

function persistMetadata(configs: readonly StoredCustomApiConfig[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(configs));
}

function readMetadata(): StoredCustomApiConfig[] {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) return [];

    const parsed: unknown = JSON.parse(stored);
    if (!Array.isArray(parsed)) {
      localStorage.removeItem(STORAGE_KEY);
      return [];
    }

    let needsRewrite = false;
    const metadata: StoredCustomApiConfig[] = [];
    for (const value of parsed) {
      if (!isStoredConfig(value)) {
        needsRewrite = true;
        continue;
      }

      const legacy = value as StoredCustomApiConfig & { apiKey?: unknown };
      if (typeof legacy.apiKey === 'string' && legacy.apiKey.length > 0) {
        if (!sessionKeys.has(legacy.id)) {
          sessionKeys.set(legacy.id, legacy.apiKey);
          registerSecret(legacy.apiKey);
        }
        needsRewrite = true;
      } else if ('apiKey' in legacy) {
        needsRewrite = true;
      }

      metadata.push({
        id: legacy.id,
        provider: legacy.provider,
        modelName: legacy.modelName,
        createdAt: legacy.createdAt,
      });
    }

    if (needsRewrite) persistMetadata(metadata);
    return metadata;
  } catch {
    // A malformed legacy payload may still contain a plaintext key. Remove it
    // even when it cannot be parsed well enough to migrate.
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      // Storage is unavailable; there is no writable cleanup path.
    }
    return [];
  }
}

function withSessionKey(config: StoredCustomApiConfig): CustomApiConfig {
  return { ...config, apiKey: sessionKeys.get(config.id) ?? '' };
}

function replaceSessionKey(id: string, apiKey: string): void {
  const previous = sessionKeys.get(id);
  if (previous) unregisterSecret(previous);
  sessionKeys.set(id, apiKey);
  registerSecret(apiKey);
}

function createConfigId(provider: CustomApiProvider): string {
  const unique =
    typeof globalThis.crypto?.randomUUID === 'function'
      ? globalThis.crypto.randomUUID()
      : `${Date.now()}_${Math.random().toString(36).slice(2)}`;
  return `${provider}_${unique}`;
}

export const customApiManager = {
  /**
   * Get all stored custom API configurations
   */
  getConfigs(): CustomApiConfig[] {
    return readMetadata().map(withSessionKey);
  },

  /**
   * Get a specific custom API configuration by ID
   */
  getConfig(id: string): CustomApiConfig | null {
    const configs = this.getConfigs();
    return configs.find((c) => c.id === id) || null;
  },

  /**
   * Add a new custom API configuration
   */
  addConfig(provider: CustomApiProvider, apiKey: string, modelName: string): CustomApiConfig {
    const metadata = readMetadata();
    const storedConfig: StoredCustomApiConfig = {
      id: createConfigId(provider),
      provider,
      modelName,
      createdAt: Date.now(),
    };
    replaceSessionKey(storedConfig.id, apiKey);
    metadata.push(storedConfig);
    persistMetadata(metadata);
    return withSessionKey(storedConfig);
  },

  /**
   * Update an existing custom API configuration
   */
  updateConfig(id: string, apiKey: string, modelName: string): CustomApiConfig | null {
    const metadata = readMetadata();
    const index = metadata.findIndex((c) => c.id === id);
    if (index === -1) return null;

    metadata[index] = { ...metadata[index], modelName };
    replaceSessionKey(id, apiKey);
    persistMetadata(metadata);
    return withSessionKey(metadata[index]);
  },

  /**
   * Delete a custom API configuration
   */
  deleteConfig(id: string): boolean {
    const metadata = readMetadata();
    const filtered = metadata.filter((c) => c.id !== id);
    if (filtered.length === metadata.length) return false;

    const key = sessionKeys.get(id);
    if (key) unregisterSecret(key);
    sessionKeys.delete(id);
    persistMetadata(filtered);
    return true;
  },

  /**
   * Get configs by provider type
   */
  getConfigsByProvider(provider: CustomApiProvider): CustomApiConfig[] {
    return this.getConfigs().filter((c) => c.provider === provider);
  },

  /** Locks every session credential without deleting non-secret metadata. */
  clearSessionCredentials(): void {
    for (const key of sessionKeys.values()) unregisterSecret(key);
    sessionKeys.clear();
  },
};

export const PROVIDER_LABELS: Record<CustomApiProvider, string> = {
  'groq': 'Groq',
  'gemini': 'Google Gemini',
  'claude': 'Claude (Anthropic)',
  'openai': 'OpenAI',
};

export const PROVIDER_PLACEHOLDERS: Record<CustomApiProvider, string> = {
  'groq': 'gsk_...',
  'gemini': 'AIza...',
  'claude': 'sk-ant-...',
  'openai': 'sk-...',
};
