import { describe, expect, it } from 'vitest';

import {
  DEMO_PROVIDER_ID,
  PROVIDER_CATALOG,
  createProviderFromCatalog,
  findCatalogEntry,
} from './catalog';

describe('provider catalog', () => {
  it('offers the demo provider only under a label that says it is not a model', () => {
    const demo = findCatalogEntry(DEMO_PROVIDER_ID);
    expect(demo?.label).toMatch(/not a model/i);
    expect(demo?.kind).toBe('demo');
    // It is never the first entry, so a "pick the first provider" default
    // cannot land on it.
    expect(PROVIDER_CATALOG[0].id).not.toBe(DEMO_PROVIDER_ID);
  });

  it('builds the demo provider only when asked for by name', () => {
    const provider = createProviderFromCatalog({ providerId: DEMO_PROVIDER_ID });
    expect(String(provider.descriptor.id)).toBe(DEMO_PROVIDER_ID);
    expect(provider.descriptor.capabilities.localExecution).toBe(true);
  });

  it('refuses an unknown provider rather than substituting one', () => {
    expect(() => createProviderFromCatalog({ providerId: 'ghost' })).toThrowError(
      /not part of this build/
    );
  });

  it('discloses the destination host for BYOK providers', () => {
    const provider = createProviderFromCatalog({ providerId: 'openrouter' });
    expect(provider.descriptor.endpointHost).toBe('openrouter.ai');
    expect(provider.descriptor.capabilities.localExecution).toBe(false);
  });

  it('will not build a custom endpoint without recorded consent', () => {
    expect(() => createProviderFromCatalog({ providerId: 'openai-compatible' })).toThrowError(
      /approval of its destination host/
    );
  });

  it('rejects consent that does not match the endpoint it approves', () => {
    expect(() =>
      createProviderFromCatalog({
        providerId: 'openai-compatible',
        consent: {
          endpoint: 'https://real.example/v1/chat/completions',
          host: 'trusted.example',
          modelId: 'm',
          grantedAt: 0,
        },
      })
    ).toThrowError(/does not match/);
  });

  it('builds a consented custom endpoint that names its host', () => {
    const provider = createProviderFromCatalog({
      providerId: 'openai-compatible',
      consent: {
        endpoint: 'https://models.example/v1/chat/completions',
        host: 'models.example',
        modelId: 'my-model',
        grantedAt: 0,
      },
    });
    expect(provider.descriptor.endpointHost).toBe('models.example');
    expect(provider.descriptor.label).toContain('models.example');
  });

  it('reports WebLLM as unavailable rather than pretending it can run', () => {
    const provider = createProviderFromCatalog({ providerId: 'webllm' });
    expect(provider.descriptor.capabilities.browser.state).toBe('unsupported');
  });
});
