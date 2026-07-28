import { cancelled } from '../../contracts/errors';
import type {
  AgentProvider,
  ProviderDescriptor,
  ProviderRequest,
  ProviderRunOptions,
  ProviderStreamEvent,
} from './types';
import { providerId } from './types';

/**
 * A deterministic, offline stand-in that never pretends to be a model.
 *
 * It exists so the run pipeline — events, streaming, cancellation, replay — can
 * be exercised without a credential or a download. Its output states what it is
 * on every turn, so a transcript can never be mistaken for model reasoning.
 */
export interface DemoProviderConfig {
  readonly id: string;
  readonly label: string;
  readonly modelId?: string;
}

const CHUNK_SIZE = 24;

export function createDemoProvider(config: DemoProviderConfig): AgentProvider {
  const modelId = config.modelId ?? 'deterministic-v1';
  const descriptor: ProviderDescriptor = Object.freeze({
    id: providerId(config.id),
    label: config.label,
    capabilities: Object.freeze({
      streaming: true,
      structuredToolCalls: false,
      cancellation: true,
      usage: true,
      localExecution: true,
      browser: Object.freeze({
        state: 'supported' as const,
        evidence: 'Runs in-page with no network access.',
      }),
    }),
    models: Object.freeze([{ id: modelId, label: 'Deterministic echo' }]),
  });

  return {
    descriptor,
    async *stream(
      request: ProviderRequest,
      options: ProviderRunOptions
    ): AsyncIterable<ProviderStreamEvent> {
      if (options.signal.aborted) throw cancelled('Demo provider');
      const prompt = request.messages.at(-1)?.content ?? '';
      const attached = request.messages
        .flatMap((message) => [...message.content.matchAll(/<file path="([^"]+)"/g)])
        .map((match) => match[1]);

      const text = [
        'Demo provider — this is not a language model and no reasoning happened.',
        '',
        `Your request: ${prompt.slice(0, 500)}`,
        attached.length
          ? `Workspace files placed in context (${attached.length}): ${attached.join(', ')}`
          : 'No workspace files were placed in context.',
        '',
        'Select a provider with a credential to get a real answer.',
      ].join('\n');

      for (let index = 0; index < text.length; index += CHUNK_SIZE) {
        if (options.signal.aborted) throw cancelled('Demo provider');
        yield { type: 'text_delta', text: text.slice(index, index + CHUNK_SIZE) };
      }

      yield {
        type: 'usage',
        usage: {
          inputTokens: Math.ceil(
            request.messages.reduce((total, message) => total + message.content.length, 0) / 4
          ),
          outputTokens: Math.ceil(text.length / 4),
          estimatedCostUsd: 0,
        },
      };
      yield { type: 'completed', finishReason: 'stop' };
    },
  };
}
