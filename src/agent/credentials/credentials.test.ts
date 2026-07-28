import { webcrypto } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { redactString } from '../../security/redaction';
import { providerId } from '../providers/types';
import {
  EncryptedCredentialVault,
  InMemoryCredentialVaultStorage,
  grantVaultConsent,
  type CredentialVaultStorage,
  type EncryptedCredentialRecord,
} from './encryptedVault';
import { SessionCredentialStore } from './sessionCredentialStore';

describe('SessionCredentialStore', () => {
  it('keeps credentials only in memory and registers them for redaction', () => {
    const provider = providerId('example');
    const secret = 'short nonstandard credential';
    const store = new SessionCredentialStore();

    store.set(provider, secret);
    expect(store.get(provider)).toBe(secret);
    expect(redactString(`failure: ${secret}`)).toBe('failure: [redacted]');

    store.delete(provider);
    expect(store.get(provider)).toBeUndefined();
    expect(redactString(`failure: ${secret}`)).toBe(`failure: ${secret}`);
  });

  it('clears credentials at page-session end', () => {
    const listeners = new Map<string, EventListener>();
    const target = {
      addEventListener(type: string, listener: EventListenerOrEventListenerObject) {
        if (typeof listener === 'function') listeners.set(type, listener);
      },
      removeEventListener(type: string) {
        listeners.delete(type);
      },
    } as Pick<Window, 'addEventListener' | 'removeEventListener'>;
    const store = new SessionCredentialStore();
    const provider = providerId('example');
    store.set(provider, 'ephemeral');
    store.attachPageLifecycle(target);

    listeners.get('pagehide')?.(new Event('pagehide'));

    expect(store.get(provider)).toBeUndefined();
  });
});

describe('EncryptedCredentialVault', () => {
  const crypto = webcrypto as unknown as Crypto;

  it('persists ciphertext metadata only and unlocks into the session store', async () => {
    const provider = providerId('example');
    const credential = 'vault-credential-canary';
    const passphrase = 'correct horse battery staple';
    const baseStorage = new InMemoryCredentialVaultStorage();
    let written: EncryptedCredentialRecord | undefined;
    const storage: CredentialVaultStorage = {
      async put(record) {
        written = structuredClone(record);
        await baseStorage.put(record);
      },
      get: (id) => baseStorage.get(id),
      delete: (id) => baseStorage.delete(id),
      clear: () => baseStorage.clear(),
    };
    const firstSession = new SessionCredentialStore();
    const vault = new EncryptedCredentialVault({
      storage,
      session: firstSession,
      crypto,
      consent: grantVaultConsent(),
    });

    await vault.store(provider, credential, passphrase);

    expect(firstSession.get(provider)).toBe(credential);
    expect(JSON.stringify(written)).not.toContain(credential);
    expect(JSON.stringify(written)).not.toContain(passphrase);
    expect(written).not.toHaveProperty('key');
    expect(written?.ciphertext).toBeTruthy();

    firstSession.dispose();
    const restoredSession = new SessionCredentialStore();
    const restoredVault = new EncryptedCredentialVault({
      storage,
      session: restoredSession,
      crypto,
      consent: grantVaultConsent(),
    });
    await restoredVault.unlock(provider, passphrase);
    expect(restoredSession.get(provider)).toBe(credential);
  });

  it('rejects an incorrect passphrase without putting plaintext in errors', async () => {
    const provider = providerId('example');
    const storage = new InMemoryCredentialVaultStorage();
    const session = new SessionCredentialStore();
    const vault = new EncryptedCredentialVault({
      storage,
      session,
      crypto,
      consent: grantVaultConsent(),
    });
    await vault.store(provider, 'credential-value', 'right-passphrase');

    let error: unknown;
    try {
      await vault.unlock(provider, 'wrong-passphrase');
    } catch (caught) {
      error = caught;
    }

    expect(session.get(provider)).toBe('credential-value');
    expect(JSON.stringify(error)).not.toContain('wrong-passphrase');
    expect(JSON.stringify(error)).not.toContain('credential-value');
  });
});

