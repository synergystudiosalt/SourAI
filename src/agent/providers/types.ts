import type { SourErrorData } from '../../contracts/errors';

export type ProviderId = string & { readonly __providerId: unique symbol };

export type BrowserProviderSupport =
  | Readonly<{ state: 'supported'; evidence: string }>
  | Readonly<{ state: 'unsupported'; reason: string }>
  | Readonly<{ state: 'unknown'; reason: string }>;

export interface ProviderCapabilities {
  readonly streaming: boolean;
  readonly structuredToolCalls: boolean;
  readonly cancellation: boolean;
  readonly usage: boolean;
  readonly localExecution: boolean;
  readonly browser: BrowserProviderSupport;
}

export interface ProviderModel {
  readonly id: string;
  readonly label: string;
  readonly contextWindow?: number;
  readonly maxOutputTokens?: number;
}

export interface ProviderDescriptor {
  readonly id: ProviderId;
  readonly label: string;
  readonly capabilities: ProviderCapabilities;
  readonly models: readonly ProviderModel[];
  /**
   * Hostname a request would be sent to, for disclosure before egress.
   * Absent for providers that execute locally.
   */
  readonly endpointHost?: string;
}

export type ProviderRole = 'system' | 'user' | 'assistant' | 'tool';

export interface ProviderMessage {
  readonly role: ProviderRole;
  readonly content: string;
  readonly name?: string;
  readonly toolCallId?: string;
}

export interface ProviderTool {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: Readonly<Record<string, unknown>>;
}

export interface ProviderRequest {
  readonly model: string;
  readonly messages: readonly ProviderMessage[];
  readonly tools?: readonly ProviderTool[];
  readonly maxOutputTokens?: number;
  readonly temperature?: number;
}

export interface ProviderUsage {
  readonly inputTokens?: number;
  readonly outputTokens?: number;
  readonly totalTokens?: number;
  readonly estimatedCostUsd?: number;
}

export interface ProviderToolCall {
  readonly id: string;
  readonly name: string;
  readonly arguments: unknown;
}

export type ProviderStreamEvent =
  | Readonly<{ type: 'text_delta'; text: string }>
  | Readonly<{ type: 'tool_call'; call: ProviderToolCall }>
  | Readonly<{ type: 'usage'; usage: ProviderUsage }>
  | Readonly<{ type: 'completed'; finishReason: 'stop' | 'length' | 'tool_calls' | 'other' }>
  | Readonly<{ type: 'error'; error: SourErrorData }>;

export interface ProviderRunOptions {
  /** Ephemeral BYOK value. Adapters must never copy it into emitted events. */
  readonly credential?: string;
  readonly signal: AbortSignal;
}

export interface AgentProvider {
  readonly descriptor: ProviderDescriptor;
  stream(request: ProviderRequest, options: ProviderRunOptions): AsyncIterable<ProviderStreamEvent>;
}

export function providerId(value: string): ProviderId {
  const normalized = value.trim().toLowerCase();
  if (!/^[a-z][a-z0-9._-]{1,63}$/.test(normalized)) {
    throw new TypeError('Provider IDs must be 2-64 lowercase URL-safe characters.');
  }
  return normalized as ProviderId;
}

