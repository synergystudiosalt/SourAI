import { SourError } from '../../contracts/errors';
import { registerSecret, unregisterSecret } from '../../security/redaction';
import type { ProviderId } from '../providers/types';
import { SessionCredentialStore } from './sessionCredentialStore';

const VAULT_VERSION = 1;
const PBKDF2_ITERATIONS = 310_000;
const encoder = new TextEncoder();
const decoder = new TextDecoder();

export interface EncryptedCredentialRecord {
  readonly version: 1;
  readonly providerId: string;
  readonly algorithm: 'AES-GCM';
  readonly keyDerivation: 'PBKDF2-SHA-256';
  readonly iterations: number;
  readonly salt: string;
  readonly iv: string;
  readonly ciphertext: string;
  readonly createdAt: number;
}

/** Ciphertext persistence boundary. Implementations must not accept CryptoKey. */
export interface CredentialVaultStorage {
  put(record: EncryptedCredentialRecord): Promise<void>;
  get(providerId: string): Promise<EncryptedCredentialRecord | undefined>;
  delete(providerId: string): Promise<void>;
  clear(): Promise<void>;
}

export interface VaultConsent {
  readonly version: 1;
  readonly granted: true;
  readonly grantedAt: number;
}

export function grantVaultConsent(): VaultConsent {
  return Object.freeze({ version: 1, granted: true, grantedAt: Date.now() });
}

export class EncryptedCredentialVault {
  readonly #storage: CredentialVaultStorage;
  readonly #session: SessionCredentialStore;
  readonly #crypto: Crypto;
  readonly #consent: VaultConsent;

  constructor(options: {
    storage: CredentialVaultStorage;
    session: SessionCredentialStore;
    crypto?: Crypto;
    consent: VaultConsent;
  }) {
    if (options.consent.version !== 1 || options.consent.granted !== true) {
      throw new SourError({
        code: 'vault_consent_required',
        message: 'Encrypted credential storage requires explicit consent.',
        causeCategory: 'policy',
        retryable: false,
      });
    }
    this.#storage = options.storage;
    this.#session = options.session;
    this.#crypto = options.crypto ?? globalThis.crypto;
    this.#consent = options.consent;
    if (!this.#crypto?.subtle) {
      throw new SourError({
        code: 'vault_crypto_unavailable',
        message: 'Encrypted credential storage is unavailable in this browser.',
        causeCategory: 'unsupported',
        retryable: false,
      });
    }
  }

  get consent(): VaultConsent {
    return this.#consent;
  }

