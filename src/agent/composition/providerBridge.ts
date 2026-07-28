import type { RunMode } from '../../contracts/commands';
import { SourError } from '../../contracts/errors';
import type { ContextScope } from '../context/scope';
import type { WorkspaceSnapshotV1 } from '../context/snapshot';
import type { AgentProvider, ProviderTool } from '../providers/types';
import type { RuntimeProvider, RuntimeProviderChunk, RuntimeProviderRequest } from '../runtime/types';
import type { ToolDescriptor } from '../tools/types';
import { buildPromptMessages, withDestination, type EgressPlan } from './prompt';

/**
 * Adapts an `AgentProvider` to the runtime's chunk contract.
 *
 * This is the only place provider output becomes runtime state, so it is where
 * untrusted stream events are narrowed: an `error` event becomes a thrown
 * `SourError` rather than silent truncation, and a tool call is passed through
 * without interpretation for the tool layer to validate.
 */

/** The only parts of a tool descriptor a provider is ever shown. */
export type ProviderFacingTool = Pick<ToolDescriptor, 'name' | 'description' | 'inputSchema'>;

export interface RuntimeProviderBridgeOptions {
  readonly provider: AgentProvider;
  readonly modelId: string;
  readonly snapshot: WorkspaceSnapshotV1;
  readonly scope: ContextScope;
  /**
   * Tools offered to the provider, resolved per run mode.
   *
   * Ask and Plan are never shown a mutation tool, so the model is not invited
   * to attempt one; the policy check on execution remains the enforcement.
   */
  readonly tools: (mode: RunMode) => readonly ProviderFacingTool[];
  readonly contextPaths: readonly string[];
  /** Read at request time so a credential is never captured for longer than a turn. */
  readonly credential?: () => string | undefined;
  readonly maxOutputTokens?: number;
  readonly onPlan?: (plan: EgressPlan) => void;
}

export function describeDestination(provider: AgentProvider) {
  if (provider.descriptor.capabilities.localExecution) {
    return { kind: 'local' as const, label: 'this browser' };
  }
  const host = provider.descriptor.endpointHost;
  return {
    kind: 'remote' as const,
    ...(host ? { host } : {}),
    label: host ?? provider.descriptor.label,
  };
}

export function toProviderTools(tools: readonly ProviderFacingTool[]): readonly ProviderTool[] {
  return Object.freeze(
    tools
      .filter((tool) => tool.inputSchema !== undefined)
      .map((tool) =>
        Object.freeze({
          name: tool.name,
          description: tool.description,
          inputSchema: tool.inputSchema as unknown as Readonly<Record<string, unknown>>,
        })
      )
  );
}

export function createRuntimeProvider(options: RuntimeProviderBridgeOptions): RuntimeProvider {
  const { provider } = options;
  if (!provider.descriptor.models.some((model) => model.id === options.modelId)) {
    throw new SourError({
      code: 'provider_model_unknown',
      message: `Model "${options.modelId}" is not offered by ${provider.descriptor.label}.`,
      causeCategory: 'validation',
      retryable: false,
    });
  }
  const destination = describeDestination(provider);

  return {
    id: String(provider.descriptor.id),
    modelId: options.modelId,
    async *stream(request: RuntimeProviderRequest): AsyncIterable<RuntimeProviderChunk> {
      const tools = options.tools(request.input.mode);
      const providerTools = toProviderTools(tools);
      const built = buildPromptMessages({
        mode: request.input.mode,
        message: request.message,
        snapshot: options.snapshot,
        contextPaths: options.contextPaths,
        scope: options.scope,
        tools,
        previousAssistantMessages: request.previousAssistantMessages,
        ...(request.toolResults ? { toolResults: request.toolResults } : {}),
      });
      options.onPlan?.(withDestination(built.plan, destination));

      const credential = options.credential?.();
      const stream = provider.stream(
        {
          model: options.modelId,
          messages: built.messages,
          ...(providerTools.length ? { tools: providerTools } : {}),
          ...(options.maxOutputTokens === undefined
            ? {}
            : { maxOutputTokens: options.maxOutputTokens }),
        },
        {
          ...(credential === undefined ? {} : { credential }),
          signal: request.signal,
        }
      );

      for await (const event of stream) {
        switch (event.type) {
          case 'text_delta':
            if (event.text) yield { type: 'text.delta', delta: event.text };
            break;
          case 'tool_call':
            yield {
              type: 'tool.call',
              call: { id: event.call.id, name: event.call.name, arguments: event.call.arguments },
            };
            break;
          case 'usage':
            yield {
              type: 'usage',
              usage: {
                inputTokens: event.usage.inputTokens ?? 0,
                outputTokens: event.usage.outputTokens ?? 0,
                ...(event.usage.estimatedCostUsd === undefined
                  ? {}
                  : { estimatedCostUsd: event.usage.estimatedCostUsd }),
              },
            };
            break;
          case 'error':
            // The adapter already normalized and redacted this payload; rebuild
            // it as a thrown error so the run records the provider's own reason.
            throw new SourError({
              code: event.error.code || 'provider_stream_error',
              message: event.error.message || 'The provider reported a stream error.',
              causeCategory: event.error.causeCategory ?? 'provider',
              retryable: event.error.retryable === true,
              ...(event.error.userAction ? { userAction: event.error.userAction } : {}),
            });
          case 'completed':
            return;
        }
      }
    },
  };
}
