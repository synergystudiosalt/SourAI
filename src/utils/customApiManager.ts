/**
 * Manages custom API configurations for external providers.
 * Stores and retrieves API keys securely in localStorage.
 */

export type CustomApiProvider = 'groq' | 'gemini' | 'claude' | 'openai';

export interface CustomApiConfig {
  id: string;
  provider: CustomApiProvider;
  apiKey: string;
  modelName: string;
  createdAt: number;
}

const STORAGE_KEY = 'sour_custom_apis';

export const customApiManager = {
  /**
   * Get all stored custom API configurations
   */
  getConfigs(): CustomApiConfig[] {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      return stored ? JSON.parse(stored) : [];
    } catch {
      return [];
    }
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
    const configs = this.getConfigs();
    const config: CustomApiConfig = {
      id: `${provider}_${Date.now()}`,
      provider,
      apiKey,
      modelName,
      createdAt: Date.now(),
    };
    configs.push(config);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(configs));
    return config;
  },

  /**
   * Update an existing custom API configuration
   */
  updateConfig(id: string, apiKey: string, modelName: string): CustomApiConfig | null {
    const configs = this.getConfigs();
    const index = configs.findIndex((c) => c.id === id);
    if (index === -1) return null;
    
    configs[index] = { ...configs[index], apiKey, modelName };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(configs));
    return configs[index];
  },

  /**
   * Delete a custom API configuration
   */
  deleteConfig(id: string): boolean {
    const configs = this.getConfigs();
    const filtered = configs.filter((c) => c.id !== id);
    if (filtered.length === configs.length) return false;
    
    localStorage.setItem(STORAGE_KEY, JSON.stringify(filtered));
    return true;
  },

  /**
   * Get configs by provider type
   */
  getConfigsByProvider(provider: CustomApiProvider): CustomApiConfig[] {
    return this.getConfigs().filter((c) => c.provider === provider);
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