  async store(provider: ProviderId, credential: string, userSecret: string): Promise<void> {
    assertSecret(credential, 'Credential');
    assertSecret(userSecret, 'Vault passphrase');
    registerSecret(credential);
    registerSecret(userSecret);
    try {
      const salt = this.#random(16);
      const iv = this.#random(12);
      const key = await deriveKey(this.#crypto.subtle, userSecret, salt, PBKDF2_ITERATIONS, [
        'encrypt',
      ]);
      const ciphertext = await this.#crypto.subtle.encrypt(
        {
          name: 'AES-GCM',
          iv,
          additionalData: vaultAdditionalData(provider, PBKDF2_ITERATIONS),
        },
        key,
        encoder.encode(credential)
      );
      await this.#storage.put(
        Object.freeze({
          version: VAULT_VERSION,
          providerId: provider,
          algorithm: 'AES-GCM',
          keyDerivation: 'PBKDF2-SHA-256',
          iterations: PBKDF2_ITERATIONS,
          salt: toBase64(salt),
          iv: toBase64(iv),
          ciphertext: toBase64(new Uint8Array(ciphertext)),
          createdAt: Date.now(),
        })
      );
      this.#session.set(provider, credential);
    } finally {
      unregisterSecret(userSecret);
      unregisterSecret(credential);
    }
  }

  async unlock(provider: ProviderId, userSecret: string): Promise<void> {
    assertSecret(userSecret, 'Vault passphrase');
    registerSecret(userSecret);
    try {
      const record = await this.#storage.get(provider);
      if (!record) {
        throw new SourError({
          code: 'vault_entry_not_found',
          message: `No encrypted credential exists for provider "${provider}".`,
          causeCategory: 'storage',
          retryable: false,
        });
      }
      validateRecord(record, provider);
      const salt = fromBase64(record.salt);
      const iv = fromBase64(record.iv);
      const key = await deriveKey(
        this.#crypto.subtle,
        userSecret,
        salt,
        record.iterations,
        ['decrypt']
      );
      let plaintext: ArrayBuffer;
      try {
        plaintext = await this.#crypto.subtle.decrypt(
          {
            name: 'AES-GCM',
            iv,
            additionalData: vaultAdditionalData(provider, record.iterations),
          },
          key,
          fromBase64(record.ciphertext)
        );
      } catch (cause) {
        throw new SourError({
          code: 'vault_unlock_failed',
          message: 'The vault passphrase is incorrect or the encrypted entry is damaged.',
          causeCategory: 'storage',
          retryable: false,
          cause,
        });
      }
      const credential = decoder.decode(plaintext);
      try {
        assertSecret(credential, 'Decrypted credential');
        this.#session.set(provider, credential);
      } finally {
        new Uint8Array(plaintext).fill(0);
      }
    } finally {
      unregisterSecret(userSecret);
    }
  }

  async delete(provider: ProviderId): Promise<void> {
    this.#session.delete(provider);
    await this.#storage.delete(provider);
  }

  async clear(): Promise<void> {
    this.#session.clear();
    await this.#storage.clear();
  }

  #random(length: number): Uint8Array {
    return this.#crypto.getRandomValues(new Uint8Array(length));
  }
}

export class InMemoryCredentialVaultStorage implements CredentialVaultStorage {
  readonly #records = new Map<string, EncryptedCredentialRecord>();

  async put(record: EncryptedCredentialRecord): Promise<void> {
    this.#records.set(record.providerId, structuredClone(record));
  }

  async get(providerId: string): Promise<EncryptedCredentialRecord | undefined> {
    const record = this.#records.get(providerId);
    return record ? structuredClone(record) : undefined;
  }

  async delete(providerId: string): Promise<void> {
    this.#records.delete(providerId);
  }

  async clear(): Promise<void> {
    this.#records.clear();
  }
}

async function deriveKey(
  subtle: SubtleCrypto,
  userSecret: string,
  salt: Uint8Array,
  iterations: number,
  usages: KeyUsage[]
): Promise<CryptoKey> {
  const material = await subtle.importKey('raw', encoder.encode(userSecret), 'PBKDF2', false, [
    'deriveKey',
  ]);
  return subtle.deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    usages
  );
}

function validateRecord(record: EncryptedCredentialRecord, provider: ProviderId): void {
  const valid =
    record.version === 1 &&
    record.providerId === provider &&
    record.algorithm === 'AES-GCM' &&
    record.keyDerivation === 'PBKDF2-SHA-256' &&
    Number.isSafeInteger(record.iterations) &&
    record.iterations >= 100_000 &&
    record.iterations <= 2_000_000 &&
    fromBase64(record.salt).byteLength === 16 &&
    fromBase64(record.iv).byteLength === 12 &&
    fromBase64(record.ciphertext).byteLength > 16;
  if (!valid) {
    throw new SourError({
      code: 'vault_record_invalid',
      message: 'The encrypted credential record is invalid.',
      causeCategory: 'validation',
      retryable: false,
    });
  }
}

function assertSecret(value: string, label: string): void {
  if (!value || !value.trim()) throw new TypeError(`${label} cannot be empty.`);
}

function vaultAdditionalData(provider: ProviderId, iterations: number): Uint8Array {
  return encoder.encode(
    JSON.stringify({
      version: VAULT_VERSION,
      providerId: provider,
      algorithm: 'AES-GCM',
      keyDerivation: 'PBKDF2-SHA-256',
      iterations,
    })
  );
}

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function fromBase64(value: string): Uint8Array {
  try {
    const binary = atob(value);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    return bytes;
  } catch {
    return new Uint8Array();
  }
}
