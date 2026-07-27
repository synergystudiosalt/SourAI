import { afterEach, describe, expect, it } from 'vitest';

import { containsSecret } from '../security/redaction';
import { customApiManager } from './customApiManager';

afterEach(() => {
  customApiManager.clearSessionCredentials();
  localStorage.clear();
});

describe('customApiManager credential storage', () => {
  it('keeps a newly added API key in memory and persists metadata only', () => {
    const secret = 'session-only-provider-secret-123';
    const added = customApiManager.addConfig('openai', secret, 'gpt-test');

    expect(added.apiKey).toBe(secret);
    expect(customApiManager.getConfig(added.id)?.apiKey).toBe(secret);
    expect(localStorage.getItem('sour_custom_apis')).not.toContain(secret);
    expect(JSON.parse(localStorage.getItem('sour_custom_apis') ?? '[]')).toEqual([
      {
        id: added.id,
        provider: 'openai',
        modelName: 'gpt-test',
        createdAt: added.createdAt,
      },
    ]);
    expect(containsSecret(`request used ${secret}`)).toBe(true);
  });

  it('purges a legacy plaintext key while retaining it for the current session', () => {
    const secret = 'legacy-plaintext-provider-secret-456';
    localStorage.setItem(
      'sour_custom_apis',
      JSON.stringify([
        {
          id: 'legacy-1',
          provider: 'groq',
          apiKey: secret,
          modelName: 'legacy-model',
          createdAt: 123,
        },
      ])
    );

    expect(customApiManager.getConfig('legacy-1')?.apiKey).toBe(secret);
    expect(localStorage.getItem('sour_custom_apis')).not.toContain(secret);

    customApiManager.clearSessionCredentials();
    expect(customApiManager.getConfig('legacy-1')).toMatchObject({ apiKey: '', modelName: 'legacy-model' });
  });

  it('never writes an updated key and removes its session copy on delete', () => {
    const added = customApiManager.addConfig('gemini', 'initial-secret-123', 'model-a');
    const updated = customApiManager.updateConfig(added.id, 'replacement-secret-456', 'model-b');

    expect(updated).toMatchObject({ apiKey: 'replacement-secret-456', modelName: 'model-b' });
    expect(localStorage.getItem('sour_custom_apis')).not.toContain('replacement-secret-456');
    expect(customApiManager.deleteConfig(added.id)).toBe(true);
    expect(customApiManager.getConfig(added.id)).toBeNull();
  });

  it('keeps a shared provider key redacted while another config still owns it', () => {
    const secret = 'shared-session-provider-secret-321';
    const first = customApiManager.addConfig('openai', secret, 'model-a');
    const second = customApiManager.addConfig('groq', secret, 'model-b');

    expect(second.id).not.toBe(first.id);
    expect(customApiManager.deleteConfig(first.id)).toBe(true);
    expect(customApiManager.getConfig(second.id)?.apiKey).toBe(secret);
    expect(containsSecret(secret)).toBe(true);
  });

  it('removes a corrupt legacy payload that could still contain a key', () => {
    localStorage.setItem('sour_custom_apis', '[{"apiKey":"truncated-secret-789"');

    expect(customApiManager.getConfigs()).toEqual([]);
    expect(localStorage.getItem('sour_custom_apis')).toBeNull();
  });
});
