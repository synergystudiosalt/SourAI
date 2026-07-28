import { SourError, cancelled } from '../../contracts/errors';
import type {
  AgentProvider,
  ProviderDescriptor,
  ProviderRequest,
  ProviderRunOptions,
  ProviderStreamEvent,
} from './types';
import { providerId } from './types';

export interface WebLlmCapability {
  readonly available: boolean;
  readonly reason?: string;
}

export interface WebLlmEngine {
  stream(request: ProviderRequest, signal: AbortSignal): AsyncIterable<ProviderStreamEvent>;
}

export interface WebLlmProviderConfig {
  readonly models: readonly { id: string; label: string }[];
  readonly probe?: () => WebLlmCapability;
  /** Dynamic import belongs in this callback, keeping WebLLM out of the initial bundle. */
  readonly loadEngine: () => Promise<WebLlmEngine>;
}

export function probeWebLlmCapability(): WebLlmCapability {
  if (typeof window !== 'undefined' && !window.isSecureContext) {
    return { available: false, reason: 'WebLLM requires a secure browser context.' };
  }
  if (typeof navigator === 'undefined' || !('gpu' in navigator)) {
    return { available: false, reason: 'This browser does not expose WebGPU.' };
  }
  return { available: true };
}

export function createWebLlmProvider(config: WebLlmProviderConfig): AgentProvider {
  const capability = (config.probe ?? probeWebLlmCapability)();
  const descriptor: ProviderDescriptor = Object.freeze({
    id: providerId('webllm'),
    label: 'WebLLM (local)',
    capabilities: Object.freeze({
      streaming: true,
      structuredToolCalls: true,
      cancellation: true,
      usage: true,
      localExecution: true,
      browser: capability.available
        ? Object.freeze({ state: 'supported' as const, evidence: 'WebGPU capability probe passed.' })
        : Object.freeze({
            state: 'unsupported' as const,
            reason: capability.reason ?? 'WebGPU is unavailable.',
          }),
    }),
    models: Object.freeze(config.models.map((model) => Object.freeze({ ...model }))),
  });

  return {
    descriptor,
    async *stream(request: ProviderRequest, options: ProviderRunOptions) {
      if (!capability.available) {
        throw new SourError({
          code: 'webllm_unsupported',
          message: 'WebLLM is unavailable in this browser.',
          causeCategory: 'unsupported',
          retryable: false,
          userAction: capability.reason,
        });
      }
      if (options.signal.aborted) throw cancelled('WebLLM stream');
      const engine = await config.loadEngine();
      for await (const event of engine.stream(request, options.signal)) {
        if (options.signal.aborted) throw cancelled('WebLLM stream');
        yield event;
      }
    },
  };
}

