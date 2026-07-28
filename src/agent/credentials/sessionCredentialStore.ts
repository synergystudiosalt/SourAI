import { registerSecret, unregisterSecret } from '../../security/redaction';
import type { ProviderId } from '../providers/types';

/**
 * Memory-only provider credentials. This class deliberately has no storage
 * dependency, serialization method, or event payload representation.
 */
export class SessionCredentialStore {
  readonly #credentials = new Map<ProviderId, string>();
  #disposed = false;
  #detachLifecycle?: () => void;

  set(provider: ProviderId, credential: string): void {
    this.#assertActive();
    if (!credential || !credential.trim()) throw new TypeError('Credential cannot be empty.');
    const prior = this.#credentials.get(provider);
    if (prior === credential) return;
    if (prior !== undefined) unregisterSecret(prior);
    this.#credentials.set(provider, credential);
    registerSecret(credential);
  }

  get(provider: ProviderId): string | undefined {
    this.#assertActive();
    return this.#credentials.get(provider);
  }

  has(provider: ProviderId): boolean {
    this.#assertActive();
    return this.#credentials.has(provider);
  }

  delete(provider: ProviderId): boolean {
    this.#assertActive();
    const value = this.#credentials.get(provider);
    if (value === undefined) return false;
    this.#credentials.delete(provider);
    unregisterSecret(value);
    return true;
  }

  clear(): void {
    for (const credential of this.#credentials.values()) unregisterSecret(credential);
    this.#credentials.clear();
  }

  /**
   * Clears credentials when the current page session ends. `pagehide` also
   * covers mobile tab eviction; a restored BFCache page must ask again.
   */
  attachPageLifecycle(target: Pick<Window, 'addEventListener' | 'removeEventListener'>): void {
    this.#assertActive();
    this.#detachLifecycle?.();
    const clear = () => this.clear();
    target.addEventListener('pagehide', clear);
    this.#detachLifecycle = () => target.removeEventListener('pagehide', clear);
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#detachLifecycle?.();
    this.#detachLifecycle = undefined;
    this.clear();
    this.#disposed = true;
  }

  #assertActive(): void {
    if (this.#disposed) throw new Error('Session credential store is disposed.');
  }
}

