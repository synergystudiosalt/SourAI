import { SourError } from '../../contracts/errors';
import type { AgentProvider, ProviderDescriptor, ProviderId } from './types';

export class ProviderRegistry {
  readonly #providers = new Map<ProviderId, AgentProvider>();

  register(provider: AgentProvider): () => void {
    const id = provider.descriptor.id;
    if (this.#providers.has(id)) {
      throw new SourError({
        code: 'duplicate_provider',
        message: `Provider "${id}" is already registered.`,
        causeCategory: 'validation',
        retryable: false,
      });
    }
    this.#providers.set(id, provider);
    return () => {
      if (this.#providers.get(id) === provider) this.#providers.delete(id);
    };
  }

  get(id: ProviderId): AgentProvider {
    const provider = this.#providers.get(id);
    if (!provider) {
      throw new SourError({
        code: 'provider_not_found',
        message: `Provider "${id}" is not registered.`,
        causeCategory: 'provider',
        retryable: false,
      });
    }
    return provider;
  }

  has(id: ProviderId): boolean {
    return this.#providers.has(id);
  }

  list(): readonly ProviderDescriptor[] {
    return Object.freeze(
      [...this.#providers.values()]
        .map((provider) => provider.descriptor)
        .sort((a, b) => a.label.localeCompare(b.label))
    );
  }
}

