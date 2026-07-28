import { SourError } from '../../contracts/errors';
import { createBrowserFetchProvider } from './browserFetchProvider';
import { createDemoProvider } from './demoProvider';
import { createWebLlmProvider, probeWebLlmCapability } from './webLlmProvider';
import type { AgentProvider, BrowserProviderSupport } from './types';

/**
 * The providers this build knows how to construct.
 *
 * A catalog entry is a *description*, not a promise that the provider works:
 * `browserSupport` records what has actually been verified for direct browser
 * calls. Anything unverified is offered as `unknown` and refuses to run until
 * the user takes explicit responsibility for the endpoint.
 */

export type ProviderKind = 'local' | 'byok' | 'custom' | 'demo';

export interface ProviderCatalogEntry {
  readonly id: string;
  readonly label: string;
  readonly kind: ProviderKind;
  readonly endpoint?: string;
  readonly host?: string;
  readonly models: readonly { readonly id: string; readonly label: string }[];
  readonly browserSupport: BrowserProviderSupport;
  readonly requiresCredential: boolean;
  readonly documentation?: string;
  /** Shown in the UI when the entry cannot be selected as-is. */
  readonly notice?: string;
}

export const DEMO_PROVIDER_ID = 'demo-echo';

export const PROVIDER_CATALOG: readonly ProviderCatalogEntry[] = Object.freeze([
  {
    id: 'openrouter',
    label: 'OpenRouter',
    kind: 'byok',
    endpoint: 'https://openrouter.ai/api/v1/chat/completions',
    host: 'openrouter.ai',
    models: Object.freeze([
      { id: 'anthropic/claude-sonnet-4.5', label: 'Claude Sonnet 4.5' },
      { id: 'openai/gpt-4.1-mini', label: 'GPT-4.1 mini' },
      { id: 'meta-llama/llama-3.3-70b-instruct', label: 'Llama 3.3 70B Instruct' },
    ]),
    browserSupport: Object.freeze({
      state: 'supported',
      evidence: 'OpenRouter documents browser clients calling the API directly with CORS.',
    }),
    requiresCredential: true,
    documentation: 'https://openrouter.ai/docs',
  },
  {
    id: 'openai-compatible',
    label: 'Custom OpenAI-compatible endpoint',
    kind: 'custom',
    models: Object.freeze([]),
    browserSupport: Object.freeze({
      state: 'unknown',
      reason: 'Browser CORS support depends on the endpoint you configure.',
    }),
    requiresCredential: true,
    notice:
      'You disclose and approve the destination host before the first request. Your prompt and selected files are sent there.',
  },
  {
    id: 'webllm',
    label: 'WebLLM (on-device)',
    kind: 'local',
    models: Object.freeze([{ id: 'Llama-3.2-3B-Instruct-q4f16_1-MLC', label: 'Llama 3.2 3B Instruct' }]),
    browserSupport: Object.freeze({
      state: 'unsupported',
      reason: 'The WebLLM engine package is not installed in this build.',
    }),
    requiresCredential: false,
    notice: 'On-device inference is not available until the WebLLM engine is added to the build.',
  },
  {
    id: DEMO_PROVIDER_ID,
    label: 'Demo — deterministic echo (not a model)',
    kind: 'demo',
    models: Object.freeze([{ id: 'deterministic-v1', label: 'Deterministic echo' }]),
    browserSupport: Object.freeze({ state: 'supported', evidence: 'Runs locally with no network access.' }),
    requiresCredential: false,
    notice: 'Echoes structured text so the run pipeline can be exercised. It does not reason about your code.',
  },
]);

export function findCatalogEntry(id: string): ProviderCatalogEntry | undefined {
  return PROVIDER_CATALOG.find((entry) => entry.id === id);
}

export interface CustomEndpointConsent {
  readonly endpoint: string;
  readonly host: string;
  readonly modelId: string;
  readonly grantedAt: number;
}

export interface CreateProviderOptions {
  readonly providerId: string;
  /** Required for the custom entry; the user must have approved this host. */
  readonly consent?: CustomEndpointConsent;
  readonly fetch?: typeof fetch;
}

/**
 * Builds a provider instance. The deterministic demo provider is only returned
 * when it is asked for by name, so it can never stand in for a real one.
 */
export function createProviderFromCatalog(options: CreateProviderOptions): AgentProvider {
  const entry = findCatalogEntry(options.providerId);
  if (!entry) {
    throw new SourError({
      code: 'provider_not_in_catalog',
      message: `Provider "${options.providerId}" is not part of this build.`,
      causeCategory: 'validation',
      retryable: false,
    });
  }

  if (entry.kind === 'demo') {
    return createDemoProvider({ id: entry.id, label: entry.label, modelId: entry.models[0].id });
  }

  if (entry.kind === 'local') {
    return createWebLlmProvider({
      models: entry.models,
      probe: () => {
        const capability = probeWebLlmCapability();
        if (!capability.available) return capability;
        return {
          available: false,
          reason: 'The WebLLM engine package is not installed in this build.',
        };
      },
      loadEngine: () => {
        throw new SourError({
          code: 'webllm_engine_missing',
          message: 'The WebLLM engine is not bundled in this build.',
          causeCategory: 'unsupported',
          retryable: false,
          userAction: 'Use a BYOK provider, or add the WebLLM engine to the build.',
        });
      },
    });
  }

  if (entry.kind === 'custom') {
    const consent = options.consent;
    if (!consent) {
      throw new SourError({
        code: 'provider_consent_required',
        message: 'A custom endpoint needs explicit approval of its destination host first.',
        causeCategory: 'policy',
        retryable: false,
        userAction: 'Approve the endpoint host before running.',
      });
    }
    const host = new URL(consent.endpoint).host;
    if (host !== consent.host) {
      throw new SourError({
        code: 'provider_consent_mismatch',
        message: 'The approved host does not match the configured endpoint.',
        causeCategory: 'policy',
        retryable: false,
      });
    }
    return createBrowserFetchProvider({
      id: entry.id,
      label: `${entry.label} (${host})`,
      endpoint: consent.endpoint,
      models: [{ id: consent.modelId, label: consent.modelId }],
      browserSupport: {
        state: 'supported',
        evidence: `The user approved direct browser requests to ${host}.`,
      },
      ...(options.fetch ? { fetch: options.fetch } : {}),
    });
  }

  return createBrowserFetchProvider({
    id: entry.id,
    label: entry.label,
    endpoint: entry.endpoint!,
    models: entry.models,
    browserSupport: entry.browserSupport,
    ...(options.fetch ? { fetch: options.fetch } : {}),
  });
}
